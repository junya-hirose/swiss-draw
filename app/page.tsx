"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type InputMode = "paste" | "qr" | "lookup";
type EliminationMode = "none" | "single" | "double" | "triple" | "quad" | "penta";
type TournamentState = "setup" | "ready" | "running" | "complete";
type RoundStatus = "draft" | "active" | "complete";
type MatchStatus = "waiting" | "active" | "reported" | "forced";
type JudgeActionType = "caution" | "warning" | "game-loss" | "match-loss" | "disqualification";

type Settings = {
  name: string;
  participantCount: number;
  inputMode: InputMode;
  timeLimitMinutes: number;
  bestOf: number;
  eliminationMode: EliminationMode;
  hasEntryFee: boolean;
  entryFee: number;
  eventCode: string;
};

type Player = {
  id: string;
  name: string;
  checkedIn: boolean;
  byeCount: number;
  disqualified?: boolean;
};

type JudgeAction = {
  id: string;
  playerId: string;
  type: JudgeActionType;
  note: string;
  createdAt: string;
};

type Match = {
  id: string;
  round: number;
  table: number;
  playerAId: string;
  playerBId: string | null;
  scoreA: number | null;
  scoreB: number | null;
  winnerId: string | null;
  status: MatchStatus;
  pairingRecordA: string;
  pairingRecordB: string;
  timeLimitSeconds: number | null;
  timeRemainingSeconds: number | null;
  timeExtensionSeconds: number;
  judgeActions: JudgeAction[];
};

type Round = {
  number: number;
  status: RoundStatus;
  matches: Match[];
};

type TimelineEvent = {
  id: string;
  text: string;
};

type Tournament = {
  settings: Settings;
  state: TournamentState;
  players: Player[];
  rounds: Round[];
  events: TimelineEvent[];
};

type Standing = Player & {
  wins: number;
  losses: number;
  draws: number;
  gameWins: number;
  gameLosses: number;
  opponents: string[];
  dropped: boolean;
};

const sampleNames = [
  "Aki Naruse",
  "Ren Kisaragi",
  "Mio Senda",
  "Kai Fujimoto",
  "Sora Tachibana",
  "Yuna Arai",
  "Riku Hayami",
  "Noa Kanzaki",
];

const participantCountOptions = [8, 16, 32, 64, 128, 256];
const timeLimitOptions = [20, 25, 30, 40, 50];
const bestOfOptions = [1, 3, 5, 7, 9];

const judgeActionLabels: Record<JudgeActionType, string> = {
  caution: "注意",
  warning: "警告",
  "game-loss": "ゲーム敗北",
  "match-loss": "マッチ敗北",
  disqualification: "失格",
};

function generateEventCode() {
  return "SW-" + Math.random().toString(36).slice(2, 7).toUpperCase();
}

function normalizeBestOf(value: number) {
  return bestOfOptions.includes(value) ? value : 1;
}

function countEntryNames(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.split(/\t|,/)[0]?.trim())
    .filter(Boolean).length;
}

function participantCapForEntryCount(count: number) {
  return participantCountOptions.find((option) => count <= option) ?? Math.max(2, count);
}

function standingRecord(standing: Pick<Standing, "wins" | "losses" | "draws"> | undefined) {
  if (!standing) return "0-0-0";
  return `${standing.wins}-${standing.losses}-${standing.draws}`;
}

const activeTournamentKey = "swiss-draw-active-tournament";

function tournamentStorageKey(eventCode: string) {
  return `swiss-draw-tournament:${eventCode}`;
}

function readStoredTournament(eventCode: string | null): Tournament | null {
  if (!eventCode || typeof window === "undefined") return null;
  const saved = localStorage.getItem(tournamentStorageKey(eventCode));
  if (!saved) return null;
  try {
    return normalizeTournament(JSON.parse(saved) as Tournament);
  } catch {
    return null;
  }
}

function writeStoredTournament(tournament: Tournament) {
  if (typeof window === "undefined" || tournament.state === "setup") return;
  localStorage.setItem(tournamentStorageKey(tournament.settings.eventCode), JSON.stringify(tournament));
  localStorage.setItem(activeTournamentKey, tournament.settings.eventCode);
}

function normalizeMatch(
  match: Match,
  settings: Settings,
  recordA = match.pairingRecordA ?? "0-0-0",
  recordB = match.pairingRecordB ?? (match.playerBId ? "0-0-0" : "BYE"),
): Match {
  const baseSeconds = settings.timeLimitMinutes > 0 ? settings.timeLimitMinutes * 60 : null;
  return {
    ...match,
    pairingRecordA: match.pairingRecordA ?? recordA,
    pairingRecordB: match.pairingRecordB ?? recordB,
    timeLimitSeconds: match.timeLimitSeconds ?? baseSeconds,
    timeRemainingSeconds: match.timeRemainingSeconds ?? baseSeconds,
    timeExtensionSeconds: match.timeExtensionSeconds ?? 0,
    judgeActions: match.judgeActions ?? [],
  };
}

function normalizeTournament(tournament: Tournament): Tournament {
  const normalizedPlayers = tournament.players.map((player) => ({
    ...player,
    disqualified: player.disqualified ?? false,
  }));
  const completedRounds: Round[] = [];
  const normalizedRounds = tournament.rounds.map((round) => {
    const standingsAtRoundStart = buildStandings(normalizedPlayers, completedRounds, tournament.settings);
    const matches = round.matches.map((match) =>
      normalizeMatch(
        match,
        tournament.settings,
        playerRecord(standingsAtRoundStart, match.playerAId),
        playerRecord(standingsAtRoundStart, match.playerBId),
      ),
    );
    const normalizedRound = { ...round, matches };
    completedRounds.push(normalizedRound);
    return normalizedRound;
  });

  return {
    ...tournament,
    settings: {
      ...tournament.settings,
      bestOf: normalizeBestOf(tournament.settings.bestOf),
      timeLimitMinutes: tournament.settings.timeLimitMinutes || 20,
    },
    players: normalizedPlayers,
    rounds: normalizedRounds,
  };
}

