import assert from "node:assert/strict";
import test from "node:test";
import { applyRoomAction, applyRoomTimeout, applySingleBotAction, createRoomState, expireDisconnectedSeats, hasValidRoomInvite, joinHumanSeat, kickHumanSeat, normalizeRoomSettings, releaseHumanSeats, RECONNECT_GRACE_MS, restartRoomGame, revealRoomBoard, revealRoomHole, roomViewFor, startRoomHand } from "../lib/room-core";
import { applyAction } from "../lib/poker";

function botTick<T extends { actionReadyAt: number | null }>(room: T): number {
  return (room.actionReadyAt ?? Date.now()) + 1;
}

test("主动退出保留座位的筹码、底牌、下注及行动进度，原玩家失去操作和底牌访问", () => {
  let room = joinHumanSeat(createRoomState("ABC234", { userId: "host", displayName: "Host" }), { userId: "friend", displayName: "Friend" }).state;
  room = startRoomHand(room, "host", 1000);
  room = { ...room, game: { ...room.game, active: 1 }, turnDeadline: 99999 };
  const before = room.game.players[1];
  const left = releaseHumanSeats(room, ["friend"], "leave");
  assert.equal(left.seats[1], null);
  assert.equal(left.game.players[1].isBot, true);
  assert.equal(left.turnDeadline, null);
  for (const key of ["chips", "bet", "contributed", "hole", "folded", "allIn"] as const) {
    assert.deepEqual(left.game.players[1][key], before[key]);
  }
  assert.equal(left.game.active, room.game.active);
  assert.equal(left.game.turnToken, room.game.turnToken);
  assert.equal(left.actionReadyAt, room.actionReadyAt);
  assert.deepEqual(left.game.community, room.game.community);
  assert.deepEqual(left.game.deck, room.game.deck);
  assert.throws(() => roomViewFor(left, "friend", 4), /NOT_SEATED/);
  assert.throws(() => applyRoomAction(left, 1, { type: "call" }, botTick(left)), /NOT_YOUR_TURN/);
  assert.doesNotThrow(() => applySingleBotAction(left, botTick(left)));
  assert.equal(releaseHumanSeats(left, ["friend"], "leave"), left);
});

test("非当前玩家退出不会重置当前真人的行动时限或发牌门限", () => {
  const room = joinHumanSeat(createRoomState("ABC234", { userId: "host", displayName: "Host" }), { userId: "friend", displayName: "Friend" }).state;
  const active = { ...room, turnDeadline: 90000, actionReadyAt: 80000, game: { ...room.game, active: 0 } };
  const left = releaseHumanSeats(active, ["friend"], "leave");
  assert.equal(left.turnDeadline, 90000);
  assert.equal(left.actionReadyAt, 80000);
});

test("30秒宽限期内保留原位，重连心跳延长期限，超时才由电脑接管", () => {
  const room = joinHumanSeat(createRoomState("ABC234", { userId: "host", displayName: "Host" }), { userId: "friend", displayName: "Friend" }).state;
  const beats = new Map([["host", 40000], ["friend", 10000]]);
  assert.equal(expireDisconnectedSeats(room, beats, 10000 + RECONNECT_GRACE_MS - 1), room);
  const refreshed = new Map(beats).set("friend", 39999);
  assert.equal(expireDisconnectedSeats(room, refreshed, 40000), room);
  const expired = expireDisconnectedSeats(room, beats, 40000);
  assert.equal(expired.seats[1], null);
  assert.equal(expired.hostUserId, "host");
  assert.equal(expired.game.players[1].isBot, true);
});

