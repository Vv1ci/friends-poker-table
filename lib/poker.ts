export type Suit = "♠" | "♥" | "♦" | "♣";
export type Street = "waiting" | "preflop" | "flop" | "turn" | "river" | "showdown";

export interface Card {
  rank: number;
  suit: Suit;
}

export interface Player {
  id: string;
  name: string;
  avatar: string;
  chips: number;
  hole: Card[];
  folded: boolean;
  allIn: boolean;
  bet: number;
  contributed: number;
  acted: boolean;
  isBot: boolean;
  style: "steady" | "tight" | "bold" | "wild";
  lastAction: string;
  won: number;
  returned: number;
}

export interface PotAward {
  playerIndex: number;
  amount: number;
  potKind: "pot" | "main" | "side";
  potNumber: number;
  handName: string;
  uncontested: boolean;
  split: boolean;
}

export interface GameEvent {
  id: number;
  type: "deal-hole" | "burn" | "deal-community" | "fold";
  seat?: number;
  communityIndex?: number;
}

export interface GameState {
  players: Player[];
  dealer: number;
  startingChips: number;
  smallBlind: number;
  bigBlind: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
  deck: Card[];
  community: Card[];
  burned: number;
  street: Street;
  active: number;
  currentBet: number;
  minRaise: number;
  handNumber: number;
  handOver: boolean;
  message: string;
  log: string[];
  turnToken: number;
  potAwards: PotAward[];
  endReason: "fold" | "showdown" | null;
  revealedPlayers: number[];
  autoRunout: boolean;
  eventCounter: number;
  events: GameEvent[];
}

export type PlayerAction =
  | { type: "fold" }
  | { type: "check" }
  | { type: "call" }
  | { type: "raise"; amount: number };

export interface HandValue {
  category: number;
  tiebreak: number[];
  name: string;
}

const SUITS: Suit[] = ["♠", "♥", "♦", "♣"];
const RANKS = Array.from({ length: 13 }, (_, index) => index + 2);
const HAND_NAMES = ["高牌", "一对", "两对", "三条", "顺子", "同花", "葫芦", "四条", "同花顺"];

export function formatChips(amount: number): string {
  const value = Math.round(amount);
  const absolute = Math.abs(value);
  const units = [
    { threshold: 1_000_000_000, suffix: "B" },
    { threshold: 1_000_000, suffix: "M" },
    { threshold: 1_000, suffix: "K" },
  ];
  const unit = units.find((candidate) => absolute >= candidate.threshold);
  if (!unit) return value.toLocaleString("en-US");
  const scaled = value / unit.threshold;
  const digits = Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : 2;
  return `${Number(scaled.toFixed(digits))}${unit.suffix}`;
}

export function blindStructure(startingChips: number): { smallBlind: number; bigBlind: number } {
  const smallBlind = Math.max(1, Math.round(startingChips / 200));
  return { smallBlind, bigBlind: smallBlind * 2 };
}

const BASE_PLAYERS: Omit<Player, "hole" | "folded" | "allIn" | "bet" | "contributed" | "acted" | "lastAction" | "won" | "returned">[] = [
  { id: "hero", name: "访客玩家", avatar: "你", chips: 2000, isBot: false, style: "steady" },
  { id: "lin", name: "林舟", avatar: "林", chips: 2000, isBot: true, style: "tight" },
  { id: "mia", name: "Mia", avatar: "M", chips: 2000, isBot: true, style: "steady" },
  { id: "rook", name: "Rook", avatar: "R", chips: 2000, isBot: true, style: "bold" },
  { id: "chen", name: "阿澈", avatar: "澈", chips: 2000, isBot: true, style: "steady" },
  { id: "nova", name: "Nova", avatar: "N", chips: 2000, isBot: true, style: "wild" },
];

function freshPlayer(base: (typeof BASE_PLAYERS)[number], startingChips = base.chips): Player {
  return { ...base, chips: startingChips, hole: [], folded: false, allIn: false, bet: 0, contributed: 0, acted: false, lastAction: "等待", won: 0, returned: 0 };
}