const defaultSettings: Settings = {
  name: "Friday Night Swiss",
  participantCount: 8,
  inputMode: "paste",
  timeLimitMinutes: 20,
  bestOf: 1,
  eliminationMode: "none",
  hasEntryFee: false,
  entryFee: 1000,
  eventCode: generateEventCode(),
};

const eliminationLabels: Record<EliminationMode, string> = {
  none: "なし",
  single: "1敗で脱落",
  double: "2敗で脱落",
  triple: "3敗で脱落",
  quad: "4敗で脱落",
  penta: "5敗で脱落",
};

const inputModeLabels: Record<InputMode, string> = {
  paste: "Excelコピー",
  qr: "QR参加登録",
  lookup: "事前ID参照",
};

function parsePlayers(text: string, expectedCount: number): Player[] {
  const names = text
    .split(/\r?\n/)
    .map((line) => line.split(/\t|,/)[0]?.trim())
    .filter(Boolean) as string[];
  const source = names.length > 0 ? names : sampleNames.slice(0, expectedCount);

  return source.slice(0, Math.max(2, expectedCount)).map((name, index) => ({
    id: `P${String(index + 1).padStart(3, "0")}`,
    name,
    checkedIn: true,
    byeCount: 0,
  }));
}

function lossLimit(mode: EliminationMode) {
  if (mode === "single") return 1;
  if (mode === "double") return 2;
  if (mode === "triple") return 3;
  if (mode === "quad") return 4;
  if (mode === "penta") return 5;
  return Number.POSITIVE_INFINITY;
}

function pairKey(a: string, b: string) {
  return [a, b].sort().join(":");
}

function buildStandings(players: Player[], rounds: Round[], settings: Settings): Standing[] {
  const table = new Map<string, Standing>();
  players.forEach((player) => {
    table.set(player.id, {
      ...player,
      wins: 0,
      losses: 0,
      draws: 0,
      gameWins: 0,
      gameLosses: 0,
      opponents: [],
      dropped: player.disqualified ?? false,
    });
  });

  rounds.forEach((round) => {
    round.matches.forEach((match) => {
      if (match.status !== "reported" && match.status !== "forced") return;
      const a = table.get(match.playerAId);
      const b = match.playerBId ? table.get(match.playerBId) : null;
      if (!a) return;

      if (!b) {
        a.wins += 1;
        a.gameWins += 1;
        return;
      }

      a.opponents.push(b.id);
      b.opponents.push(a.id);
      a.gameWins += match.scoreA ?? 0;
      a.gameLosses += match.scoreB ?? 0;
      b.gameWins += match.scoreB ?? 0;
      b.gameLosses += match.scoreA ?? 0;

      if (match.winnerId === a.id) {
        a.wins += 1;
        b.losses += 1;
      } else if (match.winnerId === b.id) {
        b.wins += 1;
        a.losses += 1;
      } else {
        a.draws += 1;
        b.draws += 1;
      }
    });
  });

  const limit = lossLimit(settings.eliminationMode);
  return Array.from(table.values())
    .map((standing) => ({
      ...standing,
      dropped: standing.disqualified === true || standing.losses >= limit,
    }))
    .sort((a, b) => {
      const winDiff = b.wins - a.wins;
      if (winDiff) return winDiff;
      const lossDiff = a.losses - b.losses;
      if (lossDiff) return lossDiff;
      const gameDiff = b.gameWins - b.gameLosses - (a.gameWins - a.gameLosses);
      if (gameDiff) return gameDiff;
      return a.name.localeCompare(b.name);
    });
}

function createRound(players: Player[], rounds: Round[], settings: Settings): Round {
  const standings = buildStandings(players, rounds, settings);
  const roundNumber = rounds.length + 1;
  const previousPairs = new Set<string>();
  const previousByes = new Set<string>();

  rounds.forEach((round) => {
    round.matches.forEach((match) => {
      if (match.playerBId) previousPairs.add(pairKey(match.playerAId, match.playerBId));
      if (!match.playerBId) previousByes.add(match.playerAId);
    });
  });

  const available = standings.filter((player) => !player.dropped);
  const waiting = [...available];
  const matches: Match[] = [];
  const baseSeconds = settings.timeLimitMinutes > 0 ? settings.timeLimitMinutes * 60 : null;

  if (waiting.length % 2 === 1) {
    const byeIndex = [...waiting]
      .reverse()
      .findIndex((player) => !previousByes.has(player.id));
    const actualIndex = byeIndex >= 0 ? waiting.length - 1 - byeIndex : waiting.length - 1;
    const [byePlayer] = waiting.splice(actualIndex, 1);
    matches.push({
      id: `R${roundNumber}-T${matches.length + 1}`,
      round: roundNumber,
      table: matches.length + 1,
      playerAId: byePlayer.id,
      playerBId: null,
      scoreA: 1,
      scoreB: 0,
      winnerId: byePlayer.id,
      status: "reported",
      pairingRecordA: standingRecord(byePlayer),
      pairingRecordB: "BYE",
      timeLimitSeconds: baseSeconds,
      timeRemainingSeconds: baseSeconds,
      timeExtensionSeconds: 0,
      judgeActions: [],
    });
  }

  while (waiting.length > 0) {
    const playerA = waiting.shift();
    if (!playerA) break;
    let opponentIndex = waiting.findIndex(
      (candidate) =>
        candidate.wins === playerA.wins && !previousPairs.has(pairKey(playerA.id, candidate.id)),
    );
    if (opponentIndex < 0) {
      opponentIndex = waiting.findIndex(
        (candidate) => !previousPairs.has(pairKey(playerA.id, candidate.id)),
      );
    }
    if (opponentIndex < 0) opponentIndex = 0;
    const [playerB] = waiting.splice(opponentIndex, 1);

    matches.push({
      id: `R${roundNumber}-T${matches.length + 1}`,
      round: roundNumber,
      table: matches.length + 1,
      playerAId: playerA.id,
      playerBId: playerB.id,
      scoreA: null,
      scoreB: null,
      winnerId: null,
      status: "waiting",
      pairingRecordA: standingRecord(playerA),
      pairingRecordB: standingRecord(playerB),
      timeLimitSeconds: baseSeconds,
      timeRemainingSeconds: baseSeconds,
      timeExtensionSeconds: 0,
      judgeActions: [],
    });
  }

  return {
    number: roundNumber,
    status: "draft",
    matches: matches.sort((a, b) => a.table - b.table),
  };
}

