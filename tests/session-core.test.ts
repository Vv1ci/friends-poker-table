import assert from "node:assert/strict";
import test from "node:test";
import { assertSameOrigin, hashSessionToken, newSessionToken, sessionCookie, sessionToken } from "../lib/session-core";
import { createRoomState, joinHumanSeat, kickHumanSeat, roomViewFor, startRoomHand, transferRoomHost } from "../lib/room-core";

test("anonymous credentials are random cookies, never caller supplied guest IDs", async () => {
  const token = newSessionToken();
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.notEqual(token, newSessionToken());
  const request = new Request("https://poker.example/api/rooms?guestId=host");
  assert.equal(sessionToken(request), null);
  const cookie = sessionCookie(request, token);
  assert.match(cookie, /__Host-poker-session=/);
  assert.match(cookie, /HttpOnly; SameSite=Lax; Max-Age=2592000; Secure/);
  assert.equal(sessionToken(new Request(request, { headers: { cookie } })), token);
  assert.notEqual(await hashSessionToken(token), token);
  assert.equal(await hashSessionToken(token), await hashSessionToken(token));
});

test("mutations require same origin and JSON", () => {
  const url = "https://poker.example/api/rooms";
  const invalid: Record<string, string>[] = [{}, { origin: "https://evil.example", "content-type": "application/json" }, { origin: "https://poker.example", "content-type": "text/plain" }];
  for (const headers of invalid) {
    assert.throws(() => assertSameOrigin(new Request(url, { headers })), /ORIGIN_REJECTED/);
  }
  assert.doesNotThrow(() => assertSameOrigin(new Request(url, { headers: { origin: "https://poker.example", "content-type": "application/json" } })));
});

test("host transfer rotates invites and moves all authority, including seat zero removal", () => {
  const initial = createRoomState("ABC234", { userId: "old", displayName: "Old" });
  const { state } = joinHumanSeat(initial, { userId: "next", displayName: "Next" });
  assert.throws(() => transferRoomHost(state, "next", 0), /HOST_ONLY/);
  assert.throws(() => transferRoomHost(state, "old", 0), /INVALID_HOST_SEAT/);
  assert.throws(() => transferRoomHost(state, "old", 2), /INVALID_HOST_SEAT/);
  const transferred = transferRoomHost(state, "old", 1);
  assert.notEqual(transferred.inviteToken, state.inviteToken);
  assert.equal(roomViewFor(transferred, "old", 2).isHost, false);
  assert.equal(roomViewFor(transferred, "next", 2).isHost, true);
  assert.throws(() => startRoomHand(transferred, "old"), /HOST_ONLY/);
  assert.throws(() => kickHumanSeat(transferred, "next", 1), /PLAYER_NOT_KICKABLE/);
  assert.equal(kickHumanSeat(transferred, "next", 0).seats[0], null);
  const playing = startRoomHand(transferred, "next");
  assert.throws(() => transferRoomHost(playing, "next", 0), /TRANSFER_DURING_HAND/);
});

test("six seats and same identity reconnect survive host changes", () => {
  let room = createRoomState("ABC234", { userId: "p0", displayName: "P0" });
  for (let i = 1; i < 6; i++) room = joinHumanSeat(room, { userId: `p${i}`, displayName: `P${i}` }).state;
  assert.throws(() => joinHumanSeat(room, { userId: "p6", displayName: "P6" }), /ROOM_FULL/);
  room = transferRoomHost(room, "p0", 5);
  const joined = joinHumanSeat(room, { userId: "p5", displayName: "Renamed" });
  assert.equal(joined.seat, 5);
  assert.equal(roomViewFor(joined.state, "p5", 3).isHost, true);
  assert.equal(joined.state.seats.length, 6);
});
