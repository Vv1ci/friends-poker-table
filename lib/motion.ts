import type { GameEvent } from "./poker";

// Shared by server action gates, client playback and inline CSS durations.
export function eventDuration(event: GameEvent): number {
  return event.type === "deal-hole" ? 320 : event.type === "burn" ? 240 : event.type === "deal-community" ? 360 : 300;
}
export function playbackDuration(event: GameEvent, reduced: boolean): number {
  return reduced ? 140 : eventDuration(event);
}
// Versioned so old system-derived/off settings do not override the new animation-on default.
export const MOTION_PREFERENCE_KEY = "poker-reduced-motion-v2";
export function resolveMotionPreference(saved: string | null): boolean {
  return saved === "true";
}
export function sequenceDuration(events: GameEvent[]): number {
  return events.length ? events.reduce((total, event) => total + eventDuration(event), 0) + 180 : 0;
}
