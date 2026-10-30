import type { GameEvent } from "./poker";

// Shared by server action gates, client playback and inline CSS durations.
export function eventDuration(event: GameEvent): number {
  return event.type === "deal-hole" ? 320 : event.type === "burn" ? 240 : event.type === "deal-community" ? 360 : 300;
}
export function playbackDuration(event: GameEvent, reduced: boolean): number {
  return reduced ? 140 : eventDuration(event);
}
export function resolveMotionPreference(saved: string | null, systemReduced: boolean): boolean {
  if (saved === "true") return true;
  if (saved === "false") return false;
  return systemReduced;
}
export function sequenceDuration(events: GameEvent[]): number {
  return events.length ? events.reduce((total, event) => total + eventDuration(event), 0) + 180 : 0;
}