function playerName(players: Player[], id: string | null) {
  if (!id) return "BYE";
  return players.find((player) => player.id === id)?.name ?? id;
}

function playerRecord(standings: Standing[], id: string | null) {
  if (!id) return "BYE";
  const standing = standings.find((player) => player.id === id);
  return standingRecord(standing);
}

function isStairPairing(match: Match) {
  if (!match.playerBId) return false;
  return match.pairingRecordA !== match.pairingRecordB;
}

function seriesTarget(bestOf: number) {
  return Math.floor(bestOf / 2) + 1;
}

function isChampionDecided(standings: Standing[], rounds: Round[]) {
  if (rounds.length === 0) return false;
  const undefeated = standings.filter((player) => player.losses === 0 && !player.dropped);
  return undefeated.length <= 1;
}

function makeEvent(text: string): TimelineEvent {
  return {
    id: Math.random().toString(36).slice(2),
    text,
  };
}

function formatTime(totalSeconds: number | null) {
  if (totalSeconds === null) return "無制限";
  const minutes = Math.floor(Math.max(0, totalSeconds) / 60);
  const seconds = Math.max(0, totalSeconds) % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function makeQrCells(seed: string) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return Array.from({ length: 21 * 21 }, (_, index) => {
    const x = index % 21;
    const y = Math.floor(index / 21);
    const inFinder =
      (x < 7 && y < 7) || (x > 13 && y < 7) || (x < 7 && y > 13);
    if (inFinder) {
      const localX = x < 7 ? x : x - 14;
      const localY = y < 7 ? y : y - 14;
      return (
        localX === 0 ||
        localX === 6 ||
        localY === 0 ||
        localY === 6 ||
        (localX >= 2 && localX <= 4 && localY >= 2 && localY <= 4)
      );
    }
    hash = (hash * 1664525 + 1013904223 + index) >>> 0;
    return (hash & 3) === 0 || ((x * y + hash) % 11 === 0);
  });
}

