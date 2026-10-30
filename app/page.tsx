"use client";

import "./glass.css";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  bestHand,
  blindStructure,
  formatChips,
  rankLabel,
  totalPot,
  type Card,
  type Player,
  type PlayerAction,
  type PotAward,
  type GameState,
  type GameEvent,
} from "../lib/poker";
import { playbackDuration, resolveMotionPreference } from "../lib/motion";
import { canPresentTurn } from "../lib/presentation";
import { BettingPanel } from "./betting-panel";
import { CardMotion } from "./card-motion";
import { AnimatedAmount } from "./animated-amount";
import type { RoomSettings, RoomView } from "../lib/room-types";

const SEAT_CLASSES = ["", "seat-left-bottom", "seat-left-top", "seat-top", "seat-right-top", "seat-right-bottom"];
const STREET_LABELS = { waiting: "等待开桌", preflop: "翻牌前", flop: "翻牌", turn: "转牌", river: "河牌", showdown: "摊牌" };
const STACK_OPTIONS = [1000, 2000, 5000, 10_000, 25_000, 100_000, 1_000_000];
const TURN_OPTIONS = [
  { value: 0, label: "不限时" },
  { value: 15, label: "15 秒" },
  { value: 30, label: "30 秒" },
  { value: 60, label: "60 秒" },
];
const HAND_OPTIONS = [
  { value: 0, label: "不限手" },
  { value: 10, label: "10 手" },
  { value: 25, label: "25 手" },
  { value: 50, label: "50 手" },
];

type SessionInfo = { canCreate: boolean; displayName: string };

function PlayingCard({ card, hidden = false, small = false }: { card?: Card; hidden?: boolean; small?: boolean }) {
  if (hidden || !card) return <div className={`card card-back ${small ? "mini-card" : ""}`} aria-label="GPT card back"><span className="gpt-mark" aria-hidden="true" /></div>;
  const red = card.suit === "♥" || card.suit === "♦";
  return (
    <div className={`card face-card ${red ? "red" : ""} ${small ? "mini-card" : ""}`} aria-label={`${rankLabel(card.rank)}${card.suit}`}>
      <strong>{rankLabel(card.rank)}</strong><span>{card.suit}</span>
    </div>
  );
}

function savedNickname(): string {
  try { return window.localStorage.getItem("friends-poker-nickname") ?? ""; } catch { return ""; }
}
function saveNickname(name: string) {
  try { window.localStorage.setItem("friends-poker-nickname", name); } catch { /* Cookies carry identity. */ }
}

async function readRoomResponse(response: Response): Promise<RoomView> {
  const payload = (await response.json()) as { room?: RoomView; error?: string };
  if (!response.ok || !payload.room) throw new Error(payload.error || "房间暂时不可用");
  return payload.room;
}

function awardPotLabel(award: PotAward, allAwards: PotAward[]): string {
  if (award.potKind === "pot") return "底池";
  if (award.potKind === "main") return "主池";
  const sidePotCount = Math.max(0, ...allAwards.filter((item) => item.potKind === "side").map((item) => item.potNumber));
  return sidePotCount > 1 ? `边池 ${award.potNumber}` : "边池";
}

function winnerHandName(player: Player, game: GameState): string {
  return player.hole.length === 2 && game.community.length === 5 ? bestHand([...player.hole, ...game.community]).name : "";
}

function positionLabels(game: GameState, playerIndex: number): string[] {
  return [
    game.dealer === playerIndex ? "D" : "",
    game.smallBlindSeat === playerIndex ? "SB" : "",
    game.bigBlindSeat === playerIndex ? "BB" : "",
  ].filter(Boolean);
}

