import { formatChips, legalActions, type GameState } from "./poker";

export type BetPreset = { id: string; label: string; target: number; disabled: boolean };
export function formatBB(chips: number, bigBlind: number): string {
  const value = chips / Math.max(1, bigBlind);
  return `${Math.abs(value) >= 1000 ? formatChips(value) : Number(value.toFixed(2))} BB`;
}
export function clampRaiseTarget(game: GameState, seat: number, target: number): number {
  const legal = legalActions(game, seat);
  return Math.min(legal.maxTarget, Math.max(legal.minTarget, Math.round(Number.isFinite(target) ? target : legal.minTarget)));
}
export function betPresets(game: GameState, seat: number): BetPreset[] {
  const legal = legalActions(game, seat);
  if (!legal.canRaise) return [];
  return [2, 2.5, 3, 4].map(bb => {
    const target = Math.round(bb * game.bigBlind);
    return { id: `bb-${bb}`, label: `${bb} BB`, target, disabled: target < legal.minTarget || target > legal.maxTarget };
  });
}
export function defaultRaiseTarget(game: GameState, seat: number): number {
  return clampRaiseTarget(game, seat, 2.5 * game.bigBlind);
}
export function sliderRange(game: GameState, seat: number) {
  const { minTarget, maxTarget } = legalActions(game,seat);
  const step = Math.max(1, Math.round(game.bigBlind/2));
  const last = Math.ceil((maxTarget-minTarget)/step);
  return {last, at:(index:number)=>Math.min(maxTarget,minTarget+Math.max(0,Math.min(last,Math.round(index)))*step),
    index:(target:number)=>target>=maxTarget ? last : Math.max(0,Math.min(last,Math.round((target-minTarget)/step)))};
}
export function describeTarget(game: GameState, target: number): string {
  return `${formatBB(target,game.bigBlind)} · ${formatChips(target)} 筹码`;
}