export default function Home() {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [participantText, setParticipantText] = useState(sampleNames.join("\n"));
  const [view, setView] = useState<"admin" | "participant">("admin");
  const [requestedEventCode, setRequestedEventCode] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [selectedPlayerId, setSelectedPlayerId] = useState("P001");
  const [registrationName, setRegistrationName] = useState("");
  const [reportScores, setReportScores] = useState({ a: 0, b: 0 });
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState<number | null>(
    defaultSettings.timeLimitMinutes * 60,
  );
  const [tournament, setTournament] = useState<Tournament>({
    settings: defaultSettings,
    state: "setup",
    players: parsePlayers(sampleNames.join("\n"), defaultSettings.participantCount),
    rounds: [],
    events: [makeEvent("大会設定を作成中")],
  });

  const currentRound = tournament.rounds.at(-1) ?? null;
  const standings = useMemo(
    () => buildStandings(tournament.players, tournament.rounds, tournament.settings),
    [tournament.players, tournament.rounds, tournament.settings],
  );
  const selectedPlayer = tournament.players.find((player) => player.id === selectedPlayerId);
  const selectedMatch = currentRound?.matches.find(
    (match) =>
      match.playerAId === selectedPlayerId || match.playerBId === selectedPlayerId,
  );
  const shareUrl =
    typeof window === "undefined"
      ? ""
      : `${window.location.origin}${window.location.pathname}?view=participant&event=${tournament.settings.eventCode}`;
  const selectedUrl =
    typeof window === "undefined" || !selectedPlayer
      ? ""
      : `${shareUrl}&player=${selectedPlayer.id}`;
  const targetScore = seriesTarget(tournament.settings.bestOf);
  const allMatchesDone =
    currentRound?.matches.every(
      (match) => match.status === "reported" || match.status === "forced",
    ) ?? false;
  const championDecided = isChampionDecided(standings, tournament.rounds);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const eventCode = params.get("event");
    if (params.get("view") === "participant") setView("participant");
    if (eventCode) setRequestedEventCode(eventCode);
    const player = params.get("player");
    const stored =
      readStoredTournament(eventCode) ??
      readStoredTournament(localStorage.getItem(activeTournamentKey));

    if (stored) {
      setTournament(stored);
      setSettings(stored.settings);
      setTimerSeconds(
        stored.settings.timeLimitMinutes > 0 ? stored.settings.timeLimitMinutes * 60 : null,
      );
      setSelectedPlayerId(
        player && stored.players.some((storedPlayer) => storedPlayer.id === player)
          ? player
          : stored.players[0]?.id ?? "",
      );
    } else if (player) {
      setSelectedPlayerId(player);
    }
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    writeStoredTournament(tournament);
  }, [isHydrated, tournament]);

  useEffect(() => {
    if (!isHydrated) return;
    const handleStorage = (event: StorageEvent) => {
      const eventCode = requestedEventCode ?? tournament.settings.eventCode;
      if (event.key !== tournamentStorageKey(eventCode) && event.key !== activeTournamentKey) {
        return;
      }
      const stored = readStoredTournament(eventCode);
      if (!stored) return;
      setTournament(stored);
      setSettings(stored.settings);
      setSelectedPlayerId((current) =>
        stored.players.some((player) => player.id === current)
          ? current
          : stored.players[0]?.id ?? "",
      );
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [isHydrated, requestedEventCode, tournament.settings.eventCode]);

  useEffect(() => {
    if (!timerRunning || timerSeconds === null) return;
    const id = window.setInterval(() => {
      setTimerSeconds((current) => {
        if (current === null) return null;
        if (current <= 1) {
          return 0;
        }
        return current - 1;
      });
      setTournament((current) => ({
        ...current,
        rounds: current.rounds.map((round) => {
          if (round.status !== "active") return round;
          return {
            ...round,
            matches: round.matches.map((match) => {
              if (match.status !== "active" || match.timeRemainingSeconds === null) return match;
              return {
                ...match,
                timeRemainingSeconds: Math.max(0, match.timeRemainingSeconds - 1),
              };
            }),
          };
        }),
      }));
    }, 1000);
    return () => window.clearInterval(id);
  }, [timerRunning, timerSeconds]);

  function updateSettings(next: Partial<Settings>) {
    setSettings((current) => ({ ...current, ...next }));
  }

  function updateParticipantText(nextText: string) {
    setParticipantText(nextText);
    const entryCount = countEntryNames(nextText);
    if (entryCount > 0) {
      updateSettings({ participantCount: participantCapForEntryCount(entryCount) });
    }
  }

  function createTournament(event: FormEvent) {
    event.preventDefault();
    const nextSettings = {
      ...settings,
      participantCount: Math.max(
        2,
        countEntryNames(participantText) > 0
          ? Math.max(settings.participantCount, participantCapForEntryCount(countEntryNames(participantText)))
          : settings.participantCount,
      ),
      bestOf: normalizeBestOf(settings.bestOf),
      eventCode: settings.eventCode || generateEventCode(),
    };
    const players =
      nextSettings.inputMode === "qr" && participantText.trim().length === 0
        ? []
        : parsePlayers(participantText, nextSettings.participantCount);
    setSettings(nextSettings);
    setTournament({
      settings: nextSettings,
      state: "ready",
      players,
      rounds: [],
      events: [makeEvent(`${nextSettings.name} を作成`)],
    });
    setTimerSeconds(nextSettings.timeLimitMinutes > 0 ? nextSettings.timeLimitMinutes * 60 : null);
    setTimerRunning(false);
    setSelectedPlayerId(players[0]?.id ?? "");
  }

  function saveSettings() {
    localStorage.setItem("swiss-draw-settings", JSON.stringify(settings));
  }

  function loadSettings() {
    const saved = localStorage.getItem("swiss-draw-settings");
    if (!saved) return;
    const loaded = JSON.parse(saved) as Settings;
    setSettings({ ...loaded, bestOf: normalizeBestOf(loaded.bestOf) });
  }

  async function copyShareUrl() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard?.writeText(shareUrl);
    } catch {
      window.prompt("URLをコピーしてください", shareUrl);
    }
    setTournament((current) => ({
      ...current,
      events: [makeEvent("Participant URL copied"), ...current.events].slice(0, 12),
    }));
  }

  function registerParticipant(event: FormEvent) {
    event.preventDefault();
    const name = registrationName.trim();
    if (!name) return;
    setTournament((current) => {
      const nextId = `P${String(current.players.length + 1).padStart(3, "0")}`;
      const nextPlayer: Player = {
        id: nextId,
        name,
        checkedIn: true,
        byeCount: 0,
      };
      setSelectedPlayerId(nextId);
      return {
        ...current,
        players: [...current.players, nextPlayer],
        events: [makeEvent(`${name} が参加登録`), ...current.events].slice(0, 12),
      };
    });
    setRegistrationName("");
  }

  function startRound() {
    setTournament((current) => {
      const round =
        current.rounds.length === 0 ||
        current.rounds.at(-1)?.status === "complete"
          ? createRound(current.players, current.rounds, current.settings)
          : current.rounds.at(-1);
      if (!round) return current;
      const activeRound: Round = {
        ...round,
        status: "active",
        matches: round.matches.map((match) =>
          match.status === "waiting"
            ? { ...normalizeMatch(match, current.settings), status: "active" }
            : normalizeMatch(match, current.settings),
        ),
      };
      const rounds =
        current.rounds.length === 0 ||
        current.rounds.at(-1)?.status === "complete"
          ? [...current.rounds, activeRound]
          : current.rounds.map((item, index) =>
              index === current.rounds.length - 1 ? activeRound : item,
            );
      return {
        ...current,
        state: "running",
        rounds,
        events: [makeEvent(`Round ${activeRound.number} start`), ...current.events].slice(0, 12),
      };
    });
    setTimerSeconds(
      tournament.settings.timeLimitMinutes > 0 ? tournament.settings.timeLimitMinutes * 60 : null,
    );
    setTimerRunning(tournament.settings.timeLimitMinutes > 0);
  }

  function rematchRound() {
    if (!currentRound) return;
    const hasResults = currentRound.matches.some(
      (match) => match.status === "reported" || match.status === "forced",
    );
    if (hasResults && !window.confirm("このラウンドの結果を破棄して再マッチングしますか？")) {
      return;
    }
    setTournament((current) => {
      const completedRounds = current.rounds.slice(0, -1);
      const nextRound = createRound(current.players, completedRounds, current.settings);
      return {
        ...current,
        rounds: [...completedRounds, {
          ...nextRound,
          status: "active",
          matches: nextRound.matches.map((match) =>
            match.status === "waiting" ? { ...match, status: "active" } : match,
          ),
        }],
        events: [makeEvent(`Round ${nextRound.number} rematched`), ...current.events].slice(0, 12),
      };
    });
  }

  function extendMatchTime(matchId: string, minutes: number) {
    const extensionSeconds = Math.max(0, minutes) * 60;
    if (extensionSeconds <= 0) return;
    setTournament((current) => ({
      ...current,
      rounds: current.rounds.map((round) => ({
        ...round,
        matches: round.matches.map((match) =>
          match.id === matchId
            ? {
                ...match,
                timeRemainingSeconds:
                  match.timeRemainingSeconds === null ? null : match.timeRemainingSeconds + extensionSeconds,
                timeExtensionSeconds: match.timeExtensionSeconds + extensionSeconds,
              }
            : match,
        ),
      })),
      events: [makeEvent(`${matchId} +${minutes}min extension`), ...current.events].slice(0, 12),
    }));
  }

  function reportMatch(matchId: string, scoreA: number, scoreB: number, forced = false) {
    setTournament((current) => {
      const nextRounds = current.rounds.map((round) => ({
        ...round,
        matches: round.matches.map((match) => {
          if (match.id !== matchId || !match.playerBId) return match;
          const status: MatchStatus = forced ? "forced" : "reported";
          const winnerId = scoreA > scoreB ? match.playerAId : match.playerBId;
          return {
            ...match,
            scoreA,
            scoreB,
            winnerId,
            status,
          };
        }),
      }));
      const updatedRound = nextRounds.at(-1);
      const reported = updatedRound?.matches.find((match) => match.id === matchId);
      const winner = reported ? playerName(current.players, reported.winnerId) : "";
      return {
        ...current,
        rounds: nextRounds,
        events: [makeEvent(`${winner} wins ${scoreA}-${scoreB}`), ...current.events].slice(0, 12),
      };
    });
  }

  function forceLoss(match: Match, loserId: string) {
    if (!match.playerBId) return;
    const loserIsA = loserId === match.playerAId;
    reportMatch(match.id, loserIsA ? 0 : targetScore, loserIsA ? targetScore : 0, true);
  }

  function applyJudgeAction(match: Match, playerId: string, type: JudgeActionType, note: string) {
    const action: JudgeAction = {
      id: Math.random().toString(36).slice(2),
      playerId,
      type,
      note: note.trim(),
      createdAt: new Date().toISOString(),
    };

    setTournament((current) => ({
      ...current,
      players: current.players.map((player) =>
        player.id === playerId && type === "disqualification"
          ? { ...player, disqualified: true }
          : player,
      ),
      rounds: current.rounds.map((round) => ({
        ...round,
        matches: round.matches.map((item) =>
          item.id === match.id
            ? {
                ...item,
                judgeActions: [action, ...(item.judgeActions ?? [])],
              }
            : item,
        ),
      })),
      events: [
        makeEvent(`${playerName(current.players, playerId)}: ${judgeActionLabels[type]}`),
        ...current.events,
      ].slice(0, 12),
    }));

    if (!match.playerBId) return;
    const playerIsA = playerId === match.playerAId;
    if (type === "game-loss") {
      const nextScoreA = playerIsA ? match.scoreA ?? 0 : Math.min(targetScore, (match.scoreA ?? 0) + 1);
      const nextScoreB = playerIsA ? Math.min(targetScore, (match.scoreB ?? 0) + 1) : match.scoreB ?? 0;
      if (Math.max(nextScoreA, nextScoreB) >= targetScore && nextScoreA !== nextScoreB) {
        reportMatch(match.id, nextScoreA, nextScoreB, true);
      } else {
        setTournament((current) => ({
          ...current,
          rounds: current.rounds.map((round) => ({
            ...round,
            matches: round.matches.map((item) =>
              item.id === match.id
                ? { ...item, scoreA: nextScoreA, scoreB: nextScoreB }
                : item,
            ),
          })),
        }));
      }
    }

    if (type === "match-loss" || type === "disqualification") {
      forceLoss(match, playerId);
    }
  }

  function nextRoundOrFinish() {
    setTournament((current) => {
      const completedRounds = current.rounds.map((round, index) =>
        index === current.rounds.length - 1 ? { ...round, status: "complete" as const } : round,
      );
      const nextStandings = buildStandings(current.players, completedRounds, current.settings);
      if (isChampionDecided(nextStandings, completedRounds)) {
        return {
          ...current,
          state: "complete",
          rounds: completedRounds,
          events: [makeEvent("Final standings locked"), ...current.events].slice(0, 12),
        };
      }
      return {
        ...current,
        rounds: [...completedRounds, createRound(current.players, completedRounds, current.settings)],
        events: [makeEvent(`Round ${completedRounds.length + 1} pairing ready`), ...current.events].slice(0, 12),
      };
    });
    setTimerRunning(false);
  }

  function toggleTimerStop() {
    if (timerRunning) {
      if (!window.confirm("タイマーを停止しますか？")) return;
      setTimerRunning(false);
      return;
    }
    setTimerRunning(true);
  }

  function submitParticipantReport(event: FormEvent) {
    event.preventDefault();
    if (!selectedMatch || !selectedMatch.playerBId) return;
    const isA = selectedMatch.playerAId === selectedPlayerId;
    const scoreA = isA ? reportScores.a : reportScores.b;
    const scoreB = isA ? reportScores.b : reportScores.a;
    if (scoreA === scoreB || Math.max(scoreA, scoreB) !== targetScore) {
      window.alert(`勝者のスコアを ${targetScore} にしてください。`);
      return;
    }
    reportMatch(selectedMatch.id, scoreA, scoreB);
  }

  function scoreButtons(value: number, onChange: (score: number) => void) {
    return (
      <div className="scoreButtons">
        {Array.from({ length: targetScore + 1 }, (_, score) => (
          <button
            className={value === score ? "chip active" : "chip"}
            key={score}
            onClick={() => onChange(score)}
            type="button"
          >
            {score}
          </button>
        ))}
      </div>
    );
  }

  return (
    <main className="appShell">
      <section className="topBar">
        <div>
          <p className="eyebrow">SWISS DRAW OPS</p>
          <h1>{tournament.settings.name}</h1>
        </div>
        <div className="modeSwitch" aria-label="view switch">
          <button className={view === "admin" ? "active" : ""} onClick={() => setView("admin")}>
            Admin
          </button>
          <button
            className={view === "participant" ? "active" : ""}
            onClick={() => setView("participant")}
          >
            Participant
          </button>
        </div>
      </section>

      <section className="statusRail">
        <div>
          <span>状態</span>
          <strong>{tournament.state.toUpperCase()}</strong>
        </div>
        <div>
          <span>Round</span>
          <strong>{currentRound?.number ?? "-"}</strong>
        </div>
        <div>
          <span>Timer</span>
          <strong>{formatTime(timerSeconds)}</strong>
        </div>
        <div>
          <span>Players</span>
          <strong>{tournament.players.length}</strong>
        </div>
        <div>
          <span>BO</span>
          <strong>{tournament.settings.bestOf}</strong>
        </div>
      </section>

      {view === "admin" ? (
        <section className="workspace adminGrid">
          <form className="panel setupPanel" onSubmit={createTournament}>
            <div className="panelHeader">
              <div>
                <p className="eyebrow">CONFIG</p>
                <h2>初期設定</h2>
              </div>
              <div className="buttonRow">
                <button type="button" onClick={saveSettings}>
                  Save
                </button>
                <button type="button" onClick={loadSettings}>
                  Load
                </button>
              </div>
            </div>

            <label>
              大会名
              <input
                value={settings.name}
                onChange={(event) => updateSettings({ name: event.target.value })}
              />
            </label>
            <div className="optionBlock">
              <span>参加者数</span>
              <div className="segmented optionButtons">
                {participantCountOptions.map((value) => (
                  <button
                    className={settings.participantCount === value ? "active" : ""}
                    key={value}
                    onClick={() => updateSettings({ participantCount: value })}
                    type="button"
                  >
                    ~{value}
                  </button>
                ))}
                <button
                  className={!participantCountOptions.includes(settings.participantCount) ? "active" : ""}
                  type="button"
                >
                  自由入力
                </button>
              </div>
              <input
                min={2}
                type="number"
                value={settings.participantCount}
                onChange={(event) =>
                  updateSettings({ participantCount: Number(event.target.value) })
                }
              />
            </div>
            <div className="optionBlock">
              <span>制限時間</span>
              <div className="segmented optionButtons">
                {timeLimitOptions.map((value) => (
                  <button
                    className={settings.timeLimitMinutes === value ? "active" : ""}
                    key={value}
                    onClick={() => updateSettings({ timeLimitMinutes: value })}
                    type="button"
                  >
                    {value}min
                  </button>
                ))}
                <button
                  className={!timeLimitOptions.includes(settings.timeLimitMinutes) ? "active" : ""}
                  type="button"
                >
                  自由入力
                </button>
              </div>
              <input
                min={0}
                type="number"
                value={settings.timeLimitMinutes}
                onChange={(event) =>
                  updateSettings({ timeLimitMinutes: Number(event.target.value) })
                }
              />
            </div>
            <div className="segmented">
              {(Object.keys(inputModeLabels) as InputMode[]).map((mode) => (
                <button
                  className={settings.inputMode === mode ? "active" : ""}
                  key={mode}
                  onClick={() => updateSettings({ inputMode: mode })}
                  type="button"
                >
                  {inputModeLabels[mode]}
                </button>
              ))}
            </div>
            <label>
              参加者名
              <textarea
                value={participantText}
                onChange={(event) => updateParticipantText(event.target.value)}
                rows={8}
              />
            </label>
            <div className="optionBlock">
              <span>BO</span>
              <div className="segmented optionButtons">
                {bestOfOptions.map((value) => (
                  <button
                    className={settings.bestOf === value ? "active" : ""}
                    key={value}
                    onClick={() => updateSettings({ bestOf: value })}
                    type="button"
                  >
                    BO{value}
                  </button>
                ))}
              </div>
            </div>
            <div className="optionBlock">
              <span>エリミネーション</span>
              <div className="segmented optionButtons">
                {(Object.keys(eliminationLabels) as EliminationMode[]).map((mode) => (
                  <button
                    className={settings.eliminationMode === mode ? "active" : ""}
                    key={mode}
                    onClick={() => updateSettings({ eliminationMode: mode })}
                    type="button"
                  >
                    {eliminationLabels[mode]}
                  </button>
                ))}
              </div>
            </div>
            <div className="checkLine">
              <label>
                <input
                  checked={settings.hasEntryFee}
                  onChange={(event) => updateSettings({ hasEntryFee: event.target.checked })}
                  type="checkbox"
                />
                参加費あり
              </label>
              <input
                disabled={!settings.hasEntryFee}
                min={0}
                type="number"
                value={settings.entryFee}
                onChange={(event) => updateSettings({ entryFee: Number(event.target.value) })}
              />
            </div>
            {tournament.state !== "setup" ? (
              <div className="issuedBox">
                <div>
                  <span>発行済みURL</span>
                  <strong>{shareUrl}</strong>
                </div>
                <Qr seed={shareUrl} />
                <button type="button" onClick={copyShareUrl}>
                  Copy
                </button>
              </div>
            ) : null}
            <button className="primaryAction" type="submit">
              設定してURL発行
            </button>
          </form>

          <section className="panel opsPanel">
            <div className="panelHeader">
              <div>
                <p className="eyebrow">CONTROL</p>
                <h2>運営卓</h2>
              </div>
              <div className="buttonRow">
                <button
                  disabled={tournament.players.length < 2 || tournament.state === "complete"}
                  onClick={startRound}
                  type="button"
                >
                  Start
                </button>
                <button disabled={!currentRound} onClick={rematchRound} type="button">
                  Re-pair
                </button>
                <button disabled={!currentRound} onClick={toggleTimerStop} type="button">
                  {timerRunning ? "Stop" : "Resume"}
                </button>
              </div>
            </div>

            <div className="shareGrid">
              <div>
                <span>Event URL</span>
                <strong>{shareUrl || "localhost"}</strong>
              </div>
              <Qr seed={shareUrl} />
              <button type="button" onClick={copyShareUrl}>
                Copy
              </button>
            </div>

            <div className="matchList">
              {currentRound ? (
                currentRound.matches.map((match) => (
                  <article className="matchRow" key={match.id}>
                    <div className="tableBadge">T{match.table}</div>
                    <div className="matchPlayers">
                      <div className="matchPlayerCell">
                        <strong>{playerName(tournament.players, match.playerAId)}</strong>
                        <small>{match.pairingRecordA}</small>
                      </div>
                      <span>vs</span>
                      <div className="matchPlayerCell">
                        <strong>{playerName(tournament.players, match.playerBId)}</strong>
                        <small>{match.pairingRecordB}</small>
                      </div>
                    </div>
                    <div className="matchScore">
                      <span>
                        {match.scoreA ?? "-"} - {match.scoreB ?? "-"}
                      </span>
                      <em>{match.status}</em>
                      {isStairPairing(match) ? (
                        <b className="pairingBadge">階段</b>
                      ) : null}
                      <strong className="tableTime">{formatTime(match.timeRemainingSeconds)}</strong>
                    </div>
                    {match.playerBId ? (
                      <AdminMatchControls
                        match={match}
                        players={tournament.players}
                        onApplyJudgeAction={applyJudgeAction}
                        onExtendTime={extendMatchTime}
                        onForceLoss={forceLoss}
                        onReport={reportMatch}
                        targetScore={targetScore}
                      />
                    ) : null}
                  </article>
                ))
              ) : (
                <div className="emptyState">Round not started</div>
              )}
            </div>

            <button
              className="primaryAction"
              disabled={!currentRound || !allMatchesDone}
              onClick={nextRoundOrFinish}
              type="button"
            >
              {championDecided ? "大会結果へ" : "次のラウンドへ"}
            </button>
          </section>

          <StandingsPanel standings={standings} rounds={tournament.rounds} players={tournament.players} />
        </section>
      ) : (
        <section className="workspace participantGrid">
          <section className="panel">
            <div className="panelHeader">
              <div>
                <p className="eyebrow">PLAYER</p>
                <h2>参加者</h2>
              </div>
              <select
                value={selectedPlayerId}
                onChange={(event) => setSelectedPlayerId(event.target.value)}
              >
                {tournament.players.map((player) => (
                  <option key={player.id} value={player.id}>
                    {player.id} / {player.name}
                  </option>
                ))}
              </select>
            </div>

            {tournament.settings.inputMode === "qr" && tournament.state !== "running" ? (
              <form className="joinBox" onSubmit={registerParticipant}>
                <input
                  placeholder="参加者名"
                  value={registrationName}
                  onChange={(event) => setRegistrationName(event.target.value)}
                />
                <button type="submit">Join</button>
              </form>
            ) : null}

            {selectedPlayer ? (
              <div className="identity">
                <span>{selectedPlayer.id}</span>
                <strong>{selectedPlayer.name}</strong>
                <small>{selectedUrl}</small>
              </div>
            ) : (
              <div className="emptyState">No player selected</div>
            )}
          </section>

          <section className="panel">
            <div className="panelHeader">
              <div>
                <p className="eyebrow">CURRENT MATCH</p>
                <h2>結果報告</h2>
              </div>
              <button onClick={() => window.location.reload()} type="button">
                Reload
              </button>
            </div>

            {selectedMatch && selectedPlayer && selectedMatch.playerBId ? (
              <form className="reportBox" onSubmit={submitParticipantReport}>
                <div className="participantTimer">
                  <span>Table {selectedMatch.table}</span>
                  <strong>{formatTime(selectedMatch.timeRemainingSeconds)}</strong>
                </div>
                <div className="versusBlock">
                  <strong>{playerName(tournament.players, selectedMatch.playerAId)}</strong>
                  <span>vs</span>
                  <strong>{playerName(tournament.players, selectedMatch.playerBId)}</strong>
                </div>
                <label>
                  自分
                  {scoreButtons(reportScores.a, (score) =>
                    setReportScores((current) => ({ ...current, a: score })),
                  )}
                </label>
                <label>
                  相手
                  {scoreButtons(reportScores.b, (score) =>
                    setReportScores((current) => ({ ...current, b: score })),
                  )}
                </label>
                <button className="primaryAction" type="submit">
                  報告
                </button>
              </form>
            ) : selectedMatch && !selectedMatch.playerBId ? (
              <div className="emptyState">BYE win</div>
            ) : (
              <div className="emptyState">No active match</div>
            )}
          </section>

          <StandingsPanel standings={standings} rounds={tournament.rounds} players={tournament.players} />
        </section>
      )}

      <section className="ticker" aria-label="round events">
        <div>
          {tournament.events.map((event) => (
            <span key={event.id}>{event.text}</span>
          ))}
        </div>
      </section>
    </main>
  );
}

