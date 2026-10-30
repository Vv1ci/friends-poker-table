"use client";
import { useState } from "react";
import { formatChips, legalActions, type GameState, type PlayerAction } from "../lib/poker";
import { betPresets, clampRaiseTarget, defaultRaiseTarget, describeTarget, formatBB, sliderRange } from "../lib/bet-sizing";

export function BettingPanel({ game, seat, busy, onAction }: { game: GameState; seat: number; busy: boolean; onAction: (action: PlayerAction) => void }) {
  const legal = legalActions(game,seat);
  const [selected,setSelected] = useState(() => defaultRaiseTarget(game,seat));
  const amount = clampRaiseTarget(game,seat,selected);
  const range = sliderRange(game,seat);
  const label = game.currentBet>0 ? "加注至" : "下注";
  return <>
    {legal.canRaise && <div className="bet-sizing-panel">
      <div className="bet-presets" aria-label="快捷下注金额">{betPresets(game,seat).map(p=><button key={p.id} type="button" aria-pressed={!p.disabled && amount===p.target} onClick={()=>setSelected(p.target)} disabled={busy || p.disabled} title={p.disabled ? `超出可下注范围：${describeTarget(game,legal.minTarget)} 至 ${describeTarget(game,legal.maxTarget)}` : describeTarget(game,p.target)}>{p.label}</button>)}</div>
      <div className="bet-slider-row">
        <input className="amount-slider" type="range" min={0} max={range.last} step={1} value={range.index(amount)} onChange={e=>setSelected(range.at(Number(e.target.value)))} disabled={busy || range.last===0} aria-label="下注金额，末端全下" aria-valuetext={describeTarget(game,amount)} />
        <output className="bet-amount" aria-live="polite" aria-label={`${label} ${describeTarget(game,amount)}`} title={`${label} ${amount.toLocaleString("en-US")} 筹码`}><strong>{formatBB(amount,game.bigBlind)}</strong><span>{formatChips(amount)} 筹码</span></output>
      </div>
    </div>}
    <div className="action-buttons">
      <button className="action-button fold-button" disabled={busy} onClick={()=>onAction({type:"fold"})}>弃牌</button>
      <button className="action-button" disabled={busy} onClick={()=>onAction(legal.canCheck?{type:"check"}:{type:"call"})}>{legal.canCheck?"过牌":`跟注 ${formatChips(Math.min(legal.call,game.players[seat].chips))}`}</button>
      {legal.canRaise && <button className="action-button raise-button" disabled={busy} onClick={()=>onAction({type:"raise",amount})} aria-label={`${amount===legal.maxTarget ? "全下至" : label} ${describeTarget(game,amount)}`}>{amount===legal.maxTarget ? "全下" : game.currentBet>0 ? "加注" : "下注"}</button>}
    </div>
  </>;
}
