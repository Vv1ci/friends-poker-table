import assert from "node:assert/strict";
import test from "node:test";
import { advanceAutomaticRunout, applyAction, bestHand, createInitialGame, decideBotAction, potFractionRaiseTarget, startNextHand, totalPot, type Card } from "../lib/poker";

const cards = (values: Array<[number, Card["suit"]]>): Card[] => values.map(([rank, suit]) => ({ rank, suit }));

test("识别皇家同花顺", () => {
  const hand = bestHand(cards([[14, "♠"], [13, "♠"], [12, "♠"], [11, "♠"], [10, "♠"], [2, "♦"], [3, "♣"]]));
  assert.equal(hand.category, 8);
  assert.equal(hand.name, "同花顺");
});

test("葫芦胜过同花", () => {
  const fullHouse = bestHand(cards([[9, "♠"], [9, "♥"], [9, "♦"], [4, "♣"], [4, "♠"]]));
  const flush = bestHand(cards([[14, "♥"], [11, "♥"], [8, "♥"], [5, "♥"], [2, "♥"]]));
  assert.ok(fullHouse.category > flush.category);
});

test("两组三条会取较大三条组成葫芦", () => {
  const hand = bestHand(cards([[14, "♠"], [14, "♥"], [14, "♦"], [13, "♠"], [13, "♥"], [13, "♦"], [2, "♣"]]));
  assert.equal(hand.category, 6);
  assert.equal(hand.name, "葫芦");
  assert.deepEqual(hand.tiebreak, [14, 13]);
});

test("公共牌三条加手牌对子显示为葫芦", () => {
  const hand = bestHand(cards([[9, "♠"], [9, "♥"], [13, "♣"], [13, "♦"], [13, "♥"], [2, "♣"], [3, "♣"]]));
  assert.equal(hand.category, 6);
  assert.equal(hand.name, "葫芦");
  assert.deepEqual(hand.tiebreak, [13, 9]);
});

test("较大葫芦独赢匹配底池，未被跟注的筹码只退回不计胜利", () => {
  const initial = createInitialGame();
  const game = {
    ...initial,
    community: cards([[9, "♦"], [3, "♣"], [3, "♠"], [5, "♣"], [3, "♥"]]),
    street: "river" as const,
    active: 2,
    currentBet: 2220,
    handOver: false,
    players: initial.players.map((player, index) => ({
      ...player,
      hole: index === 2 ? cards([[9, "♠"], [9, "♥"]]) : index === 4 ? cards([[7, "♠"], [7, "♥"]]) : [],
      chips: index === 2 ? 100 : 0,
      folded: index !== 2 && index !== 4,
      allIn: index === 4,
      bet: index === 2 ? 2220 : index === 4 ? 2310 : 0,
      contributed: index === 2 ? 2220 : index === 4 ? 2310 : 0,
      acted: index !== 2,
    })),
  };

  const settled = applyAction(game, { type: "check" });
  assert.equal(settled.handOver, true);
  assert.equal(settled.players[2].won, 4440);
  assert.equal(settled.players[4].won, 0);
  assert.equal(settled.players[4].returned, 90);
  assert.equal(settled.players[4].chips, 90);
  assert.equal(totalPot(settled), 4440);
  assert.equal(settled.message, "Mia 主池 +4.44K（葫芦）");
  assert.equal(settled.potAwards.length, 1);
  assert.deepEqual(settled.potAwards[0], {
    playerIndex: 2,
    amount: 4440,
    potKind: "main",
    potNumber: 0,
    handName: "葫芦",
    uncontested: false,
    split: false,
  });
  assert.match(settled.log.at(-1) ?? "", /Mia 主池 \+4.44K（葫芦）/);
  assert.match(settled.log.at(-1) ?? "", /阿澈 退回 90（未被跟注）/);
  assert.doesNotMatch(settled.message, /阿澈 \+/);
});

test("主池与边池分别显示赢家、金额和牌型", () => {
  const initial = createInitialGame();
  const game = {
    ...initial,
    community: cards([[10, "♣"], [6, "♥"], [14, "♣"], [14, "♠"], [11, "♣"]]),
    street: "river" as const,
    active: 0,
    currentBet: 1515,
    handOver: false,
    players: initial.players.map((player, index) => ({
      ...player,
      hole: index === 0 ? cards([[14, "♥"], [9, "♠"]]) : index === 3 ? cards([[5, "♣"], [6, "♣"]]) : cards([[2, "♦"], [3, "♦"]]),
      chips: index === 0 ? 1 : 0,
      folded: ![0, 3].includes(index),
      allIn: [1, 3].includes(index),
      bet: [1515, 1515, 400, 1200, 40, 0][index],
      contributed: [1515, 1515, 400, 1200, 40, 0][index],
      acted: index !== 0,
    })),
  };

  const settled = applyAction(game, { type: "check" });
  assert.equal(settled.players[0].won, 630);
  assert.equal(settled.players[3].won, 4040);
  assert.equal(totalPot(settled), 4670);
  assert.equal(settled.potAwards.length, 2);
  assert.equal(settled.message, "Rook 主池 +4.04K（同花） · 访客玩家 边池 +630（三条，其他有效玩家已弃牌）");
});