test("房主离开或超时按座位顺序转给未超时真人，不把权限交给同批超时者", () => {
  let room = createRoomState("ABC234", { userId: "host", displayName: "Host" });
  for (const id of ["stale", "online"]) room = joinHumanSeat(room, { userId: id, displayName: id }).state;
  const expired = expireDisconnectedSeats(room, new Map([["host", 1000], ["stale", 1000], ["online", 31000]]), 31000);
  assert.equal(expired.hostUserId, "online");
  assert.equal(roomViewFor(expired, "online", 4).isHost, true);
  assert.notEqual(expired.inviteToken, room.inviteToken);
  assert.equal(roomViewFor(expired, "online", 4).humanCount, 1);
  const left = releaseHumanSeats(room, ["host"], "leave");
  assert.equal(left.hostUserId, "stale");
  assert.equal(roomViewFor(left, "online", 4).isHost, false);
});

test("最后一人离开后无人拥有房主权限，持有效邀请入座者成为新房主", () => {
  const room = createRoomState("ABC234", { userId: "host", displayName: "Host" });
  const empty = releaseHumanSeats(room, ["host"], "leave");
  assert.equal(empty.hostUserId, "");
  assert.equal(empty.seats.every((id) => id === null), true);
  assert.equal(empty.game.players.every((player) => player.isBot), true);
  assert.equal(hasValidRoomInvite(empty, room.inviteToken), true);
  assert.throws(() => startRoomHand(empty, "host"), /HOST_ONLY/);
  const joined = joinHumanSeat(empty, { userId: "next", displayName: "Next" }).state;
  assert.equal(joined.hostUserId, "next");
});

test("创建房间时房主入座且其余座位由机器人补齐", () => {
  const room = createRoomState("ABC234", { userId: "host", displayName: "Host" });
  assert.equal(room.seats[0], "host");
  assert.equal(room.game.players[0].isBot, false);
  assert.equal(room.game.players.slice(1).every((player) => player.isBot), true);
});

test("朋友加入后接管一个机器人座位并可断线重连", () => {
  const initial = createRoomState("ABC234", { userId: "host", displayName: "Host" });
  const joined = joinHumanSeat(initial, { userId: "friend", displayName: "Friend" });
  const rejoined = joinHumanSeat(joined.state, { userId: "friend", displayName: "Friend" });
  assert.equal(joined.seat, 1);
  assert.equal(rejoined.seat, 1);
  assert.equal(rejoined.state.game.players[1].isBot, false);
});

test("房间使用专属邀请凭证且只有房主视图可以读取", () => {
  const initial = createRoomState("ABC234", { userId: "host", displayName: "Host" }, undefined, "invite-secret");
  const joined = joinHumanSeat(initial, { userId: "friend", displayName: "Friend" });
  assert.equal(hasValidRoomInvite(initial, "invite-secret"), true);
  assert.equal(hasValidRoomInvite(initial, "wrong-secret"), false);
  assert.equal(roomViewFor(joined.state, "host", 2).inviteToken, "invite-secret");
  assert.equal(roomViewFor(joined.state, "friend", 2).inviteToken, null);
});

test("创建房间时保存起始筹码、行动限时和总手数", () => {
  const room = createRoomState("ABC234", { userId: "host", displayName: "Host" }, { startingChips: 100_000, turnSeconds: 30, maxHands: 25 });
  assert.deepEqual(room.settings, { startingChips: 100_000, turnSeconds: 30, maxHands: 25, noDisconnect: false });
  assert.equal(room.game.players.every((player) => player.chips === 100_000), true);
  assert.equal(room.game.smallBlind, 500);
  assert.equal(room.game.bigBlind, 1000);
});

test("服务器视图只向当前玩家公开自己的底牌", () => {
  const initial = createRoomState("ABC234", { userId: "host", displayName: "Host" });
  const joined = joinHumanSeat(initial, { userId: "friend", displayName: "Friend" });
  const started = startRoomHand(joined.state, "host");
  const hostView = roomViewFor(started, "host", 3);
  assert.equal(hostView.game.players[0].hole.length, 2);
  assert.equal(hostView.game.players[1].hole.length, 0);
  assert.equal(hostView.game.deck.length, 0);
});

