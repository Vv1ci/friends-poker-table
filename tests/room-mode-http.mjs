// Owned local server only. Verifies retention beyond the normal 30-second lease.
import assert from "node:assert/strict";
import { setTimeout as pause } from "node:timers/promises";
const base = process.env.POKER_TEST_URL || "http://localhost:3000";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
async function call(path, cookie, payload) {
  const response = await fetch(base + path, {
    method: payload === undefined ? "GET" : "POST",
    headers: { ...(cookie ? { cookie } : {}), ...(payload === undefined ? {} : { origin: base, "content-type": "application/json" }) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  return { status: response.status, data: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
}
const users = [];
for (let i = 0; i < 6; i++) {
  const session = await call("/api/session", null, {});
  assert.equal(session.status, 200);
  users.push(session.cookie);
}
let result = await call("/api/rooms", users[0], { settings: { startingChips: 5000, turnSeconds: 0, maxHands: 10, noDisconnect: true } });
assert.equal(result.status, 201);
let room = result.data.room;
assert.equal(room.settings.noDisconnect, true);
const path = `/api/rooms/${room.code}`;
for (let i = 1; i < 6; i++) {
  result = await call(path, users[i], { type: "join", inviteToken: room.inviteToken, guestName: `Player ${i}` });
  assert.equal(result.status, 200);
}
room = (await call(path, users[0])).data.room;
result = await call(path, users[0], { type: "start", version: room.version });
assert.equal(result.status, 200);
const started = result.data.room;
assert.equal(started.game.active, 3);
assert.equal(started.turnDeadline, null);
const ownBefore = (await call(path, users[3])).data.room;
// Host and current actor stop polling; only another player stays connected.
const start = Date.now();
while (Date.now() - start < 32_000) {
  await pause(1000);
  result = await call(path, users[1]);
  assert.equal(result.status, 200);
  room = result.data.room;
  assert.equal(room.settings.noDisconnect, true);
  assert.equal(room.humanCount, 6);
  assert.equal(room.isHost, false);
  assert.equal(room.version, started.version);
  assert.equal(room.game.active, 3);
  assert.equal(room.game.players.every((player) => !player.isBot), true);
}
assert.equal((await call(path, users[1], { type: "tick", version: room.version })).status, 409);
assert.equal((await call(path, users[1], { type: "timeout", version: room.version })).status, 409);
assert.equal((await call(path, users[1], { type: "restart", settings: room.settings, version: room.version })).status, 403);
const restored = (await call(path, users[3])).data.room;
assert.equal(restored.seat, 3);
assert.deepEqual(restored.game.players[3], ownBefore.game.players[3]);
result = await call(path, users[3], { type: "action", version: restored.version, action: { type: "call" } });
assert.equal(result.status, 200);
assert.ok(result.data.room.game.turnToken > restored.game.turnToken);
room = (await call(path, users[0])).data.room;
assert.equal(room.isHost, true);
assert.equal(room.inviteToken, started.inviteToken);
console.log("PASS: retained host/seat beyond 30s, stable game, no unauthorized actions, exact cards/stack restoration, resumed play");

// Changing mode remains host-only and applies at a restart.
result = await call(path, users[0], { type: "restart", settings: { ...room.settings, noDisconnect: false }, version: room.version });
assert.equal(result.status, 200);
room = result.data.room;
assert.equal(room.settings.noDisconnect, false);
assert.equal(room.humanCount, 6); // Old heartbeats receive a fresh grace period.
assert.equal((await call(path, users[1])).data.room.humanCount, 6);
result = await call(path, users[0], { type: "restart", settings: { ...room.settings, noDisconnect: true }, version: room.version });
assert.equal(result.status, 200);
room = result.data.room;
assert.equal(room.settings.noDisconnect, true);
assert.equal((await call(path, users[0], { type: "leave" })).status, 200);
room = (await call(path, users[1])).data.room;
assert.equal(room.isHost, true);
assert.equal(room.humanCount, 5);
assert.equal(room.game.players[0].isBot, true);
assert.notEqual(room.inviteToken, started.inviteToken);
result = await call(path, users[1], { type: "kick", seat: 2, version: room.version });
assert.equal(result.status, 200);
assert.equal(result.data.room.humanCount, 4);
console.log("PASS: host-only mode switching, fresh grace on ordinary mode, explicit leave/host handoff/kick retained");

result = await call("/api/rooms", users[0], { settings: { turnSeconds: 15, noDisconnect: true } });
assert.equal(result.status, 201);
assert.equal(result.data.room.settings.turnSeconds, 15);
assert.equal(result.data.room.settings.noDisconnect, false);
console.log("PASS: timed-room rules cannot be bypassed by a no-disconnect request");