function decisionText(player: Player, playerIndex: number, game: GameState, active: boolean, secondsRemaining: number | null): string {
  if (active) {
    const status = player.isBot ? "思考中…" : "正在行动";
    return !player.isBot && secondsRemaining !== null ? `${status} · ${secondsRemaining}s` : status;
  }
  const allAwards = game.potAwards ?? [];
  const awards = allAwards.filter((award) => award.playerIndex === playerIndex);
  const awardText = awards.length
    ? awards.map((award) => `${awardPotLabel(award, allAwards)} +${formatChips(award.amount)} · ${award.handName}`).join(" · ")
    : player.won > 0
      ? `赢得 ${formatChips(player.won)}${winnerHandName(player, game) ? ` · ${winnerHandName(player, game)}` : ""}`
      : "";
  if (game.handOver && player.chips === 0 && !awardText) return "淘汰";
  return [awardText, player.returned > 0 ? `退回 ${formatChips(player.returned)}` : ""]
    .filter(Boolean)
    .join(" · ") || player.lastAction;
}

function settlementMessage(game: GameState): string {
  if (!game.handOver || (game.potAwards ?? []).length > 0) return game.message;
  const legacyWinners = game.players.filter((player) => player.won > 0);
  if (!legacyWinners.length) return game.message;
  return legacyWinners
    .map((player) => `${player.name} +${formatChips(player.won)}${winnerHandName(player, game) ? `（${winnerHandName(player, game)}）` : ""}`)
    .join(" · ");
}