test("机器人每次只行动一步，再轮到下一位玩家", () => {
  const initial = createRoomState("ABC234", { userId: "host", displayName: "Host" });
  const started = startRoomHand(initial, "host");
  assert.equal(started.game.active, 3);
  const logLength = started.game.log.length;
  const next = applySingleBotAction(started, botTick(started));
  assert.equal(next.game.log.length, logLength + 1);
  assert.notEqual(next.game.active, 3);
});

test("真人弃牌后机器人仍按步骤完成整手牌", (context) => {
  context.mock.method(Math, "random", () => .5);
  const initial = createRoomState("ABC234", { userId: "host", displayName: "Host" });
  let room = startRoomHand(initial, "host");
  let setupTicks = 0;
  while (!room.game.handOver && room.game.active !== 0 && setupTicks < 50) {
    room = applySingleBotAction(room, botTick(room));
    setupTicks += 1;
  }
  assert.equal(room.game.active, 0);

  room = applyRoomAction(room, 0, { type: "fold" }, botTick(room));
  assert.equal(room.game.handOver, false);
  assert.equal(room.game.players[room.game.active].isBot, true);

  const firstLogLength = room.game.log.length;
  const actorName = room.game.players[room.game.active].name;
  room = applySingleBotAction(room, botTick(room));
  const added = room.game.log.slice(firstLogLength);
  // Closing a street adds a board/status log as well as the single bot action.
  assert.ok(added[0].startsWith(actorName + " "));
  const actionLines = added.filter(line => room.game.players.some(player =>
    ["弃牌", "过牌", "跟注", "加注至", "全下"].some(action => line.startsWith(player.name + " " + action))));
  assert.equal(actionLines.length, 1);

  let finishTicks = 1;
  while (!room.game.handOver && finishTicks < 500) {
    room = applySingleBotAction(room, botTick(room));
    finishTicks += 1;
  }
  assert.equal(room.game.handOver, true);
  assert.ok(finishTicks >= 1);
});

test("限时房间轮到真人时设置倒计时并在到时自动行动", () => {
  let room = startRoomHand(createRoomState("ABC234", { userId: "host", displayName: "Host" }, { startingChips: 2000, turnSeconds: 15, maxHands: 0 }), "host", 1000);
  let ticks = 0;
  while (!room.game.handOver && room.game.active !== 0 && ticks < 50) {
    room = applySingleBotAction(room, botTick(room));
    ticks += 1;
  }
  assert.equal(room.game.active, 0);
  assert.ok(room.turnDeadline && room.turnDeadline > 15_000);
  assert.throws(() => applyRoomTimeout(room, room.turnDeadline! - 1), /TIMEOUT_NOT_READY/);
  const turnToken = room.game.turnToken;
  room = applyRoomTimeout(room, room.turnDeadline!);
  assert.ok(room.game.turnToken > turnToken);
  assert.notEqual(room.game.active, 0);
});

test("达到房间设定手数后不能继续开下一手", () => {
  const room = createRoomState("ABC234", { userId: "host", displayName: "Host" }, { startingChips: 2000, turnSeconds: 0, maxHands: 10 });
  const completed = { ...room, game: { ...room.game, handNumber: 10, handOver: true, street: "showdown" as const } };
  assert.throws(() => startRoomHand(completed, "host"), /MATCH_COMPLETE/);
});

test("非房主不能开始第一手或下一手", () => {
  const room = createRoomState("ABC234", { userId: "host", displayName: "Host" });
  assert.throws(() => startRoomHand(room, "friend"), /HOST_ONLY/);
});

test("只有房主能在两手牌之间移出玩家并轮换邀请凭证", () => {
  const initial = createRoomState("ABC234", { userId: "host", displayName: "Host" }, undefined, "old-invite");
  const joined = joinHumanSeat(initial, { userId: "friend", displayName: "Friend" }).state;
  assert.throws(() => kickHumanSeat(joined, "friend", 1), /HOST_ONLY/);
  const kicked = kickHumanSeat(joined, "host", 1);
  assert.equal(kicked.seats[1], null);
  assert.equal(kicked.game.players[1].isBot, true);
  assert.equal(kicked.game.players[1].name, "林舟");
  assert.notEqual(kicked.inviteToken, "old-invite");
});

