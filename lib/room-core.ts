import { sequenceDuration } from "./motion";
import {
  advanceAutomaticRunout,
  applyAction,
  createInitialGame,
  decideBotAction,
  legalActions,
  revealPlayerHole,
  revealRemainingCommunity,
  startNextHand,
  type GameState,
  type PlayerAction,
} from "./poker";
import type { RoomSettings, RoomState, RoomUser, RoomView } from "./room-types";

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  startingChips: 2000,
  turnSeconds: 0,
  maxHands: 0,
};

export function createRoomInviteToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function normalizeRoomSettings(settings?: Partial<RoomSettings>): RoomSettings {
  const requestedChips = Number(settings?.startingChips);
  const startingChips = Number.isFinite(requestedChips)
    ? Math.min(1_000_000, Math.max(500, Math.round(requestedChips / 100) * 100))
    : DEFAULT_ROOM_SETTINGS.startingChips;
  const requestedTurnSeconds = Number(settings?.turnSeconds);
  const turnSeconds = [0, 15, 30, 60].includes(requestedTurnSeconds) ? requestedTurnSeconds : DEFAULT_ROOM_SETTINGS.turnSeconds;
  const requestedMaxHands = Number(settings?.maxHands);
  const maxHands = [0, 10, 25, 50].includes(requestedMaxHands) ? requestedMaxHands : DEFAULT_ROOM_SETTINGS.maxHands;
  return { startingChips, turnSeconds, maxHands };
}

function animationDelay(state: RoomState, game: GameState): number {
  const previousCounter = state.game.eventCounter ?? 0;
  const events = game.handNumber !== state.game.handNumber
    ? (game.events ?? [])
    : (game.events ?? []).filter((event) => event.id > previousCounter);
  if (!events.length) return 0;
  return sequenceDuration(events);
}

function withGame(state: RoomState, game: GameState, now = Date.now()): RoomState {
  const settings = normalizeRoomSettings(state.settings);
  const activePlayer = game.active >= 0 ? game.players[game.active] : null;
  const delay = animationDelay(state, game);
  const actionReadyAt = !game.handOver && (activePlayer || game.autoRunout) ? now + delay : null;
  const turnDeadline = settings.turnSeconds > 0 && !game.handOver && activePlayer && !activePlayer.isBot
    ? (actionReadyAt ?? now) + settings.turnSeconds * 1000
    : null;
  return { ...state, settings, game, turnDeadline, actionReadyAt };
}

function safeDisplayName(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.slice(0, 24) || "Player";
}

function avatarFor(name: string): string {
  return Array.from(name)[0]?.toUpperCase() ?? "P";
}

export function createRoomState(code: string, user: RoomUser, requestedSettings?: Partial<RoomSettings>, inviteToken = createRoomInviteToken()): RoomState {
  const settings = normalizeRoomSettings(requestedSettings);
  const game = createInitialGame(settings.startingChips);
  const displayName = safeDisplayName(user.displayName);
  game.players[0] = {
    ...game.players[0],
    name: displayName,
    avatar: avatarFor(displayName),
    isBot: false,
  };

  return {
    code,
    hostUserId: user.userId,
    inviteToken,
    seats: [user.userId, null, null, null, null, null],
    settings,
    turnDeadline: null,
    actionReadyAt: null,
    game,
  };
}

export function hasValidRoomInvite(state: RoomState, inviteToken?: string): boolean {
  return Boolean(inviteToken && state.inviteToken && inviteToken === state.inviteToken);
}

export function findUserSeat(state: RoomState, userId: string): number {
  return state.seats.findIndex((seatUserId) => seatUserId === userId);
}

export function joinHumanSeat(state: RoomState, user: RoomUser): { state: RoomState; seat: number } {
  const existingSeat = findUserSeat(state, user.userId);
  const seat = existingSeat >= 0 ? existingSeat : state.seats.findIndex((seatUserId) => seatUserId === null);
  if (seat < 0) throw new Error("ROOM_FULL");

  const seats = [...state.seats];
  seats[seat] = user.userId;
  const players = state.game.players.map((player) => ({ ...player, hole: [...player.hole] }));
  const displayName = safeDisplayName(user.displayName);
  players[seat] = {
    ...players[seat],
    name: displayName,
    avatar: avatarFor(displayName),
    isBot: false,
  };

  return { state: { ...state, seats, game: { ...state.game, players } }, seat };
}

const BOT_SEAT_IDENTITIES = [
  { name: "访客玩家", avatar: "你" },
  { name: "林舟", avatar: "林" },
  { name: "Mia", avatar: "M" },
  { name: "Rook", avatar: "R" },
  { name: "阿澈", avatar: "澈" },
  { name: "Nova", avatar: "N" },
];

export function kickHumanSeat(state: RoomState, userId: string, seat: number): RoomState {
  if (state.hostUserId !== userId) throw new Error("HOST_ONLY");
  if (!state.game.handOver && state.game.street !== "waiting") throw new Error("KICK_DURING_HAND");
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.seats.length || !state.seats[seat] || state.seats[seat] === state.hostUserId) throw new Error("PLAYER_NOT_KICKABLE");

  const seats = [...state.seats];
  seats[seat] = null;
  const players = state.game.players.map((player) => ({ ...player, hole: [...player.hole] }));
  const identity = BOT_SEAT_IDENTITIES[seat];
  players[seat] = { ...players[seat], ...identity, isBot: true };
  return { ...state, seats, inviteToken: createRoomInviteToken(), game: { ...state.game, players } };
}

