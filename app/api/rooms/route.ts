import { assertSameOrigin } from "../../../lib/session-core";
import { roomViewFor } from "../../../lib/room-core";
import { createPersistedRoom, requestRoomCreator } from "../../../lib/room-store";
import type { RoomSettings } from "../../../lib/room-types";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const payload = (await request.json().catch(() => ({}))) as { guestName?: string; settings?: Partial<RoomSettings> };
    const user = await requestRoomCreator(request, payload);
    const room = await createPersistedRoom(user, payload.settings);
    return Response.json({ room: roomViewFor(room.state, user.userId, room.version) }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ROOM_CREATE_FAILED";
    if (message === "AUTH_REQUIRED") return Response.json({ error: "访客身份已过期，请刷新页面重试" }, { status: 401 });
    if (message === "ORIGIN_REJECTED") return Response.json({ error: "请从本站创建房间" }, { status: 403 });
    if (message === "ROOM_RATE_LIMIT") return Response.json({ error: "创建房间过于频繁，请稍后再试" }, { status: 429 });
    return Response.json({ error: "暂时无法创建房间，请稍后重试" }, { status: 500 });
  }
}