test("提前获胜时不公开赢家手牌，玩家可在结束后主动亮牌", () => {
  const initial = createRoomState("ABC234", { userId: "host", displayName: "Host" });
  let room = startRoomHand(initial, "host", 1000);
  room = {
    ...room,
    actionReadyAt: null,
    game: {
      ...room.game,
      active: 1,
      players: room.game.players.map((player, index) => ({ ...player, folded: ![0, 1].includes(index) })),
    },
  };
  room = { ...room, game: applyAction(room.game, { type: "fold" }) };
  const hidden = roomViewFor(room, "host", 2);
  assert.equal(hidden.game.endReason, "fold");
  assert.equal(hidden.game.community.length, 0);
  const guestView = roomViewFor({ ...room, seats: ["host", "friend", null, null, null, null] }, "friend", 2);
  assert.equal(guestView.game.players[0].hole.length, 0);
  const shown = revealRoomHole(room, 0);
  assert.equal(roomViewFor({ ...shown, seats: ["host", "friend", null, null, null, null] }, "friend", 3).game.players[0].hole.length, 2);
});

test("只有房主能公开提前结束后的剩余公牌", () => {
  const initial = createRoomState("ABC234", { userId: "host", displayName: "Host" });
  let room = startRoomHand(initial, "host", 1000);
  room = {
    ...room,
    actionReadyAt: null,
    game: {
      ...room.game,
      active: 1,
      players: room.game.players.map((player, index) => ({ ...player, folded: ![0, 1].includes(index) })),
    },
  };
  room = { ...room, game: applyAction(room.game, { type: "fold" }) };
  assert.throws(() => revealRoomBoard(room, "friend"), /HOST_ONLY/);
  const revealed = revealRoomBoard(room, "host");
  assert.equal(revealed.game.community.length, 5);
  assert.equal(revealed.game.burned, 3);
  assert.equal(revealed.game.players[0].won, room.game.players[0].won);
});

test("房主重新开始时保留座位并应用新设置", () => {
  const joined = joinHumanSeat(createRoomState("ABC234", { userId: "host", displayName: "Host" }), { userId: "friend", displayName: "Friend" }).state;
  const restarted = restartRoomGame(joined, "host", { startingChips: 10_000, turnSeconds: 30, maxHands: 25 });
  assert.equal(restarted.seats[1], "friend");
  assert.equal(restarted.game.players[1].isBot, false);
  assert.equal(restarted.game.players.every((player) => player.chips === 10_000), true);
  assert.equal(restarted.game.handNumber, 0);
  assert.deepEqual(restarted.settings, { startingChips: 10_000, turnSeconds: 30, maxHands: 25, noDisconnect: false });
});

test("缩短动画后服务器仍在发牌结束前阻止行动", () => {
  let room = createRoomState("ABC234", { userId: "p0", displayName: "P0" });
  for (let i = 1; i < 6; i++) room = joinHumanSeat(room, { userId: `p${i}`, displayName: `P${i}` }).state;
  const started = startRoomHand(room, "p0", 10000);
  assert.equal(started.actionReadyAt, 10000 + 12 * 320 + 180);
  assert.throws(() => applyRoomAction(started, started.game.active, { type: "call" }, started.actionReadyAt! - 1), /ACTION_NOT_READY/);
  assert.doesNotThrow(() => applyRoomAction(started, started.game.active, { type: "call" }, started.actionReadyAt!));
});

