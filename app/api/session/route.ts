import { establishSession } from "../../../lib/room-store";
import { assertSameOrigin } from "../../../lib/session-core";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { user, cookie } = await establishSession(request);
    const headers = new Headers({ "Cache-Control": "no-store" });
    if (cookie) headers.set("Set-Cookie", cookie);
    return Response.json({ canCreate: true, displayName: user.displayName }, { headers });
  } catch (error) {
    const forbidden = error instanceof Error && error.message === "ORIGIN_REJECTED";
    return Response.json({ error: forbidden ? "请从本站打开游戏" : "无法建立访客身份，请刷新重试" }, { status: forbidden ? 403 : 503 });
  }
}
