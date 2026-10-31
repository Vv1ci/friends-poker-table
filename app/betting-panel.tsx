"use client";
import { useState, type CSSProperties } from "react";
import { formatChips, legalActions, type GameState, type PlayerAction } from "../lib/poker";
import { betPresets, clampRaiseTarget, defaultRaiseTarget, describeTarget, formatBigBlinds, sliderRange } from "../lib/bet-sizing";
import { useAnimatedAmount } from "./animated-amount";

export function BettingPanel({ game, seat, busy, reducedMotion = false, secondsRemaining = null, onAction }: { game: GameState; seat: number; busy: boolean; reducedMotion?: boolean; secondsRemaining?: number | null; onAction: (action: PlayerAction) => void }) {
  const legal = legalActions(game,seat);
  const [selected,setSelected] = useState(() => defaultRaiseTarget(game,seat));
  const amount = clampRaiseTarget(game,seat,selected);
  const displayAmount = useAnimatedAmount(amount, reducedMotion);
  // Count tenths directly so 2.5 → 3.0 carries through 2.6, 2.7, 2.8, 2.9.
  const displayBBTenths = useAnimatedAmount(Math.round(amount / Math.max(1, game.bigBlind) * 10), reducedMotion, true);
  const range = sliderRange(game,seat);
  const label = game.currentBet>0 ? "加注至" : "下注";
  return <>
    <div className="bet-sizing-heading"><span>{legal.canRaise ? label : "请选择行动"}</span><div className="your-turn"><span>轮到你行动</span>{secondsRemaining !== null && <span className={secondsRemaining <= 5 ? "turn-urgent" : ""}>剩余 <strong>{secondsRemaining}s</strong></span>}</div></div>
    {legal.canRaise && <div className="bet-sizing-panel" aria-busy={busy}>
      <div className="bet-presets" aria-label="快捷下注金额">{betPresets(game,seat).map(p=><button key={p.id} type="button" aria-pressed={!p.disabled && amount===p.target} onClick={()=>setSelected(p.target)} disabled={busy || p.disabled} title={p.disabled ? `超出可下注范围：${describeTarget(game,legal.minTarget)} 至 ${describeTarget(game,legal.maxTarget)}` : describeTarget(game,p.target)}>{p.label}</button>)}</div>
      <div className="bet-slider-row">
        <input className="amount-slider" style={{"--slider-fill":`${range.last ? range.index(amount)/range.last*100 : 0}%`} as CSSProperties} type="range" min={0} max={range.last} step={1} value={range.index(amount)} onChange={e=>setSelected(range.at(Number(e.target.value)))} disabled={busy || range.last===0} aria-label="下注金额，末端全下" aria-valuetext={describeTarget(game,amount)} />
        <output className="bet-amount" aria-label={`${label} ${describeTarget(game,amount)}`} title={`${label} ${amount.toLocaleString("en-US")} 筹码`}><strong aria-hidden="true">{formatBigBlinds(displayBBTenths / 10)}</strong><span aria-hidden="true">{formatChips(displayAmount)} 筹码</span></output>
      </div>
    </div>}
    <div className="action-buttons">
      <button className="action-button fold-button" disabled={busy} onClick={()=>onAction({type:"fold"})}>弃牌</button>
      <button className="action-button" disabled={busy} onClick={()=>onAction(legal.canCheck?{type:"check"}:{type:"call"})}>{legal.canCheck?"过牌":`跟注 ${formatChips(Math.min(legal.call,game.players[seat].chips))}`}</button>
      {legal.canRaise && <button className="action-button raise-button" disabled={busy} onClick={()=>onAction({type:"raise",amount})} aria-label={`${amount===legal.maxTarget ? "全下至" : label} ${describeTarget(game,amount)}`}>{amount===legal.maxTarget ? "全下" : game.currentBet>0 ? "加注" : "下注"}</button>}
    </div>
  </>;
}
