// Run against an owned LOCAL dev server only; uses its local D1 database.
import assert from "node:assert/strict";
const base = process.env.POKER_TEST_URL || "http://localhost:3000";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
async function call(path, cookie, payload, origin = base) {
  const response = await fetch(base + path, { method: payload === undefined ? "GET" : "POST", headers: { ...(cookie ? { cookie } : {}), ...(payload === undefined ? {} : { origin, "content-type": "application/json" }) }, body: payload === undefined ? undefined : JSON.stringify(payload) });
  const text = await response.text();
  const data = response.headers.get("content-type")?.includes("application/json") ? JSON.parse(text) : { error: text };
  return { status: response.status, data, cookie: response.headers.get("set-cookie")?.split(";")[0] };
}
assert.equal((await fetch(base)).status, 200);
const visitors = [];
for (let i = 0; i < 7; i++) {
  const session = await call("/api/session", null, {});
  assert.equal(session.status, 200); assert.ok(session.cookie);
  visitors.push(session.cookie);
}
assert.equal(new Set(visitors).size, 7);
assert.equal((await call("/api/rooms", null, { guestId: "host" })).status, 401);
assert.equal((await call("/api/rooms", visitors[0], {}, "https://attacker.example")).status, 403);
const created = await call("/api/rooms", visitors[0], { guestName: "Test host" });
assert.equal(created.status, 201, JSON.stringify(created.data));
let room = created.data.room;
const route = `/api/rooms/${room.code}`;
const invite = room.inviteToken;
assert.equal((await call(route, visitors[1], { type: "join", guestId: "host" })).status, 403);
for (let i = 1; i < 6; i++) {
  const joined = await call(route, visitors[i], { type: "join", inviteToken: invite, guestName: `Test ${i}` });
  assert.equal(joined.status, 200); assert.equal(joined.data.room.seat, i);
  assert.equal(joined.data.room.inviteToken, null);
}
assert.equal((await call(route, visitors[6], { type: "join", inviteToken: invite })).status, 409);
room = (await call(route, visitors[0])).data.room;
assert.equal(room.humanCount, 6); assert.equal(room.isHost, true);
const reused = await call("/api/session", visitors[0], {});
assert.equal(reused.cookie, undefined);
assert.equal((await call(route, visitors[0])).data.room.seat, 0);
assert.equal((await call(route, visitors[1], { type: "transfer-host", seat: 1, version: room.version })).status, 403);
const transferred = await call(route, visitors[0], { type: "transfer-host", seat: 1, version: room.version });
assert.equal(transferred.status, 200); assert.equal(transferred.data.room.isHost, false);
assert.equal(transferred.data.room.inviteToken, null);
room = (await call(route, visitors[1])).data.room;
assert.equal(room.isHost, true); assert.notEqual(room.inviteToken, invite);
assert.equal((await call(route, visitors[0], { type: "start", version: room.version })).status, 403);
const kicked = await call(route, visitors[1], { type: "kick", seat: 0, version: room.version });
assert.equal(kicked.status, 200);
assert.equal((await call(route, visitors[0])).status, 403);
assert.equal((await call(route, visitors[6], { type: "join", inviteToken: invite })).status, 403);
room = kicked.data.room;
const started = await call(route, visitors[1], { type: "start", version: room.version });
assert.equal(started.status, 200);
assert.equal(started.data.room.game.deck.length, 0);
assert.equal(started.data.room.game.players[1].hole.length, 2);
assert.equal(started.data.room.game.players[2].hole.length, 0);
assert.equal((await call(route, visitors[2])).data.room.game.players[1].hole.length, 0);
assert.equal((await call(route, visitors[1], { type: "restart", version: room.version })).status, 409);
console.log("PASS: anonymous session, same-origin enforcement, invitation, six seats, reconnect, transfer, revoke, private cards, stale version");
