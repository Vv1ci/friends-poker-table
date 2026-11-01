// Creates rooms only on the owned local dev server. Real 30-second lease test.
import assert from "node:assert/strict";
import { setTimeout as pause } from "node:timers/promises";
const base = process.env.POKER_TEST_URL || "http://localhost:3000";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
async function call(path, cookie, payload, origin = base) {
  const response = await fetch(base + path, {
    method: payload === undefined ? "GET" : "POST",
    headers: { ...(cookie ? { cookie } : {}), ...(payload === undefined ? {} : { origin, "content-type": "application/json" }) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const text = await response.text();
  const data = response.headers.get("content-type")?.includes("application/json") ? JSON.parse(text) : { error: text };
  return { status: response.status, data, cookie: response.headers.get("set-cookie")?.split(";")[0] };
}
const cookies = [];
for (let i = 0; i < 3; i++) {
  const result = await call("/api/session", null, {});
  assert.equal(result.status, 200);
  cookies.push(result.cookie);
}
let result = await call("/api/rooms", cookies[0], { guestName: "Host" });
assert.equal(result.status, 201);
const path = `/api/rooms/${result.data.room.code}`;
const invite = result.data.room.inviteToken;
for (let i = 1; i < 3; i++) {
  assert.equal((await call(path, cookies[i], { type: "join", inviteToken: invite, guestName: `Friend ${i}` })).status, 200);
}
const initial = (await call(path, cookies[0])).data.room;
// Polling/heartbeats must not change game versions, and refresh restores the same seat.
const polls = await Promise.all(Array.from({ length: 6 }, () => call(path, cookies[1])));
assert.ok(polls.every((r) => r.status === 200 && r.data.room.version === initial.version && r.data.room.seat === 1));
result = await call(path, cookies[0], { type: "start", version: initial.version });
assert.equal(result.status, 200);
const started = result.data.room;
assert.equal((await call(path, cookies[1], { type: "leave" }, "https://attacker.example")).status, 403);
assert.equal((await call(path, null, { type: "leave" })).status, 401);
// Ignore an obsolete client version for leave; repeat/concurrent leave is harmless.
const leaves = await Promise.all(Array.from({ length: 4 }, () => call(path, cookies[1], { type: "leave", version: -1 })));
assert.ok(leaves.every((r) => r.status === 200));
const afterLeave = (await call(path, cookies[0])).data.room;
assert.equal(afterLeave.humanCount, 2);
assert.equal(afterLeave.game.players[1].isBot, true);
assert.equal(afterLeave.game.players[1].chips, started.game.players[1].chips);
assert.equal(afterLeave.game.active, started.game.active);
assert.equal(afterLeave.game.turnToken, started.game.turnToken);
assert.equal(afterLeave.actionReadyAt, started.actionReadyAt);
assert.equal((await call(path, cookies[1])).status, 403);
assert.equal((await call(path, cookies[1], { type: "tick", version: afterLeave.version })).status, 403);
console.log("PASS: server-confirmed/idempotent leave, concurrent polls, stable versions, preserved game, access revoked");

// Host stops polling, the other human remains connected throughout the grace period.
const start = Date.now();
let latest;
while (Date.now() - start < 32_000) {
  await pause(1000);
  result = await call(path, cookies[2]);
  assert.equal(result.status, 200, JSON.stringify(result.data));
  latest = result.data.room;
  if (Date.now() - start < 28_000) {
    assert.equal(latest.humanCount, 2);
    assert.equal(latest.isHost, false);
  }
}
assert.equal(latest.humanCount, 1);
assert.equal(latest.isHost, true);
assert.equal(latest.game.players[0].isBot, true);
assert.notEqual(latest.inviteToken, invite);
assert.equal(latest.game.active, started.game.active);
assert.equal((await call(path, cookies[0])).status, 403);
assert.equal((await call(path, cookies[0], { type: "start", version: latest.version })).status, 403);
assert.equal((await call(path, cookies[1], { type: "join", inviteToken: invite })).status, 403);
// New host can reset even during the hand; old host cannot reclaim privileges.
result = await call(path, cookies[2], { type: "restart", version: latest.version, settings: latest.settings });
assert.equal(result.status, 200);
assert.equal(result.data.room.isHost, true);
const newInvite = result.data.room.inviteToken;
assert.equal((await call(path, cookies[2], { type: "leave" })).status, 200);
result = await call(path, cookies[1], { type: "join", inviteToken: newInvite });
assert.equal(result.status, 200);
assert.equal(result.data.room.humanCount, 1);
assert.equal(result.data.room.isHost, true);
assert.equal((await call(path, cookies[0], { type: "join", inviteToken: newInvite })).status, 200);
assert.equal((await call(path, cookies[1], { type: "leave" })).status, 200);
const handedOff = await call(path, cookies[0]);
assert.equal(handedOff.status, 200);
assert.equal(handedOff.data.room.isHost, true);
assert.equal(handedOff.data.room.humanCount, 1);
assert.notEqual(handedOff.data.room.inviteToken, newInvite);
console.log("PASS: real 30s grace, auto takeover, host transfer, invite rotation, empty-room recovery");
