// Anonymous credentials never come from player names or client-supplied user IDs.
export const SESSION_SECONDS = 30 * 24 * 60 * 60;
export function cookieName(request: Request): string {
  return new URL(request.url).protocol === "https:" ? "__Host-poker-session" : "poker-session";
}
export function sessionToken(request: Request): string | null {
  const prefix = cookieName(request) + "=";
  const value = (request.headers.get("cookie") ?? "").split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix))?.slice(prefix.length);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
}
export function newSessionToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export async function hashSessionToken(token: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function sessionCookie(request: Request, token: string): string {
  return `${cookieName(request)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin !== new URL(request.url).origin || !request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new Error("ORIGIN_REJECTED");
  }
}
export function playerName(value: unknown, fallback = "访客玩家"): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 24) || fallback : fallback;
}
