import { assertSameOrigin } from "../../../../lib/session-core";
import { transferRoomHost, applyRoomAction, applyRoomTimeout, applySingleBotAction, findUserSeat, hasValidRoomInvite, joinHumanSeat, kickHumanSeat, restartRoomGame, revealRoomBoard, revealRoomHole, roomViewFor, startRoomHand } from "../../../../lib/room-core";
import { leavePersistedRoom, syncPersistedRoom, touchRoomPresence, normalizeRoomCode, requestRoomUser, savePersistedRoom } from "../../../../lib/room-store";
import type { PlayerAction } from "../../../../lib/poker";
import type { RoomSettings } from "../../../../lib/room-types";

type RouteContext = { params: Promise<{ code: string }> };
type CommandPayload = {
  type?: "leave" | "transfer-host" | "join" | "start" | "restart" | "reveal-board" | "show-hole" | "kick" | "tick" | "timeout" | "action";
  version?: number;
  action?: PlayerAction;
  guestName?: string;
  inviteToken?: string;
  seat?: number;
  settings?: Partial<RoomSettings>;
};

function errorResponse(message: string) {
  if (message === "ORIGIN_REJECTED") return Response.json({ error: "请从本站操作牌局" }, { status: 403 });
  if (message === "TRANSFER_DURING_HAND") return Response.json({ error: "请在本手结束后转让房主" }, { status: 409 });
  if (message === "INVALID_HOST_SEAT") return Response.json({ error: "请选择另一位已入座的真人玩家" }, { status: 400 });
  if (message === "AUTH_REQUIRED") return Response.json({ error: "无法识别你的访客身份，请重新打开邀请链接" }, { status: 401 });
  if (message === "INVITE_REQUIRED") return Response.json({ error: "邀请链接无效或已经缺少邀请凭证" }, { status: 403 });
  if (message === "HOST_ONLY") return Response.json({ error: "只有房主可以执行这个操作" }, { status: 403 });
  if (message === "KICK_DURING_HAND") return Response.json({ error: "请在本手牌结束后再移出玩家" }, { status: 409 });
  if (message === "PLAYER_NOT_KICKABLE") return Response.json({ error: "这个座位当前不能被移出" }, { status: 409 });
  if (message === "ROOM_FULL") return Response.json({ error: "房间已经坐满 6 位真人玩家" }, { status: 409 });
  if (message === "NOT_SEATED") return Response.json({ code: "NOT_SEATED", error: "你已离开牌桌或断线超时，座位已由电脑接管，请使用邀请链接重新加入" }, { status: 403 });
  if (message === "NOT_YOUR_TURN") return Response.json({ error: "当前还没有轮到你行动" }, { status: 409 });
  if (message === "ACTION_NOT_READY") return Response.json({ error: "请等待发牌动画结束后再行动" }, { status: 409 });
  if (message === "BOT_TICK_NOT_READY") return Response.json({ error: "机器人行动已经更新" }, { status: 409 });
  if (message === "AUTO_RUNOUT_NOT_READY") return Response.json({ error: "自动发牌已经更新" }, { status: 409 });
  if (message === "BOARD_REVEAL_NOT_READY") return Response.json({ error: "本手牌没有可公开的剩余公牌" }, { status: 409 });
  if (message === "HOLE_REVEAL_NOT_ALLOWED") return Response.json({ error: "当前不能亮出这手牌" }, { status: 409 });
  if (message === "NOT_ENOUGH_PLAYERS") return Response.json({ error: "只剩一名玩家有筹码，请由房主重新开始游戏" }, { status: 409 });
  if (message === "TIMEOUT_NOT_READY") return Response.json({ error: "行动倒计时已经更新" }, { status: 409 });
  if (message === "MATCH_COMPLETE") return Response.json({ error: "本房间设定的牌局手数已经完成" }, { status: 409 });
  if (message === "ROOM_CONFLICT") return Response.json({ error: "牌局刚刚发生变化，请重试" }, { status: 409 });
  if (message === "ROOM_NOT_FOUND") return Response.json({ error: "没有找到这个房间" }, { status: 404 });
  if (message === "STALE_ROOM") return Response.json({ error: "牌局已经更新，请重试" }, { status: 409 });
  return Response.json({ error: "房间暂时不可用，请稍后重试" }, { status: 500 });
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { code: rawCode } = await context.params;
    const code = normalizeRoomCode(rawCode);
    const user = await requestRoomUser(request);
    const room = await syncPersistedRoom(code, user.userId);
    return Response.json({ room: roomViewFor(room.state, user.userId, room.version) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "ROOM_LOAD_FAILED");
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    const { code: rawCode } = await context.params;
    const code = normalizeRoomCode(rawCode);
    const payload = (await request.json()) as CommandPayload;
    const user = await requestRoomUser(request, payload);
    if (payload.type === "leave") {
      await leavePersistedRoom(code, user.userId);
      return Response.json({ left: true });
    }
    const room = await syncPersistedRoom(code, user.userId);

    if (payload.type === "join") {
      if (findUserSeat(room.state, user.userId) < 0 && !hasValidRoomInvite(room.state, payload.inviteToken)) throw new Error("INVITE_REQUIRED");
      const joined = joinHumanSeat(room.state, user);
      const changed = joined.state !== room.state;
      const version = changed ? await savePersistedRoom(code, joined.state, room.version) : room.version;
      await touchRoomPresence(code, user.userId, Date.now(), true);
      return Response.json({ room: roomViewFor(joined.state, user.userId, version) });
    }

    const seat = findUserSeat(room.state, user.userId);
    if (seat < 0) throw new Error("NOT_SEATED");
    if (payload.version !== room.version) throw new Error("STALE_ROOM");

    let state = room.state;
    if (payload.type === "transfer-host" && typeof payload.seat === "number") {
      state = transferRoomHost(state, user.userId, payload.seat);
    } else if (payload.type === "start") {
      if (!state.game.handOver && state.game.street !== "waiting") throw new Error("STALE_ROOM");
      state = startRoomHand(state, user.userId);
    } else if (payload.type === "restart") {
      state = restartRoomGame(state, user.userId, payload.settings);
    } else if (payload.type === "reveal-board") {
      state = revealRoomBoard(state, user.userId);
    } else if (payload.type === "show-hole") {
      state = revealRoomHole(state, seat);
    } else if (payload.type === "kick" && typeof payload.seat === "number") {
      state = kickHumanSeat(state, user.userId, payload.seat);
    } else if (payload.type === "tick") {
      state = applySingleBotAction(state);
    } else if (payload.type === "timeout") {
      state = applyRoomTimeout(state);
    } else if (payload.type === "action" && payload.action) {
      state = applyRoomAction(state, seat, payload.action);
    } else {
      return Response.json({ error: "无效的牌局指令" }, { status: 400 });
    }

    const version = await savePersistedRoom(code, state, room.version);
    return Response.json({ room: roomViewFor(state, user.userId, version) });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "ROOM_UPDATE_FAILED");
  }
}