export function createInitialGame(startingChips = 2000): GameState {
  const blinds = blindStructure(startingChips);
  return {
    players: BASE_PLAYERS.map((player) => freshPlayer(player, startingChips)), dealer: -1, startingChips, ...blinds,
    smallBlindSeat: -1, bigBlindSeat: -1,
    deck: [], community: [], street: "waiting", active: -1, currentBet: 0,
    minRaise: 20, handNumber: 0, handOver: false, message: "5 位策略对手正在等待",
    log: ["牌桌已就绪"], turnToken: 0, potAwards: [], burned: 0,
    endReason: null, revealedPlayers: [], autoRunout: false, eventCounter: 0, events: [],
  };
}

function secureRandom(): number {
  if (globalThis.crypto?.getRandomValues) {
    const value = new Uint32Array(1);
    globalThis.crypto.getRandomValues(value);
    return value[0] / 0x1_0000_0000;
  }
  return Math.random();
}

function shuffledDeck(): Card[] {
  const deck = SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit })));
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(secureRandom() * (index + 1));
    [deck[index], deck[swap]] = [deck[swap], deck[index]];
  }
  return deck;
}

function nextIndex(players: Player[], from: number, predicate: (player: Player) => boolean): number {
  for (let offset = 1; offset <= players.length; offset += 1) {
    const index = (from + offset + players.length) % players.length;
    if (predicate(players[index])) return index;
  }
  return -1;
}

function commit(player: Player, requested: number): number {
  const paid = Math.max(0, Math.min(player.chips, requested));
  player.chips -= paid;
  player.bet += paid;
  player.contributed += paid;
  player.allIn = player.chips === 0;
  return paid;
}

export function startNextHand(previous: GameState): GameState {
  const players: Player[] = previous.players.map((player) => ({
    ...player,
    hole: [] as Card[],
    folded: player.chips <= 0,
    allIn: false,
    bet: 0,
    contributed: 0,
    acted: false,
    lastAction: player.chips > 0 ? "等待" : "淘汰",
    won: 0,
    returned: 0,
  }));

  const participating = (player: Player) => player.chips > 0;
  const activeCount = players.filter(participating).length;
  if (activeCount < 2) throw new Error("NOT_ENOUGH_PLAYERS");
  const dealer = nextIndex(players, previous.dealer, participating);
  const smallBlindIndex = activeCount === 2 ? dealer : nextIndex(players, dealer, participating);
  const bigBlindIndex = nextIndex(players, smallBlindIndex, participating);
  const deck = shuffledDeck();
  const events: GameEvent[] = [];
  let eventCounter = 0;

  for (let round = 0; round < 2; round += 1) {
    let index = smallBlindIndex;
    for (let dealt = 0; dealt < activeCount; dealt += 1) {
      players[index].hole.push(deck.pop()!);
      eventCounter += 1;
      events.push({ id: eventCounter, type: "deal-hole", seat: index });
      index = nextIndex(players, index, participating);
    }
  }

  commit(players[smallBlindIndex], previous.smallBlind);
  players[smallBlindIndex].lastAction = `小盲 ${formatChips(players[smallBlindIndex].bet)}`;
  commit(players[bigBlindIndex], previous.bigBlind);
  players[bigBlindIndex].lastAction = `大盲 ${formatChips(players[bigBlindIndex].bet)}`;
  const firstToAct = activeCount === 2 ? dealer : nextIndex(players, bigBlindIndex, participating);
  const active = players[firstToAct].allIn
    ? nextIndex(players, firstToAct, (player) => !player.folded && !player.allIn && player.chips > 0)
    : firstToAct;
  const actionable = players.filter((player) => !player.folded && !player.allIn && player.chips > 0);
  const autoRunout = active < 0 || (actionable.length === 1 && actionable[0].bet === Math.max(players[smallBlindIndex].bet, players[bigBlindIndex].bet));

  return {
    ...previous,
    players,
    dealer,
    smallBlindSeat: smallBlindIndex,
    bigBlindSeat: bigBlindIndex,
    deck,
    community: [],
    burned: 0,
    street: "preflop",
    active: autoRunout ? -1 : active,
    currentBet: Math.max(players[smallBlindIndex].bet, players[bigBlindIndex].bet),
    minRaise: previous.bigBlind,
    handNumber: previous.handNumber + 1,
    handOver: false,
    message: `第 ${previous.handNumber + 1} 手 · 翻牌前`,
    log: [`第 ${previous.handNumber + 1} 手开始`, `${players[smallBlindIndex].name} 下小盲`, `${players[bigBlindIndex].name} 下大盲`],
    turnToken: previous.turnToken + 1,
    potAwards: [],
    endReason: null,
    revealedPlayers: [],
    autoRunout,
    eventCounter,
    events,
  };
}

