import { env } from "cloudflare:workers";
import { createRoomInviteToken, createRoomState, expireDisconnectedSeats, findUserSeat, releaseHumanSeats, RECONNECT_GRACE_MS } from "./room-core";
import type { RoomSettings, RoomState, RoomUser } from "./room-types";

import { hashSessionToken, newSessionToken, playerName, SESSION_SECONDS, sessionCookie, sessionToken } from "./session-core";

type D1Result = { meta?: { changes?: number }; success?: boolean };
type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
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
    db.prepare(`CREATE TABLE IF NOT EXISTS poker_room_presence (
      room_code TEXT NOT NULL, user_id TEXT NOT NULL, last_seen INTEGER NOT NULL,
      PRIMARY KEY (room_code, user_id)
    )`),
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
      await touchRoomPresence(code, user.userId, now, true);
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

export async function savePersistedRoom(code: string, state: RoomState, expectedVersion: number, expired?: { userIds: string[]; cutoff: number }): Promise<number> {
  await ensureRoomSchema();
  const nextVersion = expectedVersion + 1;
  // A heartbeat that wins the race to D1 must prevent stale disconnect eviction.
  const guard = expired?.userIds.length
    ? ` AND NOT EXISTS (SELECT 1 FROM poker_room_presence WHERE room_code = ? AND user_id IN (${expired.userIds.map(() => "?").join(",")}) AND last_seen > ?)` : "";
  const result = await getD1().prepare(
    "UPDATE poker_rooms SET state_json = ?, host_user_id = ?, version = ?, updated_at = ? WHERE code = ? AND version = ?" + guard,
  ).bind(JSON.stringify(state), state.hostUserId, nextVersion, Date.now(), normalizeRoomCode(code), expectedVersion,
    ...(expired?.userIds.length ? [normalizeRoomCode(code), ...expired.userIds, expired.cutoff] : [])).run();
  if ((result.meta?.changes ?? 0) !== 1) throw new Error("ROOM_CONFLICT");
  return nextVersion;
}

export async function touchRoomPresence(code: string, userId: string, now = Date.now(), joined = false): Promise<void> {
  await ensureRoomSchema();
  const sql = joined
    ? "INSERT INTO poker_room_presence (room_code, user_id, last_seen) VALUES (?, ?, ?) ON CONFLICT(room_code, user_id) DO UPDATE SET last_seen = MAX(last_seen, excluded.last_seen)"
    : "UPDATE poker_room_presence SET last_seen = MAX(last_seen, ?) WHERE room_code = ? AND user_id = ?";
  await getD1().prepare(sql).bind(...(joined ? [normalizeRoomCode(code), userId, now] : [now, normalizeRoomCode(code), userId])).run();
}

// Reconciliation runs on room traffic, including the remaining players' polling.
// Heartbeats live separately so they never restart bot timers or stale a wager.
export async function syncPersistedRoom(code: string, userId?: string): Promise<StoredRoom> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const room = await loadPersistedRoom(code);
    if (!room) throw new Error("ROOM_NOT_FOUND");
    const now = Date.now();
    const ids = room.state.seats.filter((id): id is string => id !== null);
    const rows = await getD1().prepare("SELECT user_id, last_seen FROM poker_room_presence WHERE room_code = ?")
      .bind(normalizeRoomCode(code)).all<{ user_id: string; last_seen: number }>();
    const lastSeen = new Map(rows.results.map((row) => [row.user_id, row.last_seen]));
    const missing = ids.filter((id) => !lastSeen.has(id));
    if (missing.length) {
      // Upgrade old rooms once, granting every existing seat a full grace period.
      await getD1().batch(missing.map((id) => getD1().prepare(
        "INSERT OR IGNORE INTO poker_room_presence (room_code, user_id, last_seen) VALUES (?, ?, ?)",
      ).bind(normalizeRoomCode(code), id, now)));
      for (const id of missing) lastSeen.set(id, now);
    }
    const state = expireDisconnectedSeats(room.state, lastSeen, now);
    try {
      let version = room.version;
      if (state !== room.state) {
        version = await savePersistedRoom(code, state, room.version, {
          userIds: ids.filter((id) => !state.seats.includes(id)), cutoff: now - RECONNECT_GRACE_MS,
        });
      }
      if (userId && findUserSeat(state, userId) >= 0) await touchRoomPresence(code, userId, now);
      return { state, version };
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "ROOM_CONFLICT") throw error;
    }
  }
  throw new Error("ROOM_CONFLICT");
}

// Leave is idempotent and uses a server-side CAS retry, not the client's possibly stale version.
export async function leavePersistedRoom(code: string, userId: string): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const room = await syncPersistedRoom(code);
    const state = releaseHumanSeats(room.state, [userId], "leave");
    if (state === room.state) return;
    try {
      await savePersistedRoom(code, state, room.version);
      return;
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "ROOM_CONFLICT") throw error;
    }
  }
  throw new Error("ROOM_CONFLICT");
}
