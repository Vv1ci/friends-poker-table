import { env } from "cloudflare:workers";
import { createRoomInviteToken, createRoomState } from "./room-core";
import type { RoomSettings, RoomState, RoomUser } from "./room-types";

import { hashSessionToken, newSessionToken, playerName, SESSION_SECONDS, sessionCookie, sessionToken } from "./session-core";

type D1Result = { meta?: { changes?: number }; success?: boolean };
type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<D1Result>;
};
type D1DatabaseLike = {
  prepare(sql: string): D1Statement;
  batch(statements: D1Statement[]): Promise<unknown>;
};

type RoomRow = {
  code: string;
  host_user_id: string;
  state_json: string;
  version: number;
};

export type StoredRoom = { state: RoomState; version: number };

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
let schemaReady: Promise<unknown> | null = null;

function getD1(): D1DatabaseLike {
  const db = (env as unknown as { DB?: D1DatabaseLike }).DB;
  if (!db) throw new Error("ROOM_DATABASE_UNAVAILABLE");
  return db;
}

async function ensureRoomSchema(): Promise<void> {
  const db = getD1();
  schemaReady ??= db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS poker_rooms (
      code TEXT PRIMARY KEY NOT NULL,
      host_user_id TEXT NOT NULL,
      state_json TEXT NOT NULL,
      version INTEGER DEFAULT 1 NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_poker_rooms_updated_at ON poker_rooms(updated_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS poker_sessions (
      token_hash TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL,
      display_name TEXT NOT NULL, expires_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_poker_sessions_expiry ON poker_sessions(expires_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_poker_rooms_creator ON poker_rooms(host_user_id, created_at)"),
  ]).catch((error) => {
    schemaReady = null;
    throw error;
  });
  await schemaReady;
}

function randomRoomCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length]).join("");
}

export function normalizeRoomCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

function authenticatedRoomUser(request: Request): RoomUser | null {
  const userId = request.headers.get("oai-authenticated-user-id");
  const email = request.headers.get("oai-authenticated-user-email");
  const encodedName = request.headers.get("oai-authenticated-user-full-name");
  const nameEncoding = request.headers.get("oai-authenticated-user-full-name-encoding");

  if (userId && email) {
    let fullName: string | null = null;
    if (encodedName && nameEncoding === "percent-encoded-utf-8") {
      try { fullName = decodeURIComponent(encodedName); } catch { fullName = null; }
    }
    return { userId, displayName: fullName?.trim() || email.split("@")[0] || email, email };
  }

  return null;
}

type SessionRow = { user_id: string; display_name: string; expires_at: number };

async function readSession(request: Request): Promise<SessionRow | null> {
  const token = sessionToken(request);
  if (!token) return null;
  await ensureRoomSchema();
  return getD1().prepare("SELECT user_id, display_name, expires_at FROM poker_sessions WHERE token_hash = ? AND expires_at > ?")
    .bind(await hashSessionToken(token), Date.now()).first<SessionRow>();
}

export async function establishSession(request: Request): Promise<{ user: RoomUser; cookie?: string }> {
  const existing = await readSession(request);
  if (existing) return { user: { userId: existing.user_id, displayName: existing.display_name } };
  await ensureRoomSchema();
  const token = newSessionToken();
  // Preserve signed-in owners of old rooms when they first adopt a session.
  const user = authenticatedRoomUser(request) ?? { userId: `anon-${crypto.randomUUID()}`, displayName: `玩家 ${token.slice(-4).toUpperCase()}` };
  await getD1().prepare("DELETE FROM poker_sessions WHERE expires_at <= ?").bind(Date.now()).run();
  await getD1().prepare("INSERT INTO poker_sessions (token_hash, user_id, display_name, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await hashSessionToken(token), user.userId, user.displayName, Date.now() + SESSION_SECONDS * 1000).run();
  return { user, cookie: sessionCookie(request, token) };
}

export async function requestRoomUser(request: Request, payload?: { guestName?: string }): Promise<RoomUser> {
  const row = await readSession(request);
  if (!row) throw new Error("AUTH_REQUIRED");
  const displayName = playerName(payload?.guestName, row.display_name);
  return { userId: row.user_id, displayName };
}

export const requestRoomCreator = requestRoomUser;

export async function createPersistedRoom(user: RoomUser, settings?: Partial<RoomSettings>): Promise<StoredRoom> {
  await ensureRoomSchema();
  const db = getD1();

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = randomRoomCode();
    const state = createRoomState(code, user, settings);
    const now = Date.now();
    try {
      const result = await db.prepare(
        "INSERT INTO poker_rooms (code, host_user_id, state_json, version, created_at, updated_at) SELECT ?, ?, ?, 1, ?, ? WHERE (SELECT COUNT(*) FROM poker_rooms WHERE host_user_id = ? AND created_at > ?) < 10",
      ).bind(code, user.userId, JSON.stringify(state), now, now, user.userId, now - 3600000).run();
      if ((result.meta?.changes ?? 0) !== 1) throw new Error("ROOM_RATE_LIMIT");
      return { state, version: 1 };
    } catch (error) {
      if (!String(error).toLowerCase().includes("unique")) throw error;
    }
  }

  throw new Error("ROOM_CODE_EXHAUSTED");
}

export async function loadPersistedRoom(code: string): Promise<StoredRoom | null> {
  await ensureRoomSchema();
  const normalizedCode = normalizeRoomCode(code);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const row = await getD1().prepare(
      "SELECT code, host_user_id, state_json, version FROM poker_rooms WHERE code = ?",
    ).bind(normalizedCode).first<RoomRow>();
    if (!row) return null;
    const state = JSON.parse(row.state_json) as RoomState;
    if (state.inviteToken) return { state, version: row.version };
    const upgraded = { ...state, inviteToken: createRoomInviteToken() };
    try {
      const version = await savePersistedRoom(normalizedCode, upgraded, row.version);
      return { state: upgraded, version };
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "ROOM_CONFLICT") throw error;
    }
  }
  throw new Error("ROOM_CONFLICT");
}

export async function savePersistedRoom(code: string, state: RoomState, expectedVersion: number): Promise<number> {
  await ensureRoomSchema();
  const nextVersion = expectedVersion + 1;
  const result = await getD1().prepare(
    "UPDATE poker_rooms SET state_json = ?, host_user_id = ?, version = ?, updated_at = ? WHERE code = ? AND version = ?",
  ).bind(JSON.stringify(state), state.hostUserId, nextVersion, Date.now(), normalizeRoomCode(code), expectedVersion).run();
  if ((result.meta?.changes ?? 0) !== 1) throw new Error("ROOM_CONFLICT");
  return nextVersion;
}
