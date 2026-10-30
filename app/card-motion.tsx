import { playbackDuration } from "../lib/motion";
import type { GameEvent } from "../lib/poker";

export function CardMotion({ event, relativeSeat, reduced }: { event: GameEvent; relativeSeat: number | "board"; reduced: boolean }) {
  return (
    <div className={`card-motion motion-${event.type} motion-seat-${relativeSeat}${reduced ? " motion-reduced" : ""}`} style={{ animationDuration: `${playbackDuration(event, reduced)}ms` }} aria-hidden="true" data-card-event={event.type}>
      <div className="card card-back"><span className="gpt-mark" /></div>
      {event.type === "fold" && <div className="card card-back fold-second-card"><span className="gpt-mark" /></div>}
    </div>
  );
}
