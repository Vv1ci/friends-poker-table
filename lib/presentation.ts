export function canPresentTurn(actionReadyAt: number | null | undefined, now: number, queued: number, unseen: boolean): boolean {
  return !unseen && queued === 0 && (!actionReadyAt || now >= actionReadyAt);
}