test("新牌局正确发牌和收取盲注", () => {
  const game = startNextHand(createInitialGame());
  assert.equal(game.players.every((player) => player.hole.length === 2), true);
  assert.equal(totalPot(game), 30);
  assert.equal(game.currentBet, 20);
  assert.deepEqual(game.events.slice(0, 6).map((event) => event.seat), [1, 2, 3, 4, 5, 0]);
  assert.equal(game.active, 3);
});

test("两人桌从庄家小盲开始发牌并使用正确行动顺序", () => {
  const initial = createInitialGame();
  initial.players = initial.players.map((player, index) => ({ ...player, chips: index < 2 ? 2000 : 0 }));
  const game = startNextHand(initial);
  assert.equal(game.dealer, 0);
  assert.equal(game.smallBlindSeat, 0);
  assert.equal(game.bigBlindSeat, 1);
  assert.deepEqual(game.events.map((event) => event.seat), [0, 1, 0, 1]);
  assert.equal(game.active, 0);
});

test("翻牌前从大盲左侧行动，翻牌后从庄家左侧行动", () => {
  let game = startNextHand(createInitialGame());
  assert.equal(game.active, 3);
  for (const seat of [3, 4, 5, 0, 1]) {
    assert.equal(game.active, seat);
    game = applyAction(game, { type: "call" });
  }
  assert.equal(game.active, 2);
  game = applyAction(game, { type: "check" });
  assert.equal(game.street, "flop");
  assert.equal(game.active, 1);
});

test("两人桌翻牌后由大盲先行动", () => {
  const initial = createInitialGame();
  initial.players = initial.players.map((player, index) => ({ ...player, chips: index < 2 ? 2000 : 0 }));
  let game = startNextHand(initial);
  game = applyAction(game, { type: "call" });
  game = applyAction(game, { type: "check" });
  assert.equal(game.street, "flop");
  assert.equal(game.active, game.bigBlindSeat);
});

test("全下后的公牌按翻牌转牌河牌逐街发出且每街烧一张", () => {
  let game = startNextHand(createInitialGame());
  game = { ...game, active: -1, autoRunout: true, players: game.players.map((player) => ({ ...player, allIn: true, chips: 0 })) };
  game = advanceAutomaticRunout(game);
  assert.equal(game.community.length, 3);
  assert.equal(game.burned, 1);
  assert.equal(game.handOver, false);
  game = advanceAutomaticRunout(game);
  assert.equal(game.community.length, 4);
  assert.equal(game.burned, 2);
  game = advanceAutomaticRunout(game);
  assert.equal(game.community.length, 5);
  assert.equal(game.burned, 3);
  game = advanceAutomaticRunout(game);
  assert.equal(game.handOver, true);
  assert.equal(game.endReason, "showdown");
});

test("淘汰后不会自动恢复筹码，必须由房主重开", () => {
  const initial = createInitialGame();
  initial.players = initial.players.map((player, index) => ({ ...player, chips: index === 0 ? 100 : 0 }));
  assert.throws(() => startNextHand(initial), /NOT_ENOUGH_PLAYERS/);
});

test("底池百分比加注按跟注后的底池计算并遵守最小加注", () => {
  const game = startNextHand(createInitialGame());

  assert.equal(potFractionRaiseTarget(game, 0, 0.25), 40);
  assert.equal(potFractionRaiseTarget(game, 0, 1), 70);
  assert.equal(potFractionRaiseTarget(game, 0, 1.33), 90);
});

test("策略玩家可以自动完成一手牌且筹码守恒", () => {
  let game = startNextHand(createInitialGame());
  let turns = 0;
  while (!game.handOver && turns < 500) {
    game = game.autoRunout ? advanceAutomaticRunout(game) : applyAction(game, decideBotAction(game, game.active));
    turns += 1;
  }
  assert.equal(game.handOver, true);
  assert.ok(turns < 500);
  assert.equal(game.players.reduce((sum, player) => sum + player.chips, 0), 12000);
});