function Qr({ seed }: { seed: string }) {
  const cells = makeQrCells(seed || "swiss-draw");
  return (
    <div className="qr" aria-hidden="true">
      {cells.map((active, index) => (
        <span className={active ? "on" : ""} key={index} />
      ))}
    </div>
  );
}

function AdminMatchControls({
  match,
  players,
  onApplyJudgeAction,
  onExtendTime,
  onForceLoss,
  onReport,
  targetScore,
}: {
  match: Match;
  players: Player[];
  onApplyJudgeAction: (match: Match, playerId: string, type: JudgeActionType, note: string) => void;
  onExtendTime: (matchId: string, minutes: number) => void;
  onForceLoss: (match: Match, loserId: string) => void;
  onReport: (matchId: string, scoreA: number, scoreB: number) => void;
  targetScore: number;
}) {
  const [scoreA, setScoreA] = useState(match.scoreA ?? targetScore);
  const [scoreB, setScoreB] = useState(match.scoreB ?? 0);
  const [extensionMinutes, setExtensionMinutes] = useState(1);
  const [judgePlayerId, setJudgePlayerId] = useState(match.playerAId);
  const [judgeAction, setJudgeAction] = useState<JudgeActionType>("caution");
  const [judgeNote, setJudgeNote] = useState("");

  useEffect(() => {
    setScoreA(match.scoreA ?? targetScore);
    setScoreB(match.scoreB ?? 0);
  }, [match.scoreA, match.scoreB, targetScore]);

  useEffect(() => {
    setJudgePlayerId(match.playerAId);
  }, [match.playerAId, match.playerBId]);

  function localScoreButtons(value: number, onChange: (score: number) => void) {
    return (
      <div className="scoreButtons">
        {Array.from({ length: targetScore + 1 }, (_, score) => (
          <button
            className={value === score ? "chip active" : "chip"}
            key={score}
            onClick={() => onChange(score)}
            type="button"
          >
            {score}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="adminMatchTools">
      <div className="adminScores">
        {localScoreButtons(scoreA, setScoreA)}
        {localScoreButtons(scoreB, setScoreB)}
        <button
          disabled={scoreA === scoreB || Math.max(scoreA, scoreB) !== targetScore}
          onClick={() => onReport(match.id, scoreA, scoreB)}
          type="button"
        >
          確定
        </button>
        <button onClick={() => onForceLoss(match, match.playerAId)} type="button">
          A強制敗北
        </button>
        <button onClick={() => onForceLoss(match, match.playerBId!)} type="button">
          B強制敗北
        </button>
      </div>

      <div className="judgeTools">
        <div className="timeExtend">
          <input
            min={1}
            type="number"
            value={extensionMinutes}
            onChange={(event) => setExtensionMinutes(Number(event.target.value))}
          />
          <button type="button" onClick={() => onExtendTime(match.id, extensionMinutes)}>
            延長
          </button>
        </div>
        <select value={judgePlayerId} onChange={(event) => setJudgePlayerId(event.target.value)}>
          <option value={match.playerAId}>{players.find((player) => player.id === match.playerAId)?.name}</option>
          <option value={match.playerBId!}>{players.find((player) => player.id === match.playerBId)?.name}</option>
        </select>
        <select
          value={judgeAction}
          onChange={(event) => setJudgeAction(event.target.value as JudgeActionType)}
        >
          {(Object.keys(judgeActionLabels) as JudgeActionType[]).map((type) => (
            <option key={type} value={type}>
              {judgeActionLabels[type]}
            </option>
          ))}
        </select>
        <input
          placeholder="裁定メモ"
          value={judgeNote}
          onChange={(event) => setJudgeNote(event.target.value)}
        />
        <button
          type="button"
          onClick={() => {
            onApplyJudgeAction(match, judgePlayerId, judgeAction, judgeNote);
            setJudgeNote("");
          }}
        >
          記録
        </button>
      </div>

      {match.judgeActions.length > 0 ? (
        <div className="judgeLog">
          {match.judgeActions.slice(0, 3).map((action) => (
            <span key={action.id}>
              {players.find((player) => player.id === action.playerId)?.name}:{" "}
              {judgeActionLabels[action.type]}
              {action.note ? ` / ${action.note}` : ""}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function StandingsPanel({
  standings,
  rounds,
  players,
}: {
  standings: Standing[];
  rounds: Round[];
  players: Player[];
}) {
  return (
    <section className="panel standingsPanel">
      <div className="panelHeader">
        <div>
          <p className="eyebrow">RESULTS</p>
          <h2>順位</h2>
        </div>
      </div>
      <div className="standingsTable">
        {standings.map((standing, index) => (
          <div className={standing.dropped ? "standingRow dropped" : "standingRow"} key={standing.id}>
            <span>{index + 1}</span>
            <strong>{standing.name}</strong>
            <span>{standing.wins}W</span>
            <span>{standing.losses}L</span>
            <span>{standing.draws}D</span>
            <span>{standing.gameWins - standing.gameLosses >= 0 ? "+" : ""}{standing.gameWins - standing.gameLosses}</span>
          </div>
        ))}
      </div>

      <div className="history">
        {rounds.map((round) => (
          <details key={round.number}>
            <summary>Round {round.number}</summary>
            {round.matches.map((match) => (
              <div className="historyRow" key={match.id}>
                <span>T{match.table}</span>
                <strong>{playerName(players, match.playerAId)}</strong>
                <span>{match.scoreA ?? "-"}</span>
                <span>{match.scoreB ?? "-"}</span>
                <strong>{playerName(players, match.playerBId)}</strong>
              </div>
            ))}
          </details>
        ))}
      </div>
    </section>
  );
}
