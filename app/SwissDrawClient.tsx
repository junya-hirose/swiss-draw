"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  buildMatchesCsv,
  buildResultsPayload,
  buildStandingsCsv,
} from "../lib/domain/export";
import {
  bestOfOptions,
  buildStandings,
  countEntryNames,
  createRound,
  defaultSettings,
  formatPercentage,
  generateEventCode,
  isStairPairing,
  makeEvent,
  normalizeBestOf,
  normalizeMatch,
  normalizeTournament,
  parsePlayers,
  participantCapForEntryCount,
  participantCountOptions,
  playerName,
  recommendedSwissRounds,
  sampleNames,
  seriesTarget,
  timeLimitOptions,
  type EliminationMode,
  type InputMode,
  type JudgeAction,
  type JudgeActionType,
  type Match,
  type MatchStatus,
  type Player,
  type Round,
  type Settings,
  type Standing,
  type Tournament,
} from "../lib/domain/tournament";

const judgeActionLabels: Record<JudgeActionType, string> = {
  caution: "注意",
  warning: "警告",
  "game-loss": "ゲーム敗北",
  "match-loss": "マッチ敗北",
  disqualification: "失格",
};

const activeTournamentKey = "swiss-draw-active-tournament";

function safeFileName(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "swiss-draw";
}

