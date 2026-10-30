import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CardMotion } from "../app/card-motion";
import { playbackDuration, resolveMotionPreference } from "../lib/motion";

test("explicit animation on survives a system reduced-motion preference", () => {
  assert.equal(resolveMotionPreference("false", true), false);
  assert.equal(resolveMotionPreference("true", false), true);
  assert.equal(resolveMotionPreference(null, true), true);
  assert.equal(resolveMotionPreference(null, false), false);
});

for (const reduced of [false, true]) {
  test(`deal and fold retain a visible playback element (reduced=${reduced})`, () => {
    for (const type of ["deal-hole", "deal-community", "burn", "fold"] as const) {
      const event = { id: 1, type, seat: 0 };
      const html = renderToStaticMarkup(<CardMotion event={event} relativeSeat={0} reduced={reduced} />);
      assert.match(html, new RegExp(`data-card-event="${type}"`));
      assert.match(html, /card card-back/);
      assert.ok(playbackDuration(event, reduced) >= 100);
      if (type === "fold") assert.match(html, /fold-second-card/);
    }
  });
}