test("旧房间默认保持30秒接管，限时房间不能通过不掉线设置绕过规则", () => {
  assert.equal(normalizeRoomSettings().noDisconnect, false);
  assert.equal(normalizeRoomSettings({ turnSeconds: 0 }).noDisconnect, false);
  assert.equal(normalizeRoomSettings({ turnSeconds: 0, noDisconnect: true }).noDisconnect, true);
  for (const turnSeconds of [15, 30, 60]) {
    assert.equal(normalizeRoomSettings({ turnSeconds, noDisconnect: true }).noDisconnect, false);
  }
});

test("不掉线房间长期离线不更换座位、房主或邀请，也不自动操作真人", () => {
  let room = createRoomState("ABC234", { userId: "host", displayName: "Host" }, { noDisconnect: true });
  for (let i = 1; i < 6; i++) room = joinHumanSeat(room, { userId: `p${i}`, displayName: `P${i}` }).state;
  room = startRoomHand(room, "host", 1000);
  const future = 1000 + 90 * 24 * 60 * 60 * 1000;
  const after = expireDisconnectedSeats(room, new Map(room.seats.map((id) => [id!, 1000])), future);
  assert.equal(after, room);
  assert.equal(after.turnDeadline, null);
  assert.equal(roomViewFor(after, "host", 1).isHost, true);
  assert.equal(roomViewFor(after, "p3", 1).settings.noDisconnect, true);
  assert.throws(() => applySingleBotAction(after, future), /BOT_TICK_NOT_READY/);
  assert.throws(() => applyRoomTimeout(after, future), /TIMEOUT_NOT_READY/);
  assert.throws(() => applyRoomAction(after, 0, { type: "fold" }, future), /NOT_YOUR_TURN/);
  const resumed = joinHumanSeat(after, { userId: "p3", displayName: "P3" });
  assert.equal(resumed.seat, 3);
  assert.deepEqual(resumed.state.game.players[3], room.game.players[3]);
  assert.doesNotThrow(() => applyRoomAction(resumed.state, 3, { type: "call" }, future));
});

test("不掉线模式仍允许主动退出和房主踢人，退出房主交接权限并保留牌局", () => {
  let room = createRoomState("ABC234", { userId: "host", displayName: "Host" }, { noDisconnect: true });
  room = joinHumanSeat(room, { userId: "friend", displayName: "Friend" }).state;
  const kicked = kickHumanSeat(room, "host", 1);
  assert.equal(kicked.seats[1], null);
  assert.equal(kicked.game.players[1].isBot, true);
  const started = startRoomHand(room, "host", 1000);
  const left = releaseHumanSeats(started, ["host"], "leave");
  assert.equal(left.hostUserId, "friend");
  assert.equal(left.seats[0], null);
  assert.equal(left.game.players[0].isBot, true);
  assert.deepEqual(left.game.players[0].hole, started.game.players[0].hole);
  assert.equal(left.game.players[0].chips, started.game.players[0].chips);
  assert.equal(left.game.active, started.game.active);
  assert.notEqual(left.inviteToken, started.inviteToken);
});

test("只有房主可重开切换模式，恢复普通模式后所有座位获得新30秒宽限期", () => {
  let room = createRoomState("ABC234", { userId: "host", displayName: "Host" }, { noDisconnect: true });
  room = joinHumanSeat(room, { userId: "friend", displayName: "Friend" }).state;
  assert.throws(() => restartRoomGame(room, "friend", { noDisconnect: false }), /HOST_ONLY/);
  const restarted = restartRoomGame(room, "host", { noDisconnect: false }, 90000);
  assert.equal(restarted.settings.noDisconnect, false);
  assert.deepEqual(restarted.seats, room.seats);
  const beats = new Map([["host", 1000], ["friend", 1000]]);
  assert.equal(expireDisconnectedSeats(restarted, beats, 119999), restarted);
  assert.equal(expireDisconnectedSeats(restarted, beats, 120000).seats.every((id) => id === null), true);
  assert.equal(restartRoomGame(restarted, "host", { noDisconnect: true }).settings.noDisconnect, true);
});