export function transferRoomHost(state: RoomState, userId: string, seat: number): RoomState {
  if (state.hostUserId !== userId) throw new Error("HOST_ONLY");
  if (!state.game.handOver && state.game.street !== "waiting") throw new Error("TRANSFER_DURING_HAND");
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.seats.length || !state.seats[seat] || state.seats[seat] === userId) throw new Error("INVALID_HOST_SEAT");
  return { ...state, hostUserId: state.seats[seat]!, inviteToken: createRoomInviteToken() };
}

export function applySingleBotAction(state: RoomState, now = Date.now()): RoomState {
  const { game } = state;
  if (state.actionReadyAt && now < state.actionReadyAt) throw new Error("BOT_TICK_NOT_READY");
  if (!game.handOver && game.autoRunout) {
    return withGame(state, advanceAutomaticRunout(game), now);
  }
  if (game.handOver || game.active < 0 || !game.players[game.active]?.isBot) {
    throw new Error("BOT_TICK_NOT_READY");
  }
  return withGame(state, applyAction(game, decideBotAction(game, game.active)), now);
}

export function startRoomHand(state: RoomState, userId: string, now = Date.now()): RoomState {
  if (state.hostUserId !== userId) throw new Error("HOST_ONLY");
  const settings = normalizeRoomSettings(state.settings);
  if (settings.maxHands > 0 && state.game.handNumber >= settings.maxHands) throw new Error("MATCH_COMPLETE");
  return withGame({ ...state, settings }, startNextHand(state.game), now);
}

export function applyRoomAction(state: RoomState, seat: number, action: PlayerAction, now = Date.now()): RoomState {
  if (state.actionReadyAt && now < state.actionReadyAt) throw new Error("ACTION_NOT_READY");
  if (state.game.active !== seat || state.game.players[seat]?.isBot) throw new Error("NOT_YOUR_TURN");
  return withGame(state, applyAction(state.game, action), now);
}

export function revealRoomBoard(state: RoomState, userId: string, now = Date.now()): RoomState {
  if (state.hostUserId !== userId) throw new Error("HOST_ONLY");
  return withGame(state, revealRemainingCommunity(state.game), now);
}

export function revealRoomHole(state: RoomState, seat: number, now = Date.now()): RoomState {
  return withGame(state, revealPlayerHole(state.game, seat), now);
}

export function restartRoomGame(state: RoomState, userId: string, requestedSettings?: Partial<RoomSettings>): RoomState {
  if (state.hostUserId !== userId) throw new Error("HOST_ONLY");
  const settings = normalizeRoomSettings(requestedSettings);
  const fresh = createInitialGame(settings.startingChips);
  fresh.players = fresh.players.map((player, index) => {
    const current = state.game.players[index];
    return current ? {
      ...player,
      id: current.id,
      name: current.name,
      avatar: current.avatar,
      isBot: current.isBot,
      style: current.style,
    } : player;
  });
  fresh.message = "房主已重新设置牌局";
  fresh.log = ["牌局已重新开始，等待房主发牌"];
  return { ...state, settings, turnDeadline: null, actionReadyAt: null, game: fresh };
}

export function applyRoomTimeout(state: RoomState, now = Date.now()): RoomState {
  const settings = normalizeRoomSettings(state.settings);
  const actor = state.game.active;
  const player = actor >= 0 ? state.game.players[actor] : null;
  if (settings.turnSeconds <= 0 || !state.turnDeadline || now < state.turnDeadline || !player || player.isBot || state.game.handOver) {
    throw new Error("TIMEOUT_NOT_READY");
  }
  const legal = legalActions(state.game, actor);
  return withGame(state, applyAction(state.game, legal.canCheck ? { type: "check" } : { type: "fold" }), now);
}

export function roomViewFor(state: RoomState, userId: string, version: number): RoomView {
  const seat = findUserSeat(state, userId);
  if (seat < 0) throw new Error("NOT_SEATED");

  const source = state.game;
  const endReason = source.endReason ?? (source.handOver ? "showdown" : null);
  const revealedPlayers = source.revealedPlayers ?? [];
  const game: GameState = {
    ...source,
    deck: [],
    community: [...source.community],
    burned: source.burned ?? 0,
    smallBlindSeat: source.smallBlindSeat ?? -1,
    bigBlindSeat: source.bigBlindSeat ?? -1,
    endReason,
    revealedPlayers,
    autoRunout: source.autoRunout ?? false,
    eventCounter: source.eventCounter ?? 0,
    events: [...(source.events ?? [])],
    players: source.players.map((player, index) => ({
      ...player,
      hole: index === seat || revealedPlayers.includes(index) || (source.handOver && endReason === "showdown" && !player.folded) ? [...player.hole] : [],
    })),
  };

  return {
    code: state.code,
    version,
    seat,
    isHost: state.hostUserId === userId,
    inviteToken: state.hostUserId === userId ? state.inviteToken ?? null : null,
    humanCount: state.seats.filter(Boolean).length,
    settings: normalizeRoomSettings(state.settings),
    turnDeadline: state.turnDeadline ?? null,
    actionReadyAt: state.actionReadyAt ?? null,
    game,
  };
}