export default function Home() {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [nickname, setNickname] = useState("");
  const [invitation, setInvitation] = useState<{code: string; token: string} | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [startingChips, setStartingChips] = useState(2000);
  const [turnSeconds, setTurnSeconds] = useState(0);
  const [maxHands, setMaxHands] = useState(0);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [reducedMotion, setReducedMotion] = useState(false);
  const [confirmation, setConfirmation] = useState<{type: "kick" | "transfer-host"; seat: number; name: string} | null>(null);
  const [restartOpen, setRestartOpen] = useState(false);
  const [animationQueue, setAnimationQueue] = useState<GameEvent[]>([]);
  const [visibleCommunityCount, setVisibleCommunityCount] = useState(0);
  const [visibleHoleCounts, setVisibleHoleCounts] = useState<number[]>([2, 2, 2, 2, 2, 2]);
  const [logPosition, setLogPosition] = useState({ x: 0, y: 0 });
  const eventTracker = useRef<{ handNumber: number; eventCounter: number } | null>(null);
  const logDrag = useRef<{ pointerId: number; x: number; y: number; startX: number; startY: number } | null>(null);
  const activeAnimation = animationQueue[0] ?? null;

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    try { setReducedMotion(resolveMotionPreference(window.localStorage.getItem("poker-reduced-motion"), media.matches)); } catch { setReducedMotion(media.matches); }
  }, []);
  useEffect(() => {
    if (!confirmation && !restartOpen) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) { setConfirmation(null); setRestartOpen(false); } };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [confirmation, restartOpen, busy]);
  const toggleMotion = () => {
    setReducedMotion((value) => { try { window.localStorage.setItem("poker-reduced-motion", String(!value)); } catch { /* Optional preference. */ } return !value; });
  };

  const game = room?.game;
  const roomCode = room?.code;
  const roomVersion = room?.version;
  const heroSeat = room?.seat ?? 0;
  const hero = game?.players[heroSeat];
  // Block the first render of a new event batch as well as its queued playback.
  const unseenEvents = Boolean(game && (game.events?.length ?? 0) > 0 && eventTracker.current &&
    (eventTracker.current.handNumber !== game.handNumber || eventTracker.current.eventCounter < (game.eventCounter ?? 0)));
  const presentationReady = canPresentTurn(room?.actionReadyAt, clockNow, animationQueue.length, unseenEvents);
  const heroTurnPending = Boolean(game && hero && game.active === heroSeat && !game.handOver && !hero.folded && !hero.allIn);
  const heroTurn = heroTurnPending && presentationReady;
  const botTurnReady = Boolean(game && !game.handOver && (game.autoRunout || (game.active >= 0 && game.players[game.active]?.isBot)));
  const botTurnToken = game?.turnToken;
  const activeSeat = game?.active ?? -1;
  const turnDeadline = room?.turnDeadline ?? null;
  const secondsRemaining = turnDeadline ? Math.max(0, Math.ceil((turnDeadline - clockNow) / 1000)) : null;
  const timedHumanTurnReady = Boolean(game && !game.handOver && game.active >= 0 && !game.players[game.active]?.isBot && turnDeadline && presentationReady);
  const lobbyBlinds = blindStructure(startingChips);


  const joinRoom = useCallback(async (rawCode: string, inviteToken: string) => {
    const code = rawCode.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    if (code.length !== 6) {
      setError("请输入 6 位房间码");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/rooms/${code}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "join", inviteToken, guestName: nickname.trim() || session?.displayName }),
      });
      const nextRoom = await readRoomResponse(response);
      saveNickname(nickname.trim() || session?.displayName || "访客玩家");
      setRoom(nextRoom);
      const inviteQuery = inviteToken ? `&invite=${encodeURIComponent(inviteToken)}` : "";
      window.history.replaceState(null, "", `/?room=${code}${inviteQuery}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法加入房间");
    } finally {
      setBusy(false);
    }
  }, [nickname, session]);

  useEffect(() => {
    let cancelled = false;
    const search = new URLSearchParams(window.location.search);
    const code = search.get("room") ?? "";
    const token = search.get("invite") ?? "";
    if (code) setInvitation({ code, token });
    void fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: "{}", cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as SessionInfo & { error?: string };
        if (!response.ok) throw new Error(payload.error || "访客身份创建失败");
        return payload as SessionInfo;
      })
      .then(async (nextSession) => {
        if (cancelled) return;
        setSession(nextSession);
        setNickname(savedNickname() || nextSession.displayName);
        // Restore an existing seat without consuming an invitation or taking a new seat.
        if (code) {
          const response = await fetch(`/api/rooms/${encodeURIComponent(code)}`, { cache: "no-store" });
          if (response.ok) {
            const restored = await readRoomResponse(response);
            if (!cancelled) setRoom(restored);
          }
        }
      })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "连接失败，请刷新重试"); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!roomCode) return;
    const code = roomCode;
    let cancelled = false;
    const sync = async () => {
      try {
          const response = await fetch(`/api/rooms/${code}`, { cache: "no-store" });
        const nextRoom = await readRoomResponse(response);
        if (!cancelled) {
          setRoom((current) => !current || nextRoom.version > current.version ? nextRoom : current);
          setError("");
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "同步中断，正在重试");
      }
    };
    const timer = window.setInterval(() => void sync(), 1200);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [roomCode]);

  useEffect(() => {
    if (!game) {
      eventTracker.current = null;
      return;
    }
    const events = game.events ?? [];
    const counter = game.eventCounter ?? events.at(-1)?.id ?? 0;
    const previous = eventTracker.current;
    if (!previous) {
      eventTracker.current = { handNumber: game.handNumber, eventCounter: counter };
      setVisibleCommunityCount(game.community.length);
      setVisibleHoleCounts(game.players.map((player) => game.street === "waiting" || player.lastAction === "淘汰" ? 0 : 2));
      return;
    }

    const newHand = game.handNumber !== previous.handNumber;
    const incoming = newHand ? events : events.filter((event) => event.id > previous.eventCounter);
    if (newHand) {
      setAnimationQueue(incoming);
      setVisibleCommunityCount(0);
      setVisibleHoleCounts(game.players.map(() => 0));
    } else if (incoming.length) {
      setAnimationQueue((current) => [...current, ...incoming]);
    }
    eventTracker.current = { handNumber: game.handNumber, eventCounter: counter };
  }, [game, heroSeat]);

  useEffect(() => {
    if (!activeAnimation) return;
    const duration = playbackDuration(activeAnimation, reducedMotion);
    const timer = window.setTimeout(() => {
      if (activeAnimation.type === "deal-hole" && activeAnimation.seat !== undefined) {
        setVisibleHoleCounts((counts) => counts.map((count, index) => index === activeAnimation.seat ? Math.min(2, count + 1) : count));
      }
      if (activeAnimation.type === "deal-community" && activeAnimation.communityIndex !== undefined) {
        setVisibleCommunityCount((count) => Math.max(count, activeAnimation.communityIndex! + 1));
      }
      setAnimationQueue((current) => current.slice(1));
    }, duration);
    return () => window.clearTimeout(timer);
  }, [activeAnimation, reducedMotion]);

  useEffect(() => {
    if (!roomCode || roomVersion === undefined || !botTurnReady || !presentationReady) return;
    let cancelled = false;
    const code = roomCode;
    const version = roomVersion;
    let timer: number | undefined;
    const requestBotTick = async () => {
      try {
          const response = await fetch(`/api/rooms/${code}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "tick", version }),
        });
        const nextRoom = await readRoomResponse(response);
        if (!cancelled) setRoom((current) => !current || nextRoom.version > current.version ? nextRoom : current);
      } catch {
        // A request can arrive just before the server-side animation gate, or lose a race to another client.
        // Keep retrying this version until polling or a successful tick advances the room.
        if (!cancelled) timer = window.setTimeout(() => void requestBotTick(), 750);
      }
    };
    const delay = 1_100; // Thinking starts only after this client finishes playback.
    timer = window.setTimeout(() => void requestBotTick(), delay);
    return () => { cancelled = true; if (timer !== undefined) window.clearTimeout(timer); };
  }, [roomCode, roomVersion, botTurnReady, botTurnToken, presentationReady]);

  useEffect(() => {
    if (!turnDeadline && !room?.actionReadyAt) return;
    const timer = window.setInterval(() => setClockNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [turnDeadline, room?.actionReadyAt]);

  useEffect(() => {
    if (!roomCode || roomVersion === undefined || !turnDeadline || !timedHumanTurnReady) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
          const response = await fetch(`/api/rooms/${roomCode}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "timeout", version: roomVersion }),
        });
        const nextRoom = await readRoomResponse(response);
        if (!cancelled) setRoom((current) => !current || nextRoom.version > current.version ? nextRoom : current);
      } catch {
        // Connected clients race on the same deadline; stale timeout requests are harmless.
      }
    }, Math.max(0, turnDeadline - Date.now()) + 50);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [roomCode, roomVersion, turnDeadline, timedHumanTurnReady, activeSeat]);

  const createRoom = async () => {
    if (!session?.canCreate) return;
    setBusy(true);
    setError("");
    try {
      const settings: RoomSettings = { startingChips, turnSeconds, maxHands };
      const response = await fetch("/api/rooms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ settings, guestName: nickname.trim() || session.displayName }),
      });
      const nextRoom = await readRoomResponse(response);
      saveNickname(nickname.trim() || session.displayName);
      setRoom(nextRoom);
      window.history.replaceState(null, "", `/?room=${nextRoom.code}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法创建房间");
    } finally {
      setBusy(false);
    }
  };

  const sendCommand = async (command:
    | { type: "start" }
    | { type: "restart"; settings: RoomSettings }
    | { type: "reveal-board" }
    | { type: "show-hole" }
    | { type: "kick" | "transfer-host"; seat: number }
    | { type: "action"; action: PlayerAction }) => {
    if (!room) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/rooms/${room.code}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...command, version: room.version }),
      });
      const nextRoom = await readRoomResponse(response);
      setRoom((current) => !current || nextRoom.version >= current.version ? nextRoom : current);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作没有成功，请重试");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const openRestart = () => {
    if (!room?.isHost) return;
    setStartingChips(room.settings.startingChips);
    setTurnSeconds(room.settings.turnSeconds);
    setMaxHands(room.settings.maxHands);
    setRestartOpen(true);
  };

  const restartGame = async () => {
    if (await sendCommand({ type: "restart", settings: { startingChips, turnSeconds, maxHands } })) setRestartOpen(false);
  };

  const beginLogDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    logDrag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, startX: logPosition.x, startY: logPosition.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveLog = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = logDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setLogPosition({ x: drag.startX + event.clientX - drag.x, y: drag.startY + event.clientY - drag.y });
  };

  const endLogDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (logDrag.current?.pointerId === event.pointerId) logDrag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const leaveRoom = () => {
    setRoom(null);
    setError("");
    window.history.replaceState(null, "", "/");
  };

  const copyInvite = async () => {
    if (!room?.isHost || !room.inviteToken) {
      setError("只有房主可以复制这个房间的邀请链接");
      return;
    }
    await navigator.clipboard.writeText(`${window.location.origin}/?room=${room.code}&invite=${encodeURIComponent(room.inviteToken)}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  if (!room || !game || !hero) {
    return (
      <main className="room-lobby" data-reduced-motion={reducedMotion}>
        <header className="lobby-brand"><strong>德州扑克</strong></header>
        <section className="lobby-card" aria-label="创建或加入德州扑克房间">
          <p className="eyebrow">ONLINE PRIVATE TABLE</p>
          <h1>和朋友开一桌</h1>
          <p className="lobby-lead">六人好友桌，无需登录即可创建。朋友通过邀请链接入座，空位由策略机器人补齐。</p>
          {session?.canCreate ? (
            <>
              <label className="nickname-field"><span>你的昵称</span><input value={nickname} maxLength={24} onChange={(event) => setNickname(event.target.value)} placeholder="输入牌桌昵称" disabled={busy} /></label>
              {invitation && <button className="create-room-button" onClick={() => void joinRoom(invitation.code, invitation.token)} disabled={busy}>{busy ? "正在连接…" : `加入房间 ${invitation.code}`}</button>}
              <div className="room-settings" aria-label="房间设置">
                <label>
                  <span>每人起始筹码</span>
                  <select value={startingChips} onChange={(event) => setStartingChips(Number(event.target.value))} disabled={busy}>
                    {STACK_OPTIONS.map((value) => <option value={value} key={value}>{formatChips(value)}</option>)}
                  </select>
                </label>
                <label>
                  <span>行动时间</span>
                  <select value={turnSeconds} onChange={(event) => setTurnSeconds(Number(event.target.value))} disabled={busy}>
                    {TURN_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label>
                  <span>牌局手数</span>
                  <select value={maxHands} onChange={(event) => setMaxHands(Number(event.target.value))} disabled={busy}>
                    {HAND_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                  </select>
                </label>
              </div>
              <p className="settings-note">盲注自动设为 {formatChips(lobbyBlinds.smallBlind)} / {formatChips(lobbyBlinds.bigBlind)}，限时结束时无须跟注则自动 Check，否则自动 Fold。</p>
              <button className="create-room-button" onClick={() => void createRoom()} disabled={busy}>{busy ? "正在连接…" : "创建新房间"}</button>
            </>
          ) : <p className="session-note">正在连接牌桌…</p>}
          {error && <p className="room-error" role="alert">{error}</p>}
          <p className="lobby-note">邀请链接只发给同桌朋友。同一浏览器保留身份 30 天，刷新可回到原座位；清除 Cookie 或换设备会成为新玩家。房主离开前可在手牌结束后转让。</p>
        </section>
      </main>
    );
  }

  const activeName = game.active >= 0 ? game.players[game.active].name : "";
  const opponents = Array.from({ length: 5 }, (_, offset) => {
    const realIndex = (heroSeat + offset + 1) % game.players.length;
    return { player: game.players[realIndex], realIndex, relativeIndex: offset + 1 };
  });
  const matchComplete = game.handOver && room.settings.maxHands > 0 && game.handNumber >= room.settings.maxHands;
  const fewerThanTwoStacks = game.handOver && game.players.filter((player) => player.chips > 0).length < 2;
  const nextHandBlocked = matchComplete || fewerThanTwoStacks;
  const heroAwardedUncontested = game.endReason === "fold" && (game.potAwards ?? []).some((award) => award.playerIndex === heroSeat);
  const canShowHeroHole = game.handOver && !(game.revealedPlayers ?? []).includes(heroSeat) && (hero.folded || heroAwardedUncontested);
  const canRevealBoard = room.isHost && game.handOver && game.endReason === "fold" && game.community.length < 5;
  const handLabel = room.settings.maxHands > 0 ? `${game.handNumber || 0} / ${room.settings.maxHands}` : `${game.handNumber || "—"}`;

  return (
    <main className="game-shell" data-reduced-motion={reducedMotion}>
      <header className="topbar">
        <div className="brand"><h1>德州扑克</h1></div>
        <div className="table-meta">
          <span>无限注</span><span className="dot">•</span><span>{formatChips(game.smallBlind)} / {formatChips(game.bigBlind)}</span>
          <span className="dot">•</span><span>{room.settings.turnSeconds > 0 ? `${room.settings.turnSeconds}s` : "不限时"}</span>
          <span className="room-code">房间 {room.code}</span>
          <span className="human-count">{room.humanCount}/6 真人</span>
          {room.isHost && <button className="quiet-button" onClick={() => void copyInvite()}>{copied ? "已复制" : "复制邀请"}</button>}
          {room.isHost && <button className="quiet-button" onClick={openRestart}>重新开始</button>}
          <button className="quiet-button" onClick={toggleMotion} aria-pressed={reducedMotion}>{reducedMotion ? "减少动画：开" : "减少动画：关"}</button>
          <button className="quiet-button" onClick={leaveRoom}>离开</button>
        </div>
      </header>

      <section className="table-stage" aria-label="六人德州扑克牌桌">
        <div className="round-pill"><span>第 {handLabel} 手</span><strong>{STREET_LABELS[game.street]}</strong></div>

        <div className="poker-table">
          <div className="felt-line" />
          <div className={`pot ${game.handOver ? "pot-settled" : ""}`}><span>{game.handOver ? "本手结算" : "底池"}</span><strong><AnimatedAmount value={totalPot(game)} reduced={reducedMotion} /></strong></div>
          <div className="board" aria-label="公共牌">
            {Array.from({ length: 5 }, (_, index) => game.community[index]).map((card, index) => (
              card && index < visibleCommunityCount ? <PlayingCard card={card} key={`${card.rank}-${card.suit}-${index}`} /> : <div className="card board-slot" key={index} />
            ))}
          </div>
          {game.burned > 0 && <div className="burn-pile" aria-label={`已烧牌 ${game.burned} 张`}><PlayingCard hidden small /><span>烧牌 ×{game.burned}</span></div>}
        </div>

        {activeAnimation && (
          <CardMotion key={`${game.handNumber}-${activeAnimation.id}`} event={activeAnimation} relativeSeat={activeAnimation.seat === undefined ? "board" : (activeAnimation.seat - heroSeat + game.players.length) % game.players.length} reduced={reducedMotion} />
        )}

        {opponents.map(({ player, realIndex, relativeIndex }) => {
          const reveal = player.hole.length === 2;
          const active = presentationReady && game.active === realIndex && !game.handOver;
          const eliminated = game.handOver && player.chips === 0;
          const labels = positionLabels(game, realIndex);
          return (
            <div className={`seat ${SEAT_CLASSES[relativeIndex]} ${active ? "seat-active" : ""} ${player.folded ? "seat-folded" : ""} ${eliminated ? "seat-eliminated" : ""}`} key={player.id}>
              {(!player.folded || reveal) && visibleHoleCounts[realIndex] > 0 && <div className="opponent-cards">{Array.from({ length: visibleHoleCounts[realIndex] }, (_, index) => <PlayingCard card={player.hole[index]} hidden={!reveal} small key={index} />)}</div>}
              {player.folded && !reveal && <div className="folded-muck"><PlayingCard hidden small /><PlayingCard hidden small /></div>}
              <div className="avatar">{player.avatar}</div>
              <div className="seat-copy">
                <div className="seat-name-row"><strong>{player.name}</strong>{player.isBot && <span className="bot-tag">BOT</span>}</div>
                <span><AnimatedAmount value={player.chips} reduced={reducedMotion} /> 筹码</span>
              </div>
              {labels.length > 0 && <div className="position-tags">{labels.map((label) => <span className={`position-tag position-${label.toLowerCase()}`} key={label}>{label}</span>)}</div>}
              {room.isHost && !player.isBot && (game.handOver || game.street === "waiting") && <details className="seat-menu"><summary aria-label={`管理 ${player.name}`}>•••</summary><div><button onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); setConfirmation({type: "transfer-host", seat: realIndex, name: player.name}); }} disabled={busy}>转让房主</button><button className="danger-text" onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); setConfirmation({type: "kick", seat: realIndex, name: player.name}); }} disabled={busy}>移出玩家</button></div></details>}
              <div className={`seat-decision ${active ? "decision-active" : ""}`}>{decisionText(player, realIndex, game, active, active ? secondsRemaining : null)}</div>
            </div>
          );
        })}

        <div className={`hero-seat ${heroTurn ? "hero-active" : ""} ${hero.folded ? "seat-folded" : ""} ${game.handOver && hero.chips === 0 ? "seat-eliminated" : ""}`}>
          <div className={`hole-cards ${hero.folded && !(game.revealedPlayers ?? []).includes(heroSeat) ? "cards-mucked" : ""}`} aria-label="你的底牌">
            {Array.from({ length: visibleHoleCounts[heroSeat] ?? 0 }, (_, index) => {
              const publiclyShown = (game.revealedPlayers ?? []).includes(heroSeat);
              const canSeeFace = !hero.folded || publiclyShown;
              const card = canSeeFace && index < (visibleHoleCounts[heroSeat] ?? 0) ? hero.hole[index] : undefined;
              return <PlayingCard card={card} hidden={!card} key={index} />;
            })}
          </div>
          {hero.folded && !(game.revealedPlayers ?? []).includes(heroSeat) && <div className="folded-muck hero-muck"><PlayingCard hidden small /><PlayingCard hidden small /></div>}
          <div className="hero-player">
            <div className="avatar hero-avatar">{hero.avatar}</div>
            <div><strong>{hero.name}</strong><span><AnimatedAmount value={hero.chips} reduced={reducedMotion} /> 筹码</span></div>
            {positionLabels(game, heroSeat).length > 0 && <div className="position-tags hero-position-tags">{positionLabels(game, heroSeat).map((label) => <span className={`position-tag position-${label.toLowerCase()}`} key={label}>{label}</span>)}</div>}
          </div>
          <div className={`hero-decision ${heroTurn ? "decision-active" : ""}`}>{decisionText(hero, heroSeat, game, heroTurn, heroTurn ? secondsRemaining : null)}</div>
        </div>

        <aside className="action-log" aria-label="本轮牌局动态" style={{ transform: `translate(${logPosition.x}px, ${logPosition.y}px)` }}>
          <button className="action-log-handle" onPointerDown={beginLogDrag} onPointerMove={moveLog} onPointerUp={endLogDrag} onPointerCancel={endLogDrag}><span>本轮动态</span><small>拖动</small></button>
          <div className="action-log-list">{game.log.slice().reverse().map((entry, index) => <p key={`${entry}-${index}`}>{entry}</p>)}</div>
        </aside>
      </section>

      <section className={`action-dock ${heroTurn ? "dock-turn" : ""}`} aria-label="牌局操作">
        {!presentationReady ? (
          <div className="waiting-copy" role="status"><span className="pulse" /><div><strong>{activeAnimation?.type === "fold" ? "正在收牌…" : "正在按顺序发牌…"}</strong><span>动画结束后开始下一位行动</span></div></div>
        ) : game.street === "waiting" || game.handOver ? (
          <>
            <div className="waiting-copy"><span className={game.handOver ? "winner-dot" : "pulse"} /><div><strong>{game.handOver ? settlementMessage(game) : `${room.humanCount} 位真人已就座`}</strong><span>{fewerThanTwoStacks ? "只剩一名玩家有筹码，请由房主重新开始" : matchComplete ? `已完成设定的 ${room.settings.maxHands} 手` : room.isHost ? game.handOver ? "由你开始下一手" : `每人 ${formatChips(room.settings.startingChips)}，其余空座由机器人补齐` : "等待房主开始下一手牌"}</span></div></div>
            <div className="post-hand-actions">
              {canShowHeroHole && <button className="secondary-action" onClick={() => void sendCommand({ type: "show-hole" })} disabled={busy}>亮出手牌</button>}
              {canRevealBoard && <button className="secondary-action" onClick={() => void sendCommand({ type: "reveal-board" })} disabled={busy}>公开剩余公牌</button>}
              <button className="primary-action" onClick={() => void sendCommand({ type: "start" })} disabled={busy || nextHandBlocked || !room.isHost}>{busy ? "同步中…" : nextHandBlocked ? "请重新开始" : !room.isHost ? "等待房主" : game.handOver ? "下一手" : "开始牌局"}</button>
            </div>
          </>
        ) : heroTurn ? (
          <>
            {secondsRemaining !== null && <div className="turn-countdown">行动剩余 <strong>{secondsRemaining}s</strong></div>}
            <BettingPanel key={`${game.handNumber}-${game.turnToken}`} game={game} seat={heroSeat} busy={busy} onAction={(action) => void sendCommand({type: "action", action})} />
          </>
        ) : (
          <>
            <div className="waiting-copy"><span className="thinking-dot" /><div><strong>{game.autoRunout ? "正在发出剩余公牌…" : hero.folded || hero.allIn ? "等待本手结束" : `${activeName} 正在行动${secondsRemaining !== null ? ` · ${secondsRemaining}s` : ""}`}</strong><span>{error || game.message}</span></div></div>
            <div className="thinking-bars"><i /><i /><i /></div>
          </>
        )}
      </section>
      {busy && <div className="sync-status" role="status">正在同步操作…</div>}
      {error && <div className="table-error" role="alert">{error}</div>}
      {confirmation && room.isHost && <div className="modal-backdrop" onClick={(event) => { if(event.target === event.currentTarget && !busy) setConfirmation(null); }}><section className="restart-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><h2 id="confirm-title">{confirmation.type === "kick" ? "移出玩家" : "转让房主"}</h2><p>{confirmation.type === "kick" ? `将 ${confirmation.name} 移出牌桌，空位由机器人接替。` : `将房主权限交给 ${confirmation.name}，你仍保留座位。`}旧邀请链接会失效。</p><div className="modal-actions"><button className="secondary-action" autoFocus onClick={() => setConfirmation(null)} disabled={busy}>取消</button><button className="primary-action" onClick={async () => { if(await sendCommand({type: confirmation.type, seat: confirmation.seat})) setConfirmation(null); }} disabled={busy}>{busy ? "正在同步…" : "确认"}</button></div></section></div>}
      {restartOpen && room.isHost && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setRestartOpen(false); }}>
          <section className="restart-modal" role="dialog" aria-modal="true" aria-labelledby="restart-title">
            <p className="eyebrow">HOST CONTROL</p>
            <h2 id="restart-title">重新开始游戏</h2>
            <p>保留房间和已入座玩家，清空当前筹码、手数与本轮动态。</p>
            <div className="room-settings restart-settings">
              <label><span>每人起始筹码</span><select value={startingChips} onChange={(event) => setStartingChips(Number(event.target.value))}>{STACK_OPTIONS.map((value) => <option value={value} key={value}>{formatChips(value)}</option>)}</select></label>
              <label><span>行动时间</span><select value={turnSeconds} onChange={(event) => setTurnSeconds(Number(event.target.value))}>{TURN_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
              <label><span>牌局手数</span><select value={maxHands} onChange={(event) => setMaxHands(Number(event.target.value))}>{HAND_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
            </div>
            <div className="modal-actions"><button className="secondary-action" onClick={() => setRestartOpen(false)} disabled={busy}>取消</button><button className="primary-action" onClick={() => void restartGame()} disabled={busy}>{busy ? "正在重置…" : "确认重新开始"}</button></div>
          </section>
        </div>
      )}
    </main>
  );
}
