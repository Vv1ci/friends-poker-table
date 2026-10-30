import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BettingPanel } from "../app/betting-panel";
import { createInitialGame } from "../lib/poker";

test("betting panel keeps only four BB shortcuts, a slider and its chips/BB readout",()=>{
  const game=createInitialGame(2000);game.street="preflop";game.currentBet=20;game.minRaise=20;
  const html=renderToStaticMarkup(<BettingPanel game={game} seat={0} busy={false} onAction={()=>{}} />);
  for(const label of ["2 BB","2.5 BB","3 BB","4 BB"])assert.match(html,new RegExp(`>${label}<`));
  assert.equal((html.match(/type="range"/g)??[]).length,1);
  assert.match(html,/<output[^>]*class="bet-amount"/);assert.match(html,/50 筹码/);
  assert.doesNotMatch(html,/type="number"|减少|增加|底池|amount-editor/);
});

test("postflop keeps the BB panel and disables unavailable shortcut amounts",()=>{
  const game=createInitialGame(2000);game.street="flop";game.currentBet=100;game.minRaise=100;
  game.players[1].contributed=200;
  const html=renderToStaticMarkup(<BettingPanel game={game} seat={0} busy={false} onAction={()=>{}} />);
  assert.match(html,/disabled=""[^>]*>2 BB/);assert.match(html,/10 BB/);assert.match(html,/200 筹码/);
  assert.doesNotMatch(html,/底池|½|满池/);
});