function downloadTextFile(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function readInitialSearchParam(key: string) {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(key);
}

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

type SwissDrawClientProps = {
  initialEventCode?: string | null;
  initialPlayerId?: string;
  initialPlayerLocked?: boolean;
  initialView?: "admin" | "participant";
};

export default function SwissDrawClient({
  initialEventCode,
  initialPlayerId,
  initialPlayerLocked = false,
  initialView,
}: SwissDrawClientProps) {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [participantText, setParticipantText] = useState(sampleNames.join("\n"));
  const [view] = useState<"admin" | "participant">(() =>
    initialView ?? (readInitialSearchParam("view") === "participant" ? "participant" : "admin"),
  );
  const [requestedEventCode] = useState<string | null>(
    () => initialEventCode ?? readInitialSearchParam("event"),
  );
  const [eventLoadError, setEventLoadError] = useState("");
  const [isHydrated, setIsHydrated] = useState(false);
  const [isSetupExpanded, setIsSetupExpanded] = useState(true);
  const [selectedPlayerId, setSelectedPlayerId] = useState(
    () => initialPlayerId ?? readInitialSearchParam("player") ?? "P001",
  );
  const [registrationName, setRegistrationName] = useState("");
  const [deckName, setDeckName] = useState("");
  const deckInputRef = useRef<HTMLInputElement>(null);
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
  const selectedStanding = standings.find((standing) => standing.id === selectedPlayerId);
  const selectedMatch = currentRound?.matches.find(
    (match) =>
      match.playerAId === selectedPlayerId || match.playerBId === selectedPlayerId,
  );
  const selectedOpponentId =
    selectedMatch?.playerAId === selectedPlayerId
      ? selectedMatch.playerBId
      : selectedMatch?.playerAId ?? null;
  const selectedOpponentName = playerName(tournament.players, selectedOpponentId);
  const shareUrl =
    typeof window === "undefined" || !tournament.settings.eventCode
      ? ""
      : `${window.location.origin}${window.location.pathname}?view=participant&event=${tournament.settings.eventCode}`;
  const selectedUrl =
    typeof window === "undefined" || !selectedPlayer
      ? ""
      : `${shareUrl}&player=${selectedPlayer.id}`;
  const eventQuery = requestedEventCode || tournament.settings.eventCode;
  const adminViewHref = eventQuery ? `?view=admin&event=${eventQuery}` : "?view=admin";
  const participantViewHref = eventQuery
    ? `?view=participant&event=${eventQuery}&player=${selectedPlayerId}`
    : `?view=participant&player=${selectedPlayerId}`;
  const targetScore = seriesTarget(tournament.settings.bestOf);
  const allMatchesDone =
    currentRound?.matches.every(
      (match) => match.status === "reported" || match.status === "forced",
    ) ?? false;
  const openMatchCount =
    currentRound?.matches.filter(
      (match) => match.status !== "reported" && match.status !== "forced",
    ).length ?? 0;
  const finalRoundReached = currentRound
    ? currentRound.number >= tournament.settings.swissRounds
    : false;
  const showFullSetup = tournament.state === "setup" || isSetupExpanded;
  const isComplete = tournament.state === "complete";
  const deckRegistrationOpen = tournament.state === "setup" || tournament.state === "ready";
  const deckRegisteredPlayers = tournament.players.filter(
    (player) => Boolean(player.deckName?.trim()) || Boolean(player.deckImageName?.trim()),
  );
  const missingDeckPlayers = tournament.players.filter(
    (player) => !player.deckName?.trim() && !player.deckImageName?.trim(),
  );
  const canParticipantReport =
    Boolean(selectedMatch?.playerBId) &&
    selectedMatch?.status !== "reported" &&
    selectedMatch?.status !== "forced" &&
    !isComplete;

  function matchDisplaySeconds(match: Match) {
    if (match.status === "reported" || match.status === "forced") {
      return match.timeRemainingSeconds;
    }
    if (currentRound?.status === "active" && timerSeconds !== null) {
      return timerSeconds + match.timeExtensionSeconds;
    }
    return match.timeRemainingSeconds;
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const eventCode = params.get("event");
    const player = params.get("player");
    const stored = eventCode
      ? readStoredTournament(eventCode)
      : readStoredTournament(localStorage.getItem(activeTournamentKey));

    if (stored) {
      setEventLoadError("");
      setTournament(stored);
      setSettings(stored.settings);
      setTimerSeconds(
        stored.settings.timeLimitMinutes > 0 ? stored.settings.timeLimitMinutes * 60 : null,
      );
      setIsSetupExpanded(stored.state === "setup");
      setSelectedPlayerId(
        player && stored.players.some((storedPlayer) => storedPlayer.id === player)
          ? player
          : stored.players[0]?.id ?? "",
      );
    } else if (player) {
      setSelectedPlayerId(player);
      if (eventCode) {
        setEventLoadError(`大会 ${eventCode} がこのブラウザに保存されていません。`);
      }
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
      const stored =
        event.key === activeTournamentKey && !requestedEventCode
          ? readStoredTournament(event.newValue)
          : readStoredTournament(eventCode);
      if (!stored) return;
      setEventLoadError("");
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
    }, 1000);
    return () => window.clearInterval(id);
  }, [timerRunning, timerSeconds]);

  useEffect(() => {
    setDeckName(selectedPlayer?.deckName ?? "");
  }, [selectedPlayer?.deckName, selectedPlayer?.id]);

  function updateSettings(next: Partial<Settings>) {
    setSettings((current) => ({ ...current, ...next }));
  }

  function updateParticipantText(nextText: string) {
    setParticipantText(nextText);
    const entryCount = countEntryNames(nextText);
    if (entryCount > 0) {
      const participantCount = participantCapForEntryCount(entryCount);
      updateSettings({
        participantCount,
        swissRounds: recommendedSwissRounds(participantCount),
      });
    }
  }

  function issueTournament() {
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
    nextSettings.swissRounds = Math.max(
      1,
      nextSettings.swissRounds || recommendedSwissRounds(nextSettings.participantCount),
    );
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
    setIsSetupExpanded(false);
  }

  function createTournament(event: FormEvent) {
    event.preventDefault();
    issueTournament();
  }

  function saveSettings() {
    localStorage.setItem("swiss-draw-settings", JSON.stringify(settings));
  }

  function loadSettings() {
    const saved = localStorage.getItem("swiss-draw-settings");
    if (!saved) return;
    const loaded = JSON.parse(saved) as Settings;
    setSettings({
      ...loaded,
      bestOf: normalizeBestOf(loaded.bestOf),
      swissRounds: loaded.swissRounds ?? recommendedSwissRounds(loaded.participantCount),
    });
  }

  function activateRound(round: Round, nextSettings: Settings): Round {
    return {
      ...round,
      status: "active",
      matches: round.matches.map((match) =>
        match.status === "waiting"
          ? { ...normalizeMatch(match, nextSettings), status: "active" }
          : normalizeMatch(match, nextSettings),
      ),
    };
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
      events: [makeEvent("参加者URLをコピー"), ...current.events].slice(0, 12),
    }));
  }

  function exportBaseName() {
    const code = tournament.settings.eventCode || "draft";
    return safeFileName(`${code}-${tournament.settings.name}`);
  }

  function downloadResultsJson() {
    const payload = buildResultsPayload(tournament, standings);
    downloadTextFile(
      `${exportBaseName()}-results.json`,
      JSON.stringify(payload, null, 2),
      "application/json;charset=utf-8",
    );
  }

  function downloadStandingsCsv() {
    downloadTextFile(
      `${exportBaseName()}-standings.csv`,
      buildStandingsCsv(standings),
      "text/csv;charset=utf-8",
    );
  }

  function downloadMatchesCsv() {
    downloadTextFile(
      `${exportBaseName()}-matches.csv`,
      buildMatchesCsv(tournament),
      "text/csv;charset=utf-8",
    );
  }

  async function copyResultsJson() {
    const payload = buildResultsPayload(tournament, standings);
    const text = JSON.stringify(payload, null, 2);
    try {
      await navigator.clipboard?.writeText(text);
    } catch {
      window.prompt("結果JSONをコピーしてください", text);
    }
    setTournament((current) => ({
      ...current,
      events: [makeEvent("結果JSONをコピー"), ...current.events].slice(0, 12),
    }));
  }

  function registerParticipant(event: FormEvent) {
    event.preventDefault();
    const name = registrationName.trim();
    if (!name) return;
    setTournament((current) => {
      if (current.state === "running" || current.state === "complete") return current;
      const nextId = `P${String(current.players.length + 1).padStart(3, "0")}`;
      const nextPlayer: Player = {
        id: nextId,
        name,
        checkedIn: true,
        byeCount: 0,
      };
      const nextPlayers = [...current.players, nextPlayer];
      const participantCount = participantCapForEntryCount(nextPlayers.length);
      const nextSettings = {
        ...current.settings,
        participantCount,
        swissRounds: recommendedSwissRounds(participantCount),
      };
      setSelectedPlayerId(nextId);
      return {
        ...current,
        settings: nextSettings,
        players: nextPlayers,
        events: [makeEvent(`${name} が参加登録`), ...current.events].slice(0, 12),
      };
    });
    setRegistrationName("");
  }

  function updatePlayer(playerId: string, updater: (player: Player) => Player) {
    setTournament((current) => ({
      ...current,
      players: current.players.map((player) => (player.id === playerId ? updater(player) : player)),
    }));
  }

  function setParticipantCheckIn(checkedIn: boolean) {
    if (!selectedPlayer) return;
    updatePlayer(selectedPlayer.id, (player) => ({ ...player, checkedIn }));
    setTournament((current) => ({
      ...current,
      events: [
        makeEvent(`${selectedPlayer.name} ${checkedIn ? "チェックイン" : "チェックイン取消"}`),
        ...current.events,
      ].slice(0, 12),
    }));
  }

  function saveDeckRegistration(nextDeckName = deckInputRef.current?.value ?? deckName) {
    if (!selectedPlayer || !deckRegistrationOpen) return;
    const trimmedDeckName = nextDeckName.trim();
    updatePlayer(selectedPlayer.id, (player) => ({
      ...player,
      deckName: trimmedDeckName,
      deckRegisteredAt:
        trimmedDeckName || player.deckImageName ? new Date().toISOString() : player.deckRegisteredAt,
    }));
    setTournament((current) => ({
      ...current,
      events: [makeEvent(`${selectedPlayer.name} デッキ登録更新`), ...current.events].slice(0, 12),
    }));
  }

  function submitDeckRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const nextDeckName = formData.get("deckName")?.toString() ?? deckName;
    setDeckName(nextDeckName);
    saveDeckRegistration(nextDeckName);
  }

  function registerDeckImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!selectedPlayer || !file || !deckRegistrationOpen) return;
    updatePlayer(selectedPlayer.id, (player) => ({
      ...player,
      deckImageName: file.name,
      deckRegisteredAt: new Date().toISOString(),
    }));
    setTournament((current) => ({
      ...current,
      events: [makeEvent(`${selectedPlayer.name} デッキ画像登録`), ...current.events].slice(0, 12),
    }));
  }

  function startRound() {
    if (missingDeckPlayers.length > 0) {
      const sampleMissing = missingDeckPlayers
        .slice(0, 5)
        .map((player) => player.name)
        .join("、");
      const suffix = missingDeckPlayers.length > 5 ? ` ほか${missingDeckPlayers.length - 5}名` : "";
      if (
        !window.confirm(
          `デッキ未登録が ${missingDeckPlayers.length} 名います。\n${sampleMissing}${suffix}\nこのままラウンドを開始しますか？`,
        )
      ) {
        return;
      }
    }
    setTournament((current) => {
      const round =
        current.rounds.length === 0 ||
        current.rounds.at(-1)?.status === "complete"
          ? createRound(current.players, current.rounds, current.settings)
          : current.rounds.at(-1);
      if (!round) return current;
      const activeRound = activateRound(round, current.settings);
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
    if (tournament.state === "complete") return;
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
      ...(current.state === "complete"
        ? {}
        : {
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
          }),
    }));
  }

  function reportMatch(matchId: string, scoreA: number, scoreB: number, forced = false) {
    if (scoreA === scoreB || Math.max(scoreA, scoreB) !== targetScore) return;
    setTournament((current) => {
      if (current.state === "complete") return current;
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
            resultType: "win" as const,
            resultNote: "",
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
        events: [makeEvent(`${winner} 勝利 ${scoreA}-${scoreB}`), ...current.events].slice(0, 12),
      };
    });
  }

  function setFirstPlayer(matchId: string, firstPlayerId: string) {
    setTournament((current) => ({
      ...current,
      ...(current.state === "complete"
        ? {}
        : {
            rounds: current.rounds.map((round) => ({
              ...round,
              matches: round.matches.map((match) =>
                match.id === matchId && match.playerBId
                  ? {
                      ...match,
                      firstPlayerId,
                    }
                  : match,
              ),
            })),
            events: [
              makeEvent(`${playerName(current.players, firstPlayerId)} を先攻に設定`),
              ...current.events,
            ].slice(0, 12),
          }),
    }));
  }

  function forceLoss(match: Match, loserId: string) {
    if (!match.playerBId) return;
    const loserName = playerName(tournament.players, loserId);
    if (!window.confirm(`${loserName} を強制敗北にしますか？`)) return;
    const loserIsA = loserId === match.playerAId;
    reportMatch(match.id, loserIsA ? 0 : targetScore, loserIsA ? targetScore : 0, true);
  }

  function reportDoubleLoss(matchId: string) {
    if (tournament.state === "complete") return;
    if (!window.confirm("このマッチを両者敗北として記録しますか？")) return;
    setTournament((current) => {
      const nextRounds = current.rounds.map((round) => ({
        ...round,
        matches: round.matches.map((match) => {
          if (match.id !== matchId || !match.playerBId) return match;
          return {
            ...match,
            scoreA: match.scoreA ?? 0,
            scoreB: match.scoreB ?? 0,
            winnerId: null,
            resultType: "double-loss" as const,
            resultNote: "両者敗北",
            status: "forced" as const,
          };
        }),
      }));
      return {
        ...current,
        rounds: nextRounds,
        events: [makeEvent(`${matchId} 両者敗北`), ...current.events].slice(0, 12),
      };
    });
  }

  function applyJudgeAction(match: Match, playerId: string, type: JudgeActionType, note: string) {
    if (tournament.state === "complete") return;
    if ((type === "match-loss" || type === "disqualification") && match.playerBId) {
      const playerLabel = playerName(tournament.players, playerId);
      if (!window.confirm(`${playerLabel} を${judgeActionLabels[type]}として記録しますか？`)) return;
    }
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
      const loserIsA = playerId === match.playerAId;
      reportMatch(match.id, loserIsA ? 0 : targetScore, loserIsA ? targetScore : 0, true);
    }
  }

  function nextRoundOrFinish() {
    setTournament((current) => {
      const completedRounds = current.rounds.map((round, index) =>
        index === current.rounds.length - 1 ? { ...round, status: "complete" as const } : round,
      );
      if (completedRounds.length >= current.settings.swissRounds) {
        return {
          ...current,
          state: "complete",
          rounds: completedRounds,
          events: [makeEvent("最終順位を確定"), ...current.events].slice(0, 12),
        };
      }
      const nextRound = activateRound(
        createRound(current.players, completedRounds, current.settings),
        current.settings,
      );
      return {
        ...current,
        state: "running",
        rounds: [...completedRounds, nextRound],
        events: [makeEvent(`Round ${nextRound.number} start`), ...current.events].slice(0, 12),
      };
    });
    setTimerSeconds(
      tournament.settings.timeLimitMinutes > 0 ? tournament.settings.timeLimitMinutes * 60 : null,
    );
    setTimerRunning(tournament.settings.timeLimitMinutes > 0);
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
    <main className={view === "participant" ? "appShell participantShell" : "appShell adminShell"}>
      <section className="topBar">
        <div>
          <p className="eyebrow">SWISS DRAW OPS</p>
          <h1>{tournament.settings.name}</h1>
        </div>
        <div className="modeSwitch" aria-label="view switch">
          <a className={view === "admin" ? "active" : ""} href={adminViewHref}>
            Admin
          </a>
          <a className={view === "participant" ? "active" : ""} href={participantViewHref}>
            Participant
          </a>
        </div>
      </section>

      <section className="statusRail">
        <div>
          <span>状態</span>
          <strong>{tournament.state.toUpperCase()}</strong>
        </div>
        <div>
          <span>Round</span>
          <strong>
            {currentRound?.number ?? "-"} / {tournament.settings.swissRounds}
          </strong>
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

      {eventLoadError ? <div className="noticeBar">{eventLoadError}</div> : null}

      {view === "admin" ? (
        <section className={tournament.state === "setup" ? "workspace adminGrid" : "workspace adminGrid eventIssued"}>
          <form className={showFullSetup ? "panel setupPanel" : "panel setupPanel compactSetup"} onSubmit={createTournament}>
            <div className="panelHeader">
              <div>
                <p className="eyebrow">設定</p>
                <h2>{showFullSetup ? "初期設定" : tournament.settings.name}</h2>
              </div>
              <div className="buttonRow">
                {tournament.state !== "setup" ? (
                  <button type="button" onClick={() => setIsSetupExpanded((current) => !current)}>
                    {showFullSetup ? "閉じる" : "編集"}
                  </button>
                ) : null}
                {showFullSetup ? (
                  <>
                    {tournament.state === "setup" ? (
                      <button className="headerPrimary" onClick={issueTournament} type="button">
                        URL発行
                      </button>
                    ) : null}
                    <button type="button" onClick={saveSettings}>
                      保存
                    </button>
                    <button type="button" onClick={loadSettings}>
                      読込
                    </button>
                  </>
                ) : null}
              </div>
            </div>

            {!showFullSetup ? (
              <div className="issuedBox compactIssuedBox">
                <div>
                  <span>参加者URL</span>
                  <strong>{shareUrl}</strong>
                </div>
                <button type="button" onClick={copyShareUrl}>
                  コピー
                </button>
              </div>
            ) : null}
            {showFullSetup ? (
              <>
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
                        onClick={() =>
                          updateSettings({
                            participantCount: value,
                            swissRounds: recommendedSwissRounds(value),
                          })
                        }
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
                      updateSettings({
                        participantCount: Number(event.target.value),
                        swissRounds: recommendedSwissRounds(Number(event.target.value)),
                      })
                    }
                  />
                </div>
                <label>
                  スイスラウンド数
                  <input
                    min={1}
                    type="number"
                    value={settings.swissRounds}
                    onChange={(event) =>
                      updateSettings({ swissRounds: Math.max(1, Number(event.target.value)) })
                    }
                  />
                </label>
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
                <label className="participantsField">
                  参加者名
                  <textarea
                    value={participantText}
                    onChange={(event) => updateParticipantText(event.target.value)}
                    rows={5}
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
                {tournament.state === "setup" ? (
                  <button className="primaryAction" onClick={issueTournament} type="button">
                    設定してURL発行
                  </button>
                ) : null}
              </>
            ) : null}
          </form>

          <section className="panel opsPanel">
            <div className="panelHeader">
              <div>
                <p className="eyebrow">運営</p>
                <h2>運営卓</h2>
              </div>
              <div className="buttonRow">
                <button
                  disabled={
                    tournament.state === "setup" ||
                    tournament.players.length < 2 ||
                    tournament.state === "complete"
                  }
                  onClick={startRound}
                  type="button"
                >
                  ラウンド開始
                </button>
                <button
                  className="dangerButton"
                  disabled={!currentRound || isComplete}
                  onClick={rematchRound}
                  type="button"
                >
                  このラウンドを再組合せ
                </button>
                <button disabled={!currentRound || isComplete} onClick={toggleTimerStop} type="button">
                  {timerRunning ? "停止" : "再開"}
                </button>
              </div>
            </div>

            {tournament.state === "setup" ? (
              <div className="emptyState compactEmpty">URL発行後に参加者URLを表示します</div>
            ) : (
              <div className="shareGrid">
                <div>
                  <span>参加者URL</span>
                  <strong>{shareUrl}</strong>
                </div>
                <Qr seed={shareUrl} />
                <button type="button" onClick={copyShareUrl}>
                  コピー
                </button>
              </div>
            )}

            {tournament.state !== "setup" ? (
              <section className="deckAdminPanel" aria-label="deck registration status">
                <div className="deckAdminSummary">
                  <span>デッキ登録</span>
                  <strong>
                    {deckRegisteredPlayers.length}/{tournament.players.length}
                  </strong>
                  <em>{deckRegistrationOpen ? "開始前まで受付" : "締切"}</em>
                </div>
                <div className="deckAdminList">
                  {tournament.players.map((player) => {
                    const registered = Boolean(player.deckName?.trim()) || Boolean(player.deckImageName?.trim());
                    return (
                      <div className={registered ? "deckAdminRow done" : "deckAdminRow"} key={player.id}>
                        <span>{registered ? "済" : "未"}</span>
                        <strong>{player.name}</strong>
                        <small>{player.deckImageName || player.deckName || "未登録"}</small>
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : null}

            <div className="matchList">
              {currentRound ? (
                currentRound.matches.map((match) => (
                  <article className="matchRow" key={match.id}>
                    <div className="tableBadge">T{match.table}</div>
                    <div className="matchPlayers">
                      <div className="matchPlayerCell">
                        <span className="sideLabel">左</span>
                        <strong>{playerName(tournament.players, match.playerAId)}</strong>
                        <small>{match.pairingRecordA}</small>
                      </div>
                      <span>vs</span>
                      <div className="matchPlayerCell">
                        <span className="sideLabel">右</span>
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
                      <strong className="tableTime">{formatTime(matchDisplaySeconds(match))}</strong>
                    </div>
                    {match.playerBId ? (
                      <AdminMatchControls
                        key={`${match.id}:${match.scoreA ?? "-"}:${match.scoreB ?? "-"}:${targetScore}`}
                        disabled={isComplete}
                        match={match}
                        players={tournament.players}
                        onApplyJudgeAction={applyJudgeAction}
                        onDoubleLoss={reportDoubleLoss}
                        onExtendTime={extendMatchTime}
                        onForceLoss={forceLoss}
                        onSetFirstPlayer={setFirstPlayer}
                        onReport={reportMatch}
                        targetScore={targetScore}
                      />
                    ) : null}
                  </article>
                ))
              ) : (
                <div className="emptyState">ラウンド未開始</div>
              )}
            </div>

            {currentRound ? (
              <button
                className="primaryAction"
                disabled={!allMatchesDone}
                onClick={nextRoundOrFinish}
                type="button"
              >
                {finalRoundReached ? "大会結果へ" : "次のラウンドへ"}
              </button>
            ) : null}
            <p className="actionHint">
              {currentRound
                ? openMatchCount > 0
                  ? `未報告 ${openMatchCount} マッチ`
                  : finalRoundReached
                    ? "全マッチ報告済み。大会結果を確定できます。"
                    : "全マッチ報告済み。次のラウンドへ進めます。"
                : "ラウンド開始で最初の対戦表を作成します。"}
            </p>
          </section>

          <section className="panel exportPanel">
            <div className="panelHeader">
              <div>
                <p className="eyebrow">{isComplete ? "最終結果" : "暫定結果"}</p>
                <h2>外部連携用データ</h2>
              </div>
            </div>
            <div className="exportSummary">
              <span>{standings.filter((standing) => !standing.disqualified).length}名</span>
              <span>{tournament.rounds.length}/{tournament.settings.swissRounds}R</span>
              <span>{isComplete ? "確定済" : "進行中"}</span>
            </div>
            <div className="exportActions">
              <button disabled={tournament.state === "setup"} onClick={downloadResultsJson} type="button">
                全結果JSON
              </button>
              <button disabled={tournament.state === "setup"} onClick={downloadStandingsCsv} type="button">
                順位CSV
              </button>
              <button disabled={tournament.state === "setup"} onClick={downloadMatchesCsv} type="button">
                対戦CSV
              </button>
              <button disabled={tournament.state === "setup"} onClick={copyResultsJson} type="button">
                JSONコピー
              </button>
            </div>
            <p className="exportNote">
              外部提出・バックアップは全結果JSON、表計算での確認は順位CSVを使います。
            </p>
          </section>

          <StandingsPanel
            isFinal={isComplete}
            standings={standings}
            rounds={tournament.rounds}
            players={tournament.players}
          />
        </section>
      ) : (
        <section className="workspace participantGrid">
          <section className="panel participantInfoPanel">
            <div className="participantPanelHead">
              <p className="eyebrow">参加者</p>
              {initialPlayerLocked ? null : (
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
              )}
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
              <div className="identityLine">
                <strong>{selectedPlayer.name}</strong>
                <span>{selectedPlayer.id}</span>
                <small>{selectedStanding ? `${selectedStanding.matchPoints}MP ${selectedStanding.wins}-${selectedStanding.losses}` : "0MP 0-0"}</small>
              </div>
            ) : (
              <div className="emptyState">No player selected</div>
            )}

            {selectedPlayer ? (
              <div className="deckCheckPanel">
                <label className="checkCompact">
                  <input
                    checked={selectedPlayer.checkedIn}
                    onChange={(event) => setParticipantCheckIn(event.target.checked)}
                    type="checkbox"
                  />
                  チェックイン
                </label>
                <div className="deckStatusLine">
                  <span>デッキ</span>
                  <strong>{selectedPlayer.deckImageName || selectedPlayer.deckName || "未登録"}</strong>
                  <em>{deckRegistrationOpen ? "受付中" : "締切"}</em>
                </div>
                <form className="deckRegisterLine" onSubmit={submitDeckRegistration}>
                  <input
                    aria-label="デッキ名"
                    defaultValue={selectedPlayer.deckName ?? ""}
                    disabled={!deckRegistrationOpen}
                    key={selectedPlayer.id}
                    name="deckName"
                    onBlur={(event) => saveDeckRegistration(event.currentTarget.value)}
                    placeholder="デッキ名"
                    ref={deckInputRef}
                  />
                  <label className="fileButton">
                    画像
                    <input
                      accept="image/*"
                      disabled={!deckRegistrationOpen}
                      onChange={registerDeckImage}
                      type="file"
                    />
                  </label>
                  <button disabled={!deckRegistrationOpen} type="submit">
                    登録
                  </button>
                </form>
              </div>
            ) : null}
          </section>

          <section className="panel participantMatchPanel">
            <div className="participantPanelHead">
              <p className="eyebrow">現在の対戦</p>
              <a className="buttonLink" href={participantViewHref}>
                再読込
              </a>
            </div>

            {selectedMatch && selectedPlayer && selectedMatch.playerBId ? (
              <form className="reportBox" onSubmit={submitParticipantReport}>
                <div className="matchSummary">
                  <strong>T{selectedMatch.table}</strong>
                  <span>R{currentRound?.number ?? "-"}</span>
                  <b>{formatTime(matchDisplaySeconds(selectedMatch))}</b>
                </div>
                <div className="opponentLine">
                  <span>相手</span>
                  <strong>{selectedOpponentName}</strong>
                  <small>{selectedMatch.pairingRecordA} / {selectedMatch.pairingRecordB}</small>
                </div>
                <div className="turnOrderBox">
                  <span>先攻/後攻</span>
                  <strong>
                    {selectedMatch.firstPlayerId
                      ? selectedMatch.firstPlayerId === selectedPlayerId
                        ? "あなたが先攻"
                        : "あなたが後攻"
                      : "未設定"}
                  </strong>
                  <div className="segmented">
                    <button
                      className={selectedMatch.firstPlayerId === selectedPlayerId ? "active" : ""}
                      onClick={() => setFirstPlayer(selectedMatch.id, selectedPlayerId)}
                      type="button"
                    >
                      先攻
                    </button>
                    <button
                      className={
                        selectedMatch.firstPlayerId &&
                        selectedMatch.firstPlayerId !== selectedPlayerId
                          ? "active"
                          : ""
                      }
                      onClick={() =>
                        setFirstPlayer(
                          selectedMatch.id,
                          selectedMatch.playerAId === selectedPlayerId
                            ? selectedMatch.playerBId!
                            : selectedMatch.playerAId,
                        )
                      }
                      type="button"
                    >
                      後攻
                    </button>
                  </div>
                </div>
                {selectedMatch.status === "reported" || selectedMatch.status === "forced" ? (
                  <div className="resultNotice">
                    <strong>報告済み</strong>
                    <span>
                      {selectedMatch.resultType === "double-loss"
                        ? "両者敗北"
                        : `${selectedMatch.scoreA ?? "-"} - ${selectedMatch.scoreB ?? "-"} / 勝者 ${playerName(tournament.players, selectedMatch.winnerId)}`}
                    </span>
                  </div>
                ) : null}
                {canParticipantReport ? (
                  <>
                    <label className="scoreLine">
                      <span>自分</span>
                      <strong>{selectedPlayer.name}</strong>
                      {scoreButtons(reportScores.a, (score) =>
                        setReportScores((current) => ({ ...current, a: score })),
                      )}
                    </label>
                    <label className="scoreLine">
                      <span>相手</span>
                      <strong>{selectedOpponentName}</strong>
                      {scoreButtons(reportScores.b, (score) =>
                        setReportScores((current) => ({ ...current, b: score })),
                      )}
                    </label>
                    <div className="reportPreview">
                      {selectedPlayer.name} {reportScores.a} - {reportScores.b} {selectedOpponentName}
                    </div>
                    <button className="primaryAction" type="submit">
                      この結果で報告
                    </button>
                  </>
                ) : (
                  <div className="resultNotice">
                    <strong>参加者からの変更はできません</strong>
                    <span>修正が必要な場合はスタッフに連絡してください。</span>
                  </div>
                )}
              </form>
            ) : selectedMatch && !selectedMatch.playerBId ? (
              <div className="emptyState">BYE勝利</div>
            ) : (
              <div className="emptyState">
                {tournament.state === "setup" || tournament.state === "ready"
                  ? "ラウンド開始待ち"
                  : "現在の対戦はありません"}
              </div>
            )}
          </section>

          <StandingsPanel
            isFinal={isComplete}
            standings={standings}
            rounds={tournament.rounds}
            players={tournament.players}
          />
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
  disabled = false,
  match,
  players,
  onApplyJudgeAction,
  onDoubleLoss,
  onExtendTime,
  onForceLoss,
  onSetFirstPlayer,
  onReport,
  targetScore,
}: {
  disabled?: boolean;
  match: Match;
  players: Player[];
  onApplyJudgeAction: (match: Match, playerId: string, type: JudgeActionType, note: string) => void;
  onDoubleLoss: (matchId: string) => void;
  onExtendTime: (matchId: string, minutes: number) => void;
  onForceLoss: (match: Match, loserId: string) => void;
  onSetFirstPlayer: (matchId: string, firstPlayerId: string) => void;
  onReport: (matchId: string, scoreA: number, scoreB: number) => void;
  targetScore: number;
}) {
  const [scoreA, setScoreA] = useState(match.scoreA ?? targetScore);
  const [scoreB, setScoreB] = useState(match.scoreB ?? 0);
  const [extensionMinutes, setExtensionMinutes] = useState(1);
  const [judgePlayerId, setJudgePlayerId] = useState(match.playerAId);
  const [judgeAction, setJudgeAction] = useState<JudgeActionType>("caution");
  const [judgeNote, setJudgeNote] = useState("");
  const playerAName = playerName(players, match.playerAId);
  const playerBName = playerName(players, match.playerBId);

  function localScoreButtons(value: number, onChange: (score: number) => void) {
    return (
      <div className="scoreButtons">
        {Array.from({ length: targetScore + 1 }, (_, score) => (
          <button
            className={value === score ? "chip active" : "chip"}
            disabled={disabled}
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
        <div className="scoreGroup">
          <span>{playerAName} スコア</span>
          {localScoreButtons(scoreA, setScoreA)}
        </div>
        <div className="scoreGroup">
          <span>{playerBName} スコア</span>
          {localScoreButtons(scoreB, setScoreB)}
        </div>
        <div className="resultActions">
          <button
            disabled={disabled || scoreA === scoreB || Math.max(scoreA, scoreB) !== targetScore}
            onClick={() => onReport(match.id, scoreA, scoreB)}
            type="button"
          >
            スコア確定
          </button>
          <button disabled={disabled} onClick={() => onForceLoss(match, match.playerAId)} type="button">
            {playerAName}敗北
          </button>
          <button disabled={disabled} onClick={() => onForceLoss(match, match.playerBId!)} type="button">
            {playerBName}敗北
          </button>
          <button disabled={disabled} onClick={() => onDoubleLoss(match.id)} type="button">
            両者敗北
          </button>
        </div>
      </div>

      <div className="turnOrderTools">
        <span>先攻/後攻</span>
        <button
          className={match.firstPlayerId === match.playerAId ? "active" : ""}
          disabled={disabled}
          onClick={() => onSetFirstPlayer(match.id, match.playerAId)}
          type="button"
        >
          {playerAName}先攻
        </button>
        <button
          className={match.firstPlayerId === match.playerBId ? "active" : ""}
          disabled={disabled}
          onClick={() => onSetFirstPlayer(match.id, match.playerBId!)}
          type="button"
        >
          {playerBName}先攻
        </button>
      </div>

      <div className="judgeTools">
        <div className="timeExtend">
          <input
            disabled={disabled}
            min={1}
            type="number"
            value={extensionMinutes}
            onChange={(event) => setExtensionMinutes(Number(event.target.value))}
          />
          <button disabled={disabled} type="button" onClick={() => onExtendTime(match.id, extensionMinutes)}>
            延長
          </button>
        </div>
        <select disabled={disabled} value={judgePlayerId} onChange={(event) => setJudgePlayerId(event.target.value)}>
          <option value={match.playerAId}>{players.find((player) => player.id === match.playerAId)?.name}</option>
          <option value={match.playerBId!}>{players.find((player) => player.id === match.playerBId)?.name}</option>
        </select>
        <select
          disabled={disabled}
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
          disabled={disabled}
          placeholder="裁定メモ"
          value={judgeNote}
          onChange={(event) => setJudgeNote(event.target.value)}
        />
        <button
          disabled={disabled}
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
  isFinal,
  standings,
  rounds,
  players,
}: {
  isFinal: boolean;
  standings: Standing[];
  rounds: Round[];
  players: Player[];
}) {
  const visibleStandings = standings.filter((standing) => !standing.disqualified);
  return (
    <section className="panel standingsPanel">
      <div className="panelHeader">
        <div>
          <p className="eyebrow">{isFinal ? "最終順位" : "暫定順位"}</p>
          <h2>{isFinal ? "最終順位" : "順位"}</h2>
        </div>
      </div>
      {isFinal ? (
        <p className="standingsHint">大会終了済み。この順位を確認してから外部連携用データを保存してください。</p>
      ) : (
        <p className="standingsHint">進行中の暫定順位です。OMW%は対戦相手勝率のタイブレーカーです。</p>
      )}
      <div className="standingRow standingsHead" aria-hidden="true">
        <span>順位</span>
        <strong>プレイヤー</strong>
        <span>MP</span>
        <span>勝</span>
        <span>敗</span>
        <span>OMW</span>
      </div>
      <div className="standingsTable">
        {visibleStandings.map((standing, index) => (
          <div className={standing.dropped ? "standingRow dropped" : "standingRow"} key={standing.id}>
            <span>{index + 1}</span>
            <strong>{standing.name}</strong>
            <span>{standing.matchPoints}MP</span>
            <span>{standing.wins}W</span>
            <span>{standing.losses}L</span>
            <span>{formatPercentage(standing.opponentsMatchWinPercentage)}</span>
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
                <small>
                  {match.resultType === "double-loss"
                    ? "両者敗北"
                    : match.resultType === "bye"
                      ? "BYE"
                      : match.status === "forced"
                        ? "裁定"
                        : match.status}
                  {match.firstPlayerId ? ` / 先攻 ${playerName(players, match.firstPlayerId)}` : ""}
                  {match.judgeActions.length > 0
                    ? ` / ${match.judgeActions
                        .slice(0, 2)
                        .map((action) => `${playerName(players, action.playerId)}:${judgeActionLabels[action.type]}`)
                        .join(", ")}`
                    : ""}
                </small>
              </div>
            ))}
          </details>
        ))}
      </div>
    </section>
  );
}
