import type { GameState, PlayerAction } from "./poker";

export type RoomUser = {
  userId: string;
  displayName: string;
  email?: string;
};

export type RoomSettings = {
  startingChips: number;
  turnSeconds: number;
  maxHands: number;
  noDisconnect: boolean;
};

export type RoomState = {
  code: string;
  hostUserId: string;
  inviteToken: string;
  seats: Array<string | null>;
  settings: RoomSettings;
  turnDeadline: number | null;
  actionReadyAt: number | null;
  presenceGraceStartedAt?: number;
  game: GameState;
};

export type RoomView = {
  code: string;
  version: number;
  seat: number;
  isHost: boolean;
  inviteToken: string | null;
  humanCount: number;
  settings: RoomSettings;
  turnDeadline: number | null;
  actionReadyAt: number | null;
  game: GameState;
};

export type RoomCommand =
  | { type: "leave" }
  | { type: "join"; guestName?: string; inviteToken?: string }
  | { type: "start"; version: number; guestName?: string }
  | { type: "restart"; version: number; settings: RoomSettings; guestName?: string }
  | { type: "reveal-board"; version: number; guestName?: string }
  | { type: "show-hole"; version: number; guestName?: string }
  | { type: "kick" | "transfer-host"; version: number; seat: number; guestName?: string }
  | { type: "tick"; version: number; guestName?: string }
  | { type: "timeout"; version: number; guestName?: string }
  | { type: "action"; version: number; action: PlayerAction; guestName?: string };