function comparison(left: HandValue, right: HandValue): number {
  if (left.category !== right.category) return left.category - right.category;
  const length = Math.max(left.tiebreak.length, right.tiebreak.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left.tiebreak[index] ?? 0) - (right.tiebreak[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function straightHigh(ranks: number[]): number {
  const unique = [...new Set(ranks)].sort((a, b) => b - a);
  if (unique.includes(14)) unique.push(1);
  let run = 1;
  for (let index = 1; index < unique.length; index += 1) {
    if (unique[index - 1] - unique[index] === 1) run += 1;
    else run = 1;
    if (run >= 5) return unique[index] + 4;
  }
  return 0;
}

function fiveCardValue(cards: Card[]): HandValue {
  const ranks = cards.map((card) => card.rank).sort((a, b) => b - a);
  const flush = cards.every((card) => card.suit === cards[0].suit);
  const straight = straightHigh(ranks);
  const counts = [...new Set(ranks)]
    .map((rank) => ({ rank, count: ranks.filter((value) => value === rank).length }))
    .sort((a, b) => b.count - a.count || b.rank - a.rank);

  if (flush && straight) return { category: 8, tiebreak: [straight], name: HAND_NAMES[8] };
  if (counts[0].count === 4) return { category: 7, tiebreak: [counts[0].rank, counts[1].rank], name: HAND_NAMES[7] };
  if (counts[0].count === 3 && counts[1].count === 2) return { category: 6, tiebreak: [counts[0].rank, counts[1].rank], name: HAND_NAMES[6] };
  if (flush) return { category: 5, tiebreak: ranks, name: HAND_NAMES[5] };
  if (straight) return { category: 4, tiebreak: [straight], name: HAND_NAMES[4] };
  if (counts[0].count === 3) return { category: 3, tiebreak: [counts[0].rank, ...counts.slice(1).map((item) => item.rank).sort((a, b) => b - a)], name: HAND_NAMES[3] };
  if (counts[0].count === 2 && counts[1].count === 2) {
    const pairs = [counts[0].rank, counts[1].rank].sort((a, b) => b - a);
    return { category: 2, tiebreak: [...pairs, counts[2].rank], name: HAND_NAMES[2] };
  }
  if (counts[0].count === 2) return { category: 1, tiebreak: [counts[0].rank, ...counts.slice(1).map((item) => item.rank).sort((a, b) => b - a)], name: HAND_NAMES[1] };
  return { category: 0, tiebreak: ranks, name: HAND_NAMES[0] };
}

export function bestHand(cards: Card[]): HandValue {
  if (cards.length < 5) return { category: 0, tiebreak: cards.map((card) => card.rank).sort((a, b) => b - a), name: HAND_NAMES[0] };
  let best: HandValue | null = null;
  for (let a = 0; a < cards.length - 4; a += 1)
    for (let b = a + 1; b < cards.length - 3; b += 1)
      for (let c = b + 1; c < cards.length - 2; c += 1)
        for (let d = c + 1; d < cards.length - 1; d += 1)
          for (let e = d + 1; e < cards.length; e += 1) {
            const value = fiveCardValue([cards[a], cards[b], cards[c], cards[d], cards[e]]);
            if (!best || comparison(value, best) > 0) best = value;
          }
  return best!;
}

function winnersFor(players: Player[], eligible: number[], community: Card[]): number[] {
  let winners: number[] = [];
  let best: HandValue | null = null;
  for (const index of eligible) {
    const value = bestHand([...players[index].hole, ...community]);
    const result = best ? comparison(value, best) : 1;
    if (result > 0) { best = value; winners = [index]; }
    else if (result === 0) winners.push(index);
  }
  return winners;
}

function finishByFold(state: GameState, winner: number): GameState {
  const players = state.players.map((player) => ({ ...player, won: 0, returned: 0 }));
  const contributions = players
    .map((player, index) => ({ index, amount: player.contributed }))
    .sort((left, right) => right.amount - left.amount);
  if (contributions[0]?.index === winner && contributions[0].amount > (contributions[1]?.amount ?? 0)) {
    const unmatched = contributions[0].amount - (contributions[1]?.amount ?? 0);
    players[winner].chips += unmatched;
    players[winner].contributed -= unmatched;
    players[winner].bet = Math.max(0, players[winner].bet - unmatched);
    players[winner].returned = unmatched;
  }
  const adjustedAmount = players.reduce((sum, player) => sum + player.contributed, 0);
  players[winner].chips += adjustedAmount;
  players[winner].won = adjustedAmount;
  const potAwards: PotAward[] = [{
    playerIndex: winner,
    amount: adjustedAmount,
    potKind: "pot",
    potNumber: 0,
    handName: "其他玩家弃牌",
    uncontested: true,
    split: false,
  }];
  const returned = players[winner].returned > 0 ? ` · 退回 ${formatChips(players[winner].returned)}（未被跟注）` : "";
  const summary = `${players[winner].name} 底池 +${formatChips(adjustedAmount)}（其他玩家弃牌）${returned}`;
  return {
    ...state,
    players,
    active: -1,
    handOver: true,
    message: summary,
    log: [...state.log, summary],
    turnToken: state.turnToken + 1,
    potAwards,
    endReason: "fold",
    autoRunout: false,
  };
}

function potLabel(award: PotAward, sidePotCount: number): string {
  if (award.potKind === "pot") return "底池";
  if (award.potKind === "main") return "主池";
  return sidePotCount > 1 ? `边池 ${award.potNumber}` : "边池";
}

function awardSummary(award: PotAward, players: Player[], sidePotCount: number): string {
  const notes = [award.handName];
  if (award.uncontested && award.potKind === "side") notes.push("其他有效玩家已弃牌");
  else if (award.split) notes.push("平分");
  return `${players[award.playerIndex].name} ${potLabel(award, sidePotCount)} +${formatChips(award.amount)}（${notes.join("，")}）`;
}

function showdown(state: GameState): GameState {
  const players = state.players.map((player) => ({ ...player, won: 0, returned: 0 }));
  const deck = [...state.deck];
  const community = [...state.community];
  if (community.length !== 5) throw new Error("BOARD_INCOMPLETE");

  const contributions = players
    .map((player, index) => ({ index, amount: player.contributed }))
    .sort((left, right) => right.amount - left.amount);
  if (contributions[0]?.amount > (contributions[1]?.amount ?? 0)) {
    const unmatched = contributions[0].amount - (contributions[1]?.amount ?? 0);
    const player = players[contributions[0].index];
    player.chips += unmatched;
    player.contributed -= unmatched;
    player.bet = Math.max(0, player.bet - unmatched);
    player.returned = unmatched;
  }

  const levels = [...new Set(players.map((player) => player.contributed).filter((amount) => amount > 0))].sort((a, b) => a - b);
  const pools: Array<{ amount: number; eligible: number[] }> = [];
  let previous = 0;
  for (const level of levels) {
    const involved = players.map((player, index) => ({ player, index })).filter(({ player }) => player.contributed >= level);
    const amount = (level - previous) * involved.length;
    const eligible = involved.filter(({ player }) => !player.folded).map(({ index }) => index);
    if (eligible.length) {
      const previousPool = pools.at(-1);
      if (previousPool && previousPool.eligible.join(",") === eligible.join(",")) previousPool.amount += amount;
      else pools.push({ amount, eligible });
    }
    previous = level;
  }

  const potAwards: PotAward[] = [];
  pools.forEach((pool, poolIndex) => {
    const winners = winnersFor(players, pool.eligible, community);
    const share = Math.floor(pool.amount / winners.length);
    let remainder = pool.amount - share * winners.length;
    for (const winner of winners) {
      const amount = share + (remainder > 0 ? 1 : 0);
      remainder = Math.max(0, remainder - 1);
      players[winner].chips += amount;
      players[winner].won += amount;
      potAwards.push({
        playerIndex: winner,
        amount,
        potKind: poolIndex === 0 ? "main" : "side",
        potNumber: poolIndex,
        handName: bestHand([...players[winner].hole, ...community]).name,
        uncontested: pool.eligible.length === 1,
        split: winners.length > 1,
      });
    }
  });

  const sidePotCount = Math.max(0, pools.length - 1);
  const payoutSummary = potAwards.map((award) => awardSummary(award, players, sidePotCount)).join(" · ");
  const refunds = players
    .filter((player) => player.returned > 0)
    .map((player) => `${player.name} 退回 ${formatChips(player.returned)}（未被跟注）`)
    .join(" · ");
  const logSummary = [payoutSummary, refunds].filter(Boolean).join(" · ");
  return {
    ...state,
    players,
    deck,
    community,
    active: -1,
    street: "showdown",
    handOver: true,
    message: payoutSummary || "底池已结算",
    log: [...state.log, `摊牌：${logSummary}`],
    turnToken: state.turnToken + 1,
    potAwards,
    endReason: "showdown",
    autoRunout: false,
  };
}

function nextStreet(state: GameState): GameState {
  if (state.street === "river") return showdown(state);
  const deck = [...state.deck];
  const community = [...state.community];
  const events = [...(state.events ?? [])];
  let eventCounter = state.eventCounter ?? events.at(-1)?.id ?? 0;
  const street: Street = state.street === "preflop" ? "flop" : state.street === "flop" ? "turn" : "river";
  const draw = street === "flop" ? 3 : 1;
  deck.pop();
  eventCounter += 1;
  events.push({ id: eventCounter, type: "burn" });
  for (let index = 0; index < draw; index += 1) {
    community.push(deck.pop()!);
    eventCounter += 1;
    events.push({ id: eventCounter, type: "deal-community", communityIndex: community.length - 1 });
  }
  const players = state.players.map((player) => ({ ...player, bet: 0, acted: false, lastAction: player.folded ? "弃牌" : player.allIn ? "全下" : "等待" }));
  const actionable = players.filter((player) => !player.folded && !player.allIn && player.chips > 0);
  const autoRunout = actionable.length <= 1;
  const next = {
    ...state,
    players,
    deck,
    community,
    burned: (state.burned ?? 0) + 1,
    street,
    currentBet: 0,
    minRaise: state.bigBlind,
    message: street === "flop" ? "翻牌" : street === "turn" ? "转牌" : "河牌",
    turnToken: state.turnToken + 1,
    events,
    eventCounter,
    autoRunout,
  };
  return { ...next, active: autoRunout ? -1 : nextIndex(players, state.dealer, (player) => !player.folded && !player.allIn && player.chips > 0) };
}

export function advanceAutomaticRunout(state: GameState): GameState {
  if (state.handOver || !state.autoRunout) throw new Error("AUTO_RUNOUT_NOT_READY");
  return nextStreet(state);
}

export function revealRemainingCommunity(state: GameState): GameState {
  if (!state.handOver || state.endReason !== "fold" || state.community.length >= 5) throw new Error("BOARD_REVEAL_NOT_READY");
  const deck = [...state.deck];
  const community = [...state.community];
  const events = [...(state.events ?? [])];
  let burned = state.burned ?? 0;
  let eventCounter = state.eventCounter ?? events.at(-1)?.id ?? 0;
  while (community.length < 5) {
    deck.pop();
    burned += 1;
    eventCounter += 1;
    events.push({ id: eventCounter, type: "burn" });
    const draw = community.length === 0 ? 3 : 1;
    for (let index = 0; index < draw && community.length < 5; index += 1) {
      community.push(deck.pop()!);
      eventCounter += 1;
      events.push({ id: eventCounter, type: "deal-community", communityIndex: community.length - 1 });
    }
  }
  return {
    ...state,
    deck,
    community,
    burned,
    events,
    eventCounter,
    log: [...state.log, "房主公开了本轮剩余公牌（不影响结算）"],
    turnToken: state.turnToken + 1,
  };
}

export function revealPlayerHole(state: GameState, playerIndex: number): GameState {
  const player = state.players[playerIndex];
  const isUncontestedWinner = state.endReason === "fold" && (state.potAwards ?? []).some((award) => award.playerIndex === playerIndex);
  if (!state.handOver || !player || (!player.folded && !isUncontestedWinner)) throw new Error("HOLE_REVEAL_NOT_ALLOWED");
  if ((state.revealedPlayers ?? []).includes(playerIndex)) return state;
  return {
    ...state,
    revealedPlayers: [...(state.revealedPlayers ?? []), playerIndex],
    log: [...state.log, `${player.name} 亮出了手牌`],
    turnToken: state.turnToken + 1,
  };
}

function bettingComplete(players: Player[], currentBet: number): boolean {
  return players.filter((player) => !player.folded && !player.allIn && player.chips > 0).every((player) => player.acted && player.bet === currentBet);
}

export function applyAction(state: GameState, action: PlayerAction): GameState {
  if (state.handOver || state.active < 0) return state;
  const actor = state.active;
  const players = state.players.map((player) => ({ ...player, hole: [...player.hole] }));
  const player = players[actor];
  if (player.folded || player.allIn) return state;
  const callAmount = Math.max(0, state.currentBet - player.bet);
  let currentBet = state.currentBet;
  let minRaise = state.minRaise;
  let description = "";

  if (action.type === "fold") {
    player.folded = true; player.acted = true; player.lastAction = "弃牌"; description = `${player.name} 弃牌`;
  } else if (action.type === "check" && callAmount === 0) {
    player.acted = true; player.lastAction = "过牌"; description = `${player.name} 过牌`;
  } else if (action.type === "call" || (action.type === "check" && callAmount > 0)) {
    const paid = commit(player, callAmount); player.acted = true;
    player.lastAction = paid < callAmount ? `全下 ${formatChips(paid)}` : callAmount === 0 ? "过牌" : `跟注 ${formatChips(paid)}`;
    description = `${player.name} ${player.lastAction}`;
  } else if (action.type === "raise") {
    const maxTarget = player.bet + player.chips;
    if (maxTarget <= currentBet) {
      const paid = commit(player, callAmount); player.acted = true; player.lastAction = `全下 ${formatChips(paid)}`; description = `${player.name} ${player.lastAction}`;
    } else {
      const minimum = currentBet === 0 ? minRaise : currentBet + minRaise;
      const target = Math.min(maxTarget, Math.max(action.amount, Math.min(minimum, maxTarget)));
      const raiseSize = target - currentBet;
      commit(player, target - player.bet);
      currentBet = target;
      if (raiseSize >= minRaise) minRaise = raiseSize;
      for (const other of players) if (other.id !== player.id && !other.folded && !other.allIn && other.bet < currentBet) other.acted = false;
      player.acted = true;
      player.lastAction = player.allIn ? `全下至 ${formatChips(target)}` : state.currentBet === 0 ? `下注 ${formatChips(target)}` : `加注至 ${formatChips(target)}`;
      description = `${player.name} ${player.lastAction}`;
    }
  } else {
    return state;
  }

  const events = [...(state.events ?? [])];
  let eventCounter = state.eventCounter ?? events.at(-1)?.id ?? 0;
  if (action.type === "fold") {
    eventCounter += 1;
    events.push({ id: eventCounter, type: "fold", seat: actor });
  }
  const updated = { ...state, players, currentBet, minRaise, log: [...state.log, description], turnToken: state.turnToken + 1, events, eventCounter };
  const remaining = players.map((item, index) => ({ item, index })).filter(({ item }) => !item.folded);
  if (remaining.length === 1) return finishByFold(updated, remaining[0].index);
  if (bettingComplete(players, currentBet)) return nextStreet(updated);
  const active = nextIndex(players, actor, (item) => !item.folded && !item.allIn && item.chips > 0);
  return active < 0 ? showdown(updated) : { ...updated, active };
}

export function totalPot(state: GameState): number {
  return state.players.reduce((sum, player) => sum + player.contributed, 0);
}

export function legalActions(state: GameState, index: number) {
  const player = state.players[index];
  const call = Math.max(0, state.currentBet - player.bet);
  const maxTarget = player.bet + player.chips;
  const minTarget = Math.min(maxTarget, state.currentBet === 0 ? state.minRaise : state.currentBet + state.minRaise);
  return { call, canCheck: call === 0, canRaise: maxTarget > state.currentBet, minTarget, maxTarget };
}

export function potFractionRaiseTarget(state: GameState, index: number, fraction: number): number {
  const legal = legalActions(state, index);
  if (!legal.canRaise) return legal.maxTarget;

  const player = state.players[index];
  const safeFraction = Number.isFinite(fraction) ? Math.max(0, fraction) : 0;
  const potAfterCall = totalPot(state) + legal.call;
  const rawTarget = state.currentBet === 0
    ? player.bet + totalPot(state) * safeFraction
    : state.currentBet + potAfterCall * safeFraction;
  const chipUnit = Math.max(1, state.smallBlind);
  const roundedTarget = Math.round(rawTarget / chipUnit) * chipUnit;

  return Math.min(legal.maxTarget, Math.max(legal.minTarget, roundedTarget));
}

function preflopStrength(cards: Card[]): number {
  const [first, second] = [...cards].sort((a, b) => b.rank - a.rank);
  if (!first || !second) return 0;
  if (first.rank === second.rank) return Math.min(.98, .48 + first.rank / 28);
  let strength = (first.rank + second.rank) / 38;
  if (first.suit === second.suit) strength += .07;
  if (Math.abs(first.rank - second.rank) <= 2) strength += .05;
  if (first.rank === 14 && second.rank >= 10) strength += .12;
  return Math.min(.95, strength);
}

function botStrength(state: GameState, index: number): number {
  const player = state.players[index];
  if (state.community.length < 3) return preflopStrength(player.hole);
  const hand = bestHand([...player.hole, ...state.community]);
  return Math.min(.98, .12 + hand.category * .115 + (hand.tiebreak[0] ?? 2) / 100);
}

export function decideBotAction(state: GameState, index: number): PlayerAction {
  const player = state.players[index];
  const legal = legalActions(state, index);
  const pot = Math.max(state.bigBlind, totalPot(state));
  const potOdds = legal.call / Math.max(1, pot + legal.call);
  const styleBoost = player.style === "tight" ? -.08 : player.style === "bold" ? .08 : player.style === "wild" ? .14 : 0;
  const strength = botStrength(state, index) + styleBoost + (Math.random() - .5) * .12;
  const aggression = player.style === "tight" ? .78 : player.style === "bold" ? .58 : player.style === "wild" ? .48 : .67;

  if (legal.call > 0 && strength + .08 < Math.max(.25, potOdds * 1.5)) return { type: "fold" };
  if (legal.canRaise && strength > aggression && Math.random() < .48) {
    const factor = player.style === "wild" ? .85 : player.style === "bold" ? .68 : .52;
    const raiseBy = Math.max(state.minRaise, Math.round((pot * factor) / 10) * 10);
    return { type: "raise", amount: Math.min(legal.maxTarget, Math.max(legal.minTarget, state.currentBet + raiseBy)) };
  }
  if (legal.call === 0) return { type: "check" };
  return { type: "call" };
}

export function rankLabel(rank: number): string {
  return rank === 14 ? "A" : rank === 13 ? "K" : rank === 12 ? "Q" : rank === 11 ? "J" : String(rank);
}
