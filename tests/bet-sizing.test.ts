import assert from "node:assert/strict";
import test from "node:test";
import { createInitialGame, legalActions } from "../lib/poker";
import { betPresets, defaultRaiseTarget, sliderRange, clampRaiseTarget, formatBB, formatBigBlinds, describeTarget } from "../lib/bet-sizing";
import { canPresentTurn } from "../lib/presentation";

function fixture() {
  const game = createInitialGame(2000);
  game.street="preflop"; game.currentBet=20; game.minRaise=20;
  game.players[1].contributed=10; game.players[2].contributed=20;
  return game;
}
test("unopened preflop pot uses BB presets and defaults to 2.5 BB",()=>{
  const game=fixture();
  assert.deepEqual(betPresets(game,0).map(p=>p.target),[40,50,60,80]);
  assert.equal(defaultRaiseTarget(game,0),50);assert.equal(formatBB(50,20),"2.5 BB");
});
test("BB presets below the legal reraise are disabled without changing their amounts",()=>{
  const game=fixture();game.currentBet=50;game.minRaise=30;
  assert.deepEqual(betPresets(game,0).map(p=>p.target),[40,50,60,80]);
  assert.deepEqual(betPresets(game,0).map(p=>p.disabled),[true,true,true,false]);
  assert.equal(defaultRaiseTarget(game,0),80);
});
test("postflop keeps the same four BB choices regardless of pot size",()=>{
  const game=fixture();game.street="flop";game.currentBet=0;
  game.players[1].contributed=100;game.players[2].contributed=100;
  assert.deepEqual(betPresets(game,0).map(p=>p.target),[40,50,60,80]);
  assert.equal(defaultRaiseTarget(game,0),50);
  game.currentBet=20;game.players[1].contributed=50;game.players[2].contributed=50;
  assert.deepEqual(betPresets(game,0).map(p=>p.target),[40,50,60,80]);
});
test("slider reaches an odd all-in exactly; manual integer amounts remain legal",()=>{
  const game=fixture();game.currentBet=50;game.minRaise=30;game.players[0].chips=113;
  const slider=sliderRange(game,0);
  assert.equal(slider.at(0),80);assert.equal(slider.at(1),90);
  assert.equal(slider.at(slider.last),113);assert.equal(slider.index(113),slider.last);
  assert.equal(clampRaiseTarget(game,0,83),83);
  for(let i=0;i<=slider.last;i++)assert.ok(slider.at(i)>=80 && slider.at(i)<=113);
});
test("short-stack all-in remains exact when all four shortcuts are unavailable",()=>{
  const game=fixture();game.currentBet=100;game.minRaise=100;game.players[0].chips=113;
  const presets=betPresets(game,0);
  assert.equal(legalActions(game,0).minTarget,113);
  assert.equal(presets.length,4);assert.ok(presets.every(p=>p.disabled));
  assert.equal(defaultRaiseTarget(game,0),113);assert.equal(sliderRange(game,0).at(0),113);
  game.players[0].chips=40;assert.deepEqual(betPresets(game,0),[]);
});
test("turn presentation waits for unseen events, local playback and server gate",()=>{
  assert.equal(canPresentTurn(1000,2000,0,true),false);
  assert.equal(canPresentTurn(1000,2000,1,false),false);
  assert.equal(canPresentTurn(3000,2000,0,false),false);
  assert.equal(canPresentTurn(2000,2000,0,false),true);
  assert.equal(canPresentTurn(null,2000,0,false),true);
});
test("large chip and BB readouts use compact K and M units",()=>{
  const game=fixture();
  assert.equal(describeTarget(game,1250),"62.5 BB · 1.25K 筹码");
  assert.equal(describeTarget(game,2500000),"125.0K BB · 2.5M 筹码");
  assert.equal(formatBB(20000000,20),"1.0M BB");
});

test("BB readout keeps one decimal and carries fractional tenths into the next whole BB",()=>{
  assert.deepEqual([25,26,27,28,29,30].map(tenths=>formatBigBlinds(tenths/10)),
    ["2.5 BB","2.6 BB","2.7 BB","2.8 BB","2.9 BB","3.0 BB"]);
  assert.deepEqual(betPresets(fixture(),0).map(p=>p.label),["2.0 BB","2.5 BB","3.0 BB","4.0 BB"]);
  const game=fixture();game.players[0].chips=113;
  assert.equal(sliderRange(game,0).at(sliderRange(game,0).last),113);
  assert.equal(describeTarget(game,113),"5.7 BB · 113 筹码");
});
