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
  makeId,
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
  type TournamentState,
} from "../lib/domain/tournament";
import { qrModules } from "../lib/qr";

const judgeActionLabels: Record<JudgeActionType, string> = {
  caution: "注意",
  warning: "警告",
  "game-loss": "ゲーム敗北",
  "match-loss": "マッチ敗北",
  disqualification: "失格",
};

const tournamentStateLabels: Record<TournamentState, string> = {
  setup: "準備中",
  ready: "受付中",
  running: "進行中",
  complete: "終了",
};

const matchStatusLabels: Record<MatchStatus, string> = {
  waiting: "待機",
  active: "対戦中",
  reported: "報告済",
  forced: "裁定",
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

function participantLockKey(eventCode: string) {
  return `swiss-draw-participant-lock:${eventCode}`;
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

function roundEndsAt(timeLimitMinutes: number): string | null {
  return timeLimitMinutes > 0 ? new Date(Date.now() + timeLimitMinutes * 60_000).toISOString() : null;
}

function remainingSecondsFromEndsAt(endsAt: string | null | undefined): number | null {
  if (!endsAt) return null;
  const remaining = Math.round((new Date(endsAt).getTime() - Date.now()) / 1000);
  return Math.max(0, remaining);
}

function secondsBetween(fromIso: string, toIso?: string | null): number {
  const to = toIso ? new Date(toIso).getTime() : Date.now();
  return Math.max(0, Math.round((to - new Date(fromIso).getTime()) / 1000));
}

function formatElapsed(seconds: number) {
  return `${Math.floor(seconds / 60)}分${String(seconds % 60).padStart(2, "0")}秒`;
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
  const [participantText, setParticipantText] = useState("");
  const [view] = useState<"admin" | "participant">(() =>
    initialView ?? (readInitialSearchParam("view") === "participant" ? "participant" : "admin"),
  );
  const [requestedEventCode] = useState<string | null>(
    () => initialEventCode ?? readInitialSearchParam("event"),
  );
  const [eventLoadError, setEventLoadError] = useState("");
  const [eventMissing, setEventMissing] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isSetupExpanded, setIsSetupExpanded] = useState(true);
  const [selectedPlayerId, setSelectedPlayerId] = useState(
    () => initialPlayerId ?? readInitialSearchParam("player") ?? "P001",
  );
  const [registrationName, setRegistrationName] = useState("");
  const [registrationNotice, setRegistrationNotice] = useState("");
  const [playerConfirmed, setPlayerConfirmed] = useState(initialPlayerLocked);
  const [deckName, setDeckName] = useState("");
  const deckInputRef = useRef<HTMLInputElement>(null);
  const participantCountInputRef = useRef<HTMLInputElement>(null);
  const timeLimitInputRef = useRef<HTMLInputElement>(null);
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const [reportScores, setReportScores] = useState({ a: 0, b: 0 });
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState("");
  const [matchQuery, setMatchQuery] = useState("");
  const [showOpenMatchesOnly, setShowOpenMatchesOnly] = useState(false);
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState<number | null>(
    defaultSettings.timeLimitMinutes * 60,
  );
  // Forces a re-render every second on the participant view so the shared clock stays fresh.
  const [, setNowTick] = useState(0);
  const [tournament, setTournament] = useState<Tournament>({
    settings: defaultSettings,
    state: "setup",
    players: [],
    rounds: [],
    events: [makeEvent("大会設定を作成中")],
  });

  const currentRound = tournament.rounds.at(-1) ?? null;
  const standings = useMemo(
    () => buildStandings(tournament.players, tournament.rounds, tournament.settings),
    [tournament.players, tournament.rounds, tournament.settings],
  );
  // Participants only see standings as of the last completed round; live interim
  // results stay on the admin side until the next pairings are published.
  const completedRounds = useMemo(
    () => tournament.rounds.filter((round) => round.status === "complete"),
    [tournament.rounds],
  );
  const participantStandings = useMemo(
    () => buildStandings(tournament.players, completedRounds, tournament.settings),
    [tournament.players, completedRounds, tournament.settings],
  );
  const selectedPlayer = tournament.players.find((player) => player.id === selectedPlayerId);
  const selectedStanding = standings.find((standing) => standing.id === selectedPlayerId);
  const participantStanding = participantStandings.find(
    (standing) => standing.id === selectedPlayerId,
  );
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
      : `${window.location.origin}${window.location.pathname.replace(/index\.html$/, "")}?view=participant&event=${tournament.settings.eventCode}`;
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
    if (currentRound?.status === "active") {
      if (view === "admin" && timerSeconds !== null) {
        return timerSeconds + match.timeExtensionSeconds;
      }
      const shared = remainingSecondsFromEndsAt(currentRound.endsAt);
      if (shared !== null) {
        return shared + match.timeExtensionSeconds;
      }
      return null;
    }
    return match.timeRemainingSeconds;
  }

  const timerExpired =
    timerSeconds === 0 && currentRound?.status === "active" && !isComplete;
  const normalizedMatchQuery = matchQuery.trim().toLowerCase();
  const visibleMatches = (currentRound?.matches ?? []).filter((match) => {
    if (
      showOpenMatchesOnly &&
      (match.status === "reported" || match.status === "forced")
    ) {
      return false;
    }
    if (!normalizedMatchQuery) return true;
    const nameA = playerName(tournament.players, match.playerAId).toLowerCase();
    const nameB = playerName(tournament.players, match.playerBId).toLowerCase();
    return (
      String(match.table) === normalizedMatchQuery.replace(/^t/, "") ||
      nameA.includes(normalizedMatchQuery) ||
      nameB.includes(normalizedMatchQuery)
    );
  });

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
      const storedRound = stored.rounds.at(-1);
      const sharedRemaining =
        storedRound?.status === "active" ? remainingSecondsFromEndsAt(storedRound.endsAt) : null;
      if (sharedRemaining !== null) {
        setTimerSeconds(sharedRemaining);
        setTimerRunning(sharedRemaining > 0);
      } else {
        setTimerSeconds(
          stored.settings.timeLimitMinutes > 0 ? stored.settings.timeLimitMinutes * 60 : null,
        );
      }
      setIsSetupExpanded(stored.state === "setup");
      const lockName = participantLockKey(stored.settings.eventCode);
      const lockedId = localStorage.getItem(lockName);
      const lockValid =
        Boolean(lockedId) && stored.players.some((storedPlayer) => storedPlayer.id === lockedId);
      const playerMatched =
        Boolean(player) && stored.players.some((storedPlayer) => storedPlayer.id === player);
      if (lockValid && lockedId) {
        // このブラウザは既に本人確認済み。以後は別の参加者へ切り替えられない。
        setSelectedPlayerId(lockedId);
        setPlayerConfirmed(true);
      } else {
        setSelectedPlayerId(playerMatched && player ? player : stored.players[0]?.id ?? "");
        setPlayerConfirmed((current) => current || playerMatched);
        if (playerMatched && player) {
          localStorage.setItem(lockName, player);
        }
        if (player && !playerMatched) {
          setEventLoadError(
            `URLのプレイヤーID ${player} が見つかりません。名前を選び直してください。`,
          );
        }
      }
    } else if (player) {
      setSelectedPlayerId(player);
      if (eventCode) {
        setEventLoadError(`大会 ${eventCode} がこのブラウザに保存されていません。`);
        setEventMissing(true);
      }
    } else if (eventCode) {
      setEventLoadError(`大会 ${eventCode} がこのブラウザに保存されていません。`);
      setEventMissing(true);
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
      setEventMissing(false);
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
    if (!timerRunning) return;
    const id = window.setInterval(() => {
      setTimerSeconds((current) => {
        if (current === null) return null;
        return Math.max(0, current - 1);
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [timerRunning]);

  useEffect(() => {
    if (!timerRunning || timerSeconds !== 0) return;
    setTimerRunning(false);
    setTournament((current) =>
      current.rounds.at(-1)?.status === "active"
        ? {
            ...current,
            events: [
              makeEvent(`ラウンド${current.rounds.at(-1)?.number} 時間切れ`),
              ...current.events,
            ].slice(0, 30),
          }
        : current,
    );
  }, [timerRunning, timerSeconds]);

  useEffect(() => {
    setReportScores({ a: 0, b: 0 });
  }, [selectedMatch?.id, selectedPlayerId]);

  useEffect(() => {
    // Keeps the shared round clock and judge-call stopwatches fresh on both views.
    const id = window.setInterval(() => {
      setNowTick((tick) => tick + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

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
    if (tournament.state !== "setup") return;
    if (settings.inputMode !== "qr" && countEntryNames(participantText) === 0) {
      window.alert("参加者名を入力してください（1行に1名）。");
      return;
    }
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
    // Guard: pressing Enter in a settings input must never re-issue a running tournament.
    if (tournament.state !== "setup") return;
    issueTournament();
  }

  function showSettingsNotice(text: string) {
    setSettingsNotice(text);
    window.setTimeout(() => setSettingsNotice(""), 2500);
  }

  function saveSettings() {
    localStorage.setItem("swiss-draw-settings", JSON.stringify(settings));
    showSettingsNotice("既定値として保存しました");
  }

  function loadSettings() {
    const saved = localStorage.getItem("swiss-draw-settings");
    if (!saved) {
      showSettingsNotice("保存された設定がありません");
      return;
    }
    try {
      const loaded = JSON.parse(saved) as Settings;
      setSettings({
        ...loaded,
        bestOf: normalizeBestOf(loaded.bestOf),
        swissRounds: loaded.swissRounds ?? recommendedSwissRounds(loaded.participantCount),
      });
      showSettingsNotice("既定値を読み込みました");
    } catch {
      showSettingsNotice("保存データを読み込めませんでした");
    }
  }

  function startNewTournament() {
    if (
      !window.confirm(
        "新しい大会の設定を開始します。現在の大会データはこのブラウザに保存されたまま残ります。よろしいですか？",
      )
    ) {
      return;
    }
    const nextSettings = { ...defaultSettings, eventCode: "" };
    setSettings(nextSettings);
    setParticipantText("");
    setTournament({
      settings: nextSettings,
      state: "setup",
      players: [],
      rounds: [],
      events: [makeEvent("大会設定を作成中")],
    });
    setTimerRunning(false);
    setTimerSeconds(nextSettings.timeLimitMinutes * 60);
    setIsSetupExpanded(true);
  }

  function importTournamentJson(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as { tournament?: Tournament } & Tournament;
        const restored = normalizeTournament(parsed.tournament ?? parsed);
        if (!restored.settings?.eventCode || !Array.isArray(restored.players)) {
          throw new Error("invalid");
        }
        setTournament({
          ...restored,
          events: [makeEvent("バックアップJSONから復元"), ...restored.events].slice(0, 30),
        });
        setSettings(restored.settings);
        setSelectedPlayerId(restored.players[0]?.id ?? "");
        setEventLoadError("");
        setIsSetupExpanded(false);
      } catch {
        window.alert("JSONを読み込めませんでした。全結果JSONのバックアップファイルを指定してください。");
      }
    };
    reader.readAsText(file);
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
    if (!navigator.clipboard) {
      window.prompt("URLをコピーしてください", shareUrl);
      return;
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      window.prompt("URLをコピーしてください", shareUrl);
      return;
    }
    setCopyFeedback(true);
    window.setTimeout(() => setCopyFeedback(false), 2000);
    setTournament((current) => ({
      ...current,
      events: [makeEvent("参加者URLをコピー"), ...current.events].slice(0, 30),
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
      events: [makeEvent("結果JSONをコピー"), ...current.events].slice(0, 30),
    }));
  }

  function registerParticipant(event: FormEvent) {
    event.preventDefault();
    const name = registrationName.trim();
    if (!name) {
      setRegistrationNotice("参加者名を入力してください。");
      return;
    }
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
      localStorage.setItem(participantLockKey(current.settings.eventCode), nextId);
      return {
        ...current,
        settings: nextSettings,
        players: nextPlayers,
        events: [makeEvent(`${name} が参加登録`), ...current.events].slice(0, 30),
      };
    });
    setRegistrationName("");
    setRegistrationNotice(`${name} さんとして登録しました。`);
    setPlayerConfirmed(true);
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
      ].slice(0, 30),
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
      events: [makeEvent(`${selectedPlayer.name} デッキ登録更新`), ...current.events].slice(0, 30),
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
      events: [makeEvent(`${selectedPlayer.name} デッキ画像登録`), ...current.events].slice(0, 30),
    }));
  }

  function startRound() {
    if (currentRound?.status === "active") return;
    const deckFeatureInUse = deckRegisteredPlayers.length > 0;
    if (deckFeatureInUse && tournament.rounds.length === 0 && missingDeckPlayers.length > 0) {
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
      const activeRound = {
        ...activateRound(round, current.settings),
        endsAt: roundEndsAt(current.settings.timeLimitMinutes),
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
        events: [makeEvent(`ラウンド${activeRound.number} 開始`), ...current.events].slice(0, 30),
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
    const judgeActionCount = currentRound.matches.reduce(
      (total, match) => total + match.judgeActions.length,
      0,
    );
    const warningSuffix =
      judgeActionCount > 0 ? `\n※このラウンドのジャッジ記録 ${judgeActionCount} 件も破棄されます。` : "";
    if (
      (hasResults || judgeActionCount > 0) &&
      !window.confirm(`このラウンドの結果を破棄して再マッチングしますか？${warningSuffix}`)
    ) {
      return;
    }
    setTournament((current) => {
      const completedRounds = current.rounds.slice(0, -1);
      const nextRound = createRound(current.players, completedRounds, current.settings);
      return {
        ...current,
        rounds: [...completedRounds, {
          ...nextRound,
          status: "active" as const,
          endsAt: roundEndsAt(current.settings.timeLimitMinutes),
          matches: nextRound.matches.map((match) =>
            match.status === "waiting" ? { ...match, status: "active" as const } : match,
          ),
        }],
        events: [makeEvent(`ラウンド${nextRound.number} を再組合せ`), ...current.events].slice(0, 30),
      };
    });
    setTimerSeconds(
      tournament.settings.timeLimitMinutes > 0 ? tournament.settings.timeLimitMinutes * 60 : null,
    );
    setTimerRunning(tournament.settings.timeLimitMinutes > 0);
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
            events: [makeEvent(`${matchId} を${minutes}分延長`), ...current.events].slice(0, 30),
          }),
    }));
  }

  function remainingSecondsAtReport(round: Round, match: Match): number | null {
    if (round.status !== "active") return match.timeRemainingSeconds;
    const shared = remainingSecondsFromEndsAt(round.endsAt);
    const base = shared ?? timerSeconds;
    if (base === null) return match.timeRemainingSeconds;
    return base + match.timeExtensionSeconds;
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
            // Freeze the clock at the moment the result is recorded.
            timeRemainingSeconds: remainingSecondsAtReport(round, match),
          };
        }),
      }));
      const updatedRound = nextRounds.at(-1);
      const reported = updatedRound?.matches.find((match) => match.id === matchId);
      const winner = reported ? playerName(current.players, reported.winnerId) : "";
      return {
        ...current,
        rounds: nextRounds,
        events: [makeEvent(`${winner} 勝利 ${scoreA}-${scoreB}`), ...current.events].slice(0, 30),
      };
    });
  }

  function togglePlayerDrop(playerId: string) {
    const target = tournament.players.find((player) => player.id === playerId);
    if (!target || isComplete) return;
    const next = !target.dropped;
    const message = next
      ? `${target.name} をドロップ（棄権）として記録しますか？\n進行中のマッチはそのまま有効で、次のラウンドの組み合わせから除外されます。`
      : `${target.name} のドロップを取り消して、次のラウンドから組み合わせに戻しますか？`;
    if (!window.confirm(message)) return;
    setTournament((current) => ({
      ...current,
      players: current.players.map((player) =>
        player.id === playerId ? { ...player, dropped: next } : player,
      ),
      events: [
        makeEvent(`${target.name} ${next ? "ドロップ" : "ドロップ取消"}`),
        ...current.events,
      ].slice(0, 30),
    }));
  }

  function recordJudgeCall(matchId: string) {
    setTournament((current) => {
      if (current.state === "complete") return current;
      const table = current.rounds
        .flatMap((round) => round.matches)
        .find((match) => match.id === matchId)?.table;
      return {
        ...current,
        rounds: current.rounds.map((round) => ({
          ...round,
          matches: round.matches.map((match) => {
            if (match.id !== matchId) return match;
            const calls = match.judgeCalls ?? [];
            if (calls.some((call) => !call.resolvedAt)) return match;
            return {
              ...match,
              judgeCalls: [
                {
                  id: makeId(),
                  calledAt: new Date().toISOString(),
                  resolvedAt: null,
                },
                ...calls,
              ],
            };
          }),
        })),
        events: [makeEvent(`T${table ?? "?"} ジャッジ呼出`), ...current.events].slice(0, 30),
      };
    });
  }

  function resolveJudgeCall(matchId: string) {
    setTournament((current) => {
      if (current.state === "complete") return current;
      let logText = "";
      const rounds = current.rounds.map((round) => ({
        ...round,
        matches: round.matches.map((match) => {
          if (match.id !== matchId) return match;
          const calls = match.judgeCalls ?? [];
          const open = calls.find((call) => !call.resolvedAt);
          if (!open) return match;
          const resolvedAt = new Date().toISOString();
          const seconds = Math.max(
            0,
            Math.round((new Date(resolvedAt).getTime() - new Date(open.calledAt).getTime()) / 1000),
          );
          logText = `T${match.table} ジャッジ対応終了（${Math.floor(seconds / 60)}分${seconds % 60}秒）`;
          return {
            ...match,
            judgeCalls: calls.map((call) =>
              call.id === open.id ? { ...call, resolvedAt } : call,
            ),
          };
        }),
      }));
      if (!logText) return current;
      return {
        ...current,
        rounds,
        events: [makeEvent(logText), ...current.events].slice(0, 30),
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
            ].slice(0, 30),
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
            timeRemainingSeconds: remainingSecondsAtReport(round, match),
          };
        }),
      }));
      return {
        ...current,
        rounds: nextRounds,
        events: [makeEvent(`${matchId} 両者敗北`), ...current.events].slice(0, 30),
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
      id: makeId(),
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
      ].slice(0, 30),
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
    if (
      finalRoundReached &&
      !window.confirm(
        "大会を終了して最終順位を確定します。以後、結果の修正はできません。よろしいですか？",
      )
    ) {
      return;
    }
    setTournament((current) => {
      const completedRounds = current.rounds.map((round, index) =>
        index === current.rounds.length - 1 ? { ...round, status: "complete" as const } : round,
      );
      if (completedRounds.length >= current.settings.swissRounds) {
        return {
          ...current,
          state: "complete",
          rounds: completedRounds,
          events: [makeEvent("最終順位を確定"), ...current.events].slice(0, 30),
        };
      }
      const nextRound = {
        ...activateRound(
          createRound(current.players, completedRounds, current.settings),
          current.settings,
        ),
        endsAt: roundEndsAt(current.settings.timeLimitMinutes),
      };
      return {
        ...current,
        state: "running",
        rounds: [...completedRounds, nextRound],
        events: [makeEvent(`ラウンド${nextRound.number} 開始`), ...current.events].slice(0, 30),
      };
    });
    setTimerSeconds(
      tournament.settings.timeLimitMinutes > 0 ? tournament.settings.timeLimitMinutes * 60 : null,
    );
    setTimerRunning(tournament.settings.timeLimitMinutes > 0);
  }

  function setRoundEndsAt(endsAt: string | null) {
    setTournament((current) => {
      const lastRound = current.rounds.at(-1);
      if (!lastRound || lastRound.status !== "active") return current;
      return {
        ...current,
        rounds: current.rounds.map((round, index) =>
          index === current.rounds.length - 1 ? { ...round, endsAt } : round,
        ),
      };
    });
  }

  function toggleTimerStop() {
    if (timerRunning) {
      if (!window.confirm("タイマーを停止しますか？")) return;
      setTimerRunning(false);
      setRoundEndsAt(null);
      return;
    }
    setTimerRunning(true);
    if (timerSeconds !== null) {
      setRoundEndsAt(new Date(Date.now() + timerSeconds * 1000).toISOString());
    }
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
    const selfName = playerName(tournament.players, selectedPlayerId);
    if (
      !window.confirm(
        `${selfName} ${reportScores.a} - ${reportScores.b} ${selectedOpponentName}\nこの結果で報告します。報告後の変更はスタッフのみ可能です。よろしいですか？`,
      )
    ) {
      return;
    }
    reportMatch(selectedMatch.id, scoreA, scoreB);
  }

  function submitSimpleResult(didWin: boolean) {
    if (!selectedMatch || !selectedMatch.playerBId || !selectedPlayer) return;
    if (
      !window.confirm(
        `${selectedPlayer.name} の${didWin ? "勝ち" : "負け"}で報告します。報告後の変更はスタッフのみ可能です。よろしいですか？`,
      )
    ) {
      return;
    }
    const isA = selectedMatch.playerAId === selectedPlayerId;
    const selfScore = didWin ? targetScore : 0;
    const opponentScore = didWin ? 0 : targetScore;
    reportMatch(
      selectedMatch.id,
      isA ? selfScore : opponentScore,
      isA ? opponentScore : selfScore,
    );
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

  if (!isHydrated) {
    // Render the same minimal shell on server and first client paint to avoid hydration
    // mismatches caused by query-parameter-driven view switching on the static export.
    return <main className="appShell" aria-busy="true" />;
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
          <strong>{tournamentStateLabels[tournament.state]}</strong>
        </div>
        <div>
          <span>ラウンド</span>
          <strong>
            {currentRound?.number ?? "-"} / {tournament.settings.swissRounds}
          </strong>
        </div>
        <div className={timerExpired ? "timeUp" : undefined}>
          <span>残り時間</span>
          <strong>{timerExpired ? "時間切れ" : formatTime(timerSeconds)}</strong>
        </div>
        <div>
          <span>参加者</span>
          <strong>{tournament.players.length}</strong>
        </div>
        <div>
          <span>BO</span>
          <strong>
            {tournament.settings.bestOf}
            <small>（{seriesTarget(tournament.settings.bestOf)}本先取）</small>
          </strong>
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
                  <>
                    <button type="button" onClick={() => setIsSetupExpanded((current) => !current)}>
                      {showFullSetup ? "閉じる" : "設定を確認"}
                    </button>
                    <button type="button" onClick={startNewTournament}>
                      新規大会
                    </button>
                  </>
                ) : null}
                {showFullSetup && tournament.state === "setup" ? (
                  <>
                    <button className="headerPrimary" onClick={issueTournament} type="button">
                      この内容で大会を作成
                    </button>
                    <button type="button" onClick={saveSettings}>
                      設定を保存
                    </button>
                    <button type="button" onClick={loadSettings}>
                      設定を読込
                    </button>
                  </>
                ) : null}
                {settingsNotice ? <span className="settingsNotice">{settingsNotice}</span> : null}
              </div>
            </div>
            {showFullSetup && tournament.state !== "setup" ? (
              <p className="fieldNote">
                大会は作成済みです。ここでの変更は作成済みの大会には反映されません。
              </p>
            ) : null}

            {!showFullSetup ? (
              <div className="issuedBox compactIssuedBox">
                <div>
                  <span>参加者URL</span>
                  <strong>{shareUrl}</strong>
                </div>
                <button type="button" onClick={copyShareUrl}>
                  {copyFeedback ? "コピーしました" : "コピー"}
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
                      onClick={() => participantCountInputRef.current?.focus()}
                      type="button"
                    >
                      自由入力
                    </button>
                  </div>
                  <input
                    aria-label="参加者数（自由入力）"
                    min={2}
                    ref={participantCountInputRef}
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
                      onClick={() => timeLimitInputRef.current?.focus()}
                      type="button"
                    >
                      自由入力
                    </button>
                  </div>
                  <input
                    aria-label="制限時間（分・自由入力）"
                    min={0}
                    ref={timeLimitInputRef}
                    type="number"
                    value={settings.timeLimitMinutes}
                    onChange={(event) =>
                      updateSettings({ timeLimitMinutes: Number(event.target.value) })
                    }
                  />
                </div>
                <div className="optionBlock">
                  <span>参加者の集め方</span>
                  <div className="segmented optionButtons">
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
                  <p className="modeHint">
                    {settings.inputMode === "paste"
                      ? "運営が下の欄に参加者名を入力します。"
                      : settings.inputMode === "qr"
                        ? "参加者が参加者画面から自分で名前を登録します（名前欄は空のままでも作成できます）。"
                        : "事前登録IDでの参照は準備中です。現在はExcelコピーをご利用ください。"}
                  </p>
                </div>
                <label className="participantsField">
                  参加者名
                  <textarea
                    placeholder={"1行に1名。Excelの名前列をコピーして貼り付けできます。\n例:\n山田 太郎\n佐藤 花子"}
                    value={participantText}
                    onChange={(event) => updateParticipantText(event.target.value)}
                    rows={5}
                  />
                </label>
                {tournament.state === "setup" ? (
                  <button
                    type="button"
                    onClick={() => updateParticipantText(sampleNames.join("\n"))}
                  >
                    サンプル名を入力（動作確認用）
                  </button>
                ) : null}
                <div className="optionBlock">
                  <span>BO（何本勝負か）</span>
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
                  <p className="modeHint">BO{settings.bestOf} = {seriesTarget(settings.bestOf)}本先取でマッチ勝利です。</p>
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
                    参加費あり（円）
                  </label>
                  <input
                    aria-label="参加費（円）"
                    disabled={!settings.hasEntryFee}
                    min={0}
                    type="number"
                    value={settings.entryFee}
                    onChange={(event) => updateSettings({ entryFee: Number(event.target.value) })}
                  />
                </div>
                {tournament.state === "setup" ? (
                  <>
                    <button className="primaryAction" onClick={issueTournament} type="button">
                      この内容で大会を作成
                    </button>
                    <p className="fieldNote">作成すると参加者用URLとQRコードが発行されます。</p>
                  </>
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
                    tournament.state === "complete" ||
                    currentRound?.status === "active"
                  }
                  onClick={startRound}
                  type="button"
                >
                  {currentRound?.status === "active"
                    ? `ラウンド${currentRound.number} 進行中`
                    : `ラウンド${(currentRound?.number ?? 0) + 1} を開始`}
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
              <>
                <div className="shareGrid">
                  <div>
                    <span>参加者URL</span>
                    <strong>{shareUrl}</strong>
                  </div>
                  <Qr seed={shareUrl} />
                  <button type="button" onClick={copyShareUrl}>
                    {copyFeedback ? "コピーしました" : "コピー"}
                  </button>
                </div>
                <p className="fieldNote">
                  ※大会データはこのブラウザにのみ保存されます。参加者URL/QRは同じ端末・同じブラウザの別タブで開いた場合に動作します。
                </p>
              </>
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

            {currentRound && currentRound.matches.length > 0 ? (
              <div className="matchFilterBar">
                <input
                  aria-label="卓番号またはプレイヤー名で絞り込み"
                  placeholder="卓番号・プレイヤー名で検索"
                  value={matchQuery}
                  onChange={(event) => setMatchQuery(event.target.value)}
                />
                <button
                  className={showOpenMatchesOnly ? "active" : ""}
                  onClick={() => setShowOpenMatchesOnly((current) => !current)}
                  type="button"
                >
                  未報告のみ{showOpenMatchesOnly ? ` (${openMatchCount})` : ""}
                </button>
              </div>
            ) : null}

            <div className="matchList">
              {currentRound ? (
                visibleMatches.length === 0 ? (
                  <div className="emptyState">
                    {currentRound.matches.length === 0
                      ? "マッチがありません"
                      : "条件に一致するマッチがありません"}
                  </div>
                ) : (
                visibleMatches.map((match) => (
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
                      <em>{matchStatusLabels[match.status]}</em>
                      {isStairPairing(match) ? (
                        <b className="pairingBadge" title="勝敗数の異なるプレイヤー同士の組み合わせです">階段</b>
                      ) : null}
                      <strong
                        className={
                          matchDisplaySeconds(match) === 0 &&
                          match.status !== "reported" &&
                          match.status !== "forced"
                            ? "tableTime expired"
                            : "tableTime"
                        }
                      >
                        {formatTime(matchDisplaySeconds(match))}
                      </strong>
                    </div>
                    {match.playerBId ? (
                      <AdminMatchControls
                        key={match.id}
                        disabled={isComplete}
                        match={match}
                        players={tournament.players}
                        onApplyJudgeAction={applyJudgeAction}
                        onDoubleLoss={reportDoubleLoss}
                        onExtendTime={extendMatchTime}
                        onForceLoss={forceLoss}
                        onJudgeCall={recordJudgeCall}
                        onJudgeResolve={resolveJudgeCall}
                        onSetFirstPlayer={setFirstPlayer}
                        onReport={reportMatch}
                        targetScore={targetScore}
                      />
                    ) : null}
                  </article>
                ))
                )
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
                {finalRoundReached ? "大会を終了して結果を確定" : "次のラウンドへ"}
              </button>
            ) : null}
            <p className="actionHint">
              {currentRound
                ? openMatchCount > 0
                  ? `未報告 ${openMatchCount} マッチ`
                  : finalRoundReached
                    ? "全マッチ報告済み。大会を終了すると以後の修正はできません。"
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
              <button onClick={() => importFileInputRef.current?.click()} type="button">
                JSONから復元
              </button>
              <input
                accept="application/json,.json"
                aria-label="バックアップJSONを選択"
                hidden
                onChange={importTournamentJson}
                ref={importFileInputRef}
                type="file"
              />
            </div>
            <p className="exportNote">
              外部提出・バックアップは全結果JSON、表計算での確認は順位CSVを使います。ブラウザのデータが消えた場合は「JSONから復元」でバックアップを読み込めます。
            </p>
          </section>

          <StandingsPanel
            isFinal={isComplete}
            standings={standings}
            rounds={tournament.rounds}
            players={tournament.players}
            showPenaltyLog
            onToggleDrop={isComplete ? undefined : togglePlayerDrop}
          />
        </section>
      ) : eventMissing ? (
        <section className="workspace participantGrid">
          <section className="panel noticePanel">
            <strong>この大会のデータが見つかりません</strong>
            <p>
              大会コード: {requestedEventCode ?? "不明"}
            </p>
            <p>
              大会データは運営端末のブラウザにのみ保存されています。このURLは運営と同じ端末・同じブラウザで開いた場合にのみ表示できます。
            </p>
            <p>会場では受付またはスタッフに声をかけて、対戦表を確認してください。</p>
          </section>
        </section>
      ) : view === "participant" && !playerConfirmed && tournament.players.length > 0 ? (
        <section className="workspace participantGrid">
          <section className="panel noticePanel">
            <strong>あなたの名前を選んでください</strong>
            <p>結果報告やチェックインは選んだ本人として記録されます。</p>
            <div className="playerConfirmBox">
              <select
                aria-label="参加者を選択"
                value={selectedPlayerId}
                onChange={(event) => setSelectedPlayerId(event.target.value)}
              >
                {tournament.players.map((player) => (
                  <option key={player.id} value={player.id}>
                    {player.id} / {player.name}
                  </option>
                ))}
              </select>
              <button
                className="primaryAction"
                type="button"
                onClick={() => {
                  const chosen = tournament.players.find((player) => player.id === selectedPlayerId);
                  if (!chosen) return;
                  if (
                    window.confirm(
                      `${chosen.name} さんとして参加します。決定後にこの端末で別の参加者へ切り替えることはできません。よろしいですか？`,
                    )
                  ) {
                    localStorage.setItem(
                      participantLockKey(tournament.settings.eventCode),
                      chosen.id,
                    );
                    setPlayerConfirmed(true);
                  }
                }}
              >
                この名前で参加する
              </button>
            </div>
            {tournament.settings.inputMode === "qr" &&
            (tournament.state === "setup" || tournament.state === "ready") ? (
              <>
                <p>リストに名前がない場合は、ここから参加登録できます。</p>
                <form className="joinBox" onSubmit={registerParticipant}>
                  <input
                    aria-label="参加者名"
                    placeholder="参加者名"
                    value={registrationName}
                    onChange={(event) => setRegistrationName(event.target.value)}
                  />
                  <button type="submit">参加登録</button>
                </form>
                {registrationNotice ? <p className="fieldNote">{registrationNotice}</p> : null}
              </>
            ) : null}
          </section>
        </section>
      ) : (
        <section className="workspace participantGrid">
          <section className="panel participantInfoPanel">
            <div className="participantPanelHead">
              <p className="eyebrow">参加者</p>
            </div>

            {tournament.settings.inputMode === "qr" &&
            (tournament.state === "setup" || tournament.state === "ready") ? (
              <>
                <form className="joinBox" onSubmit={registerParticipant}>
                  <input
                    aria-label="参加者名"
                    placeholder="参加者名"
                    value={registrationName}
                    onChange={(event) => setRegistrationName(event.target.value)}
                  />
                  <button type="submit">参加登録</button>
                </form>
                {registrationNotice ? <p className="fieldNote">{registrationNotice}</p> : null}
              </>
            ) : null}

            {selectedPlayer ? (
              <div className="identityLine">
                <strong>{selectedPlayer.name}</strong>
                <span>{selectedPlayer.id}</span>
                <small>
                  {(() => {
                    const shown = isComplete ? selectedStanding : participantStanding;
                    return shown
                      ? `${shown.wins}勝${shown.losses}敗・勝ち点${shown.matchPoints}`
                      : "0勝0敗・勝ち点0";
                  })()}
                </small>
              </div>
            ) : (
              <div className="emptyState">参加者が選択されていません</div>
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
                <p className="fieldNote">
                  ※デッキ画像はこの端末での記録のみで、運営には送信されません。
                </p>
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

            {isComplete && selectedStanding ? (
              <div className="completeBanner">
                <strong>大会終了</strong>
                <span>
                  あなたの最終成績: {" "}
                  {standings.filter((standing) => !standing.disqualified).findIndex((standing) => standing.id === selectedPlayerId) + 1}
                  位（{selectedStanding.wins}勝{selectedStanding.losses}敗）
                </span>
              </div>
            ) : null}

            {selectedMatch && selectedPlayer && selectedMatch.playerBId ? (
              <form className="reportBox" onSubmit={submitParticipantReport}>
                <div className="matchSummary">
                  <strong>T{selectedMatch.table}</strong>
                  <span>ラウンド{currentRound?.number ?? "-"}</span>
                  <b>
                    {matchDisplaySeconds(selectedMatch) === null &&
                    currentRound?.status === "active" &&
                    tournament.settings.timeLimitMinutes > 0
                      ? "タイマー停止中"
                      : formatTime(matchDisplaySeconds(selectedMatch))}
                  </b>
                </div>
                <div className="opponentLine">
                  <span>相手</span>
                  <strong>{selectedOpponentName}</strong>
                  <small>
                    自分 {selectedMatch.playerAId === selectedPlayerId
                      ? selectedMatch.pairingRecordA
                      : selectedMatch.pairingRecordB}{" "}
                    / 相手 {selectedMatch.playerAId === selectedPlayerId
                      ? selectedMatch.pairingRecordB
                      : selectedMatch.pairingRecordA}
                  </small>
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
                {currentRound?.status === "active" && !isComplete ? (
                  (() => {
                    const openCall = (selectedMatch.judgeCalls ?? []).find(
                      (call) => !call.resolvedAt,
                    );
                    return openCall ? (
                      <div className="judgeCallLine active">
                        <strong>
                          ジャッジを呼び出し中（{formatElapsed(secondsBetween(openCall.calledAt))}経過）
                        </strong>
                        <small>そのままお待ちください。</small>
                      </div>
                    ) : (
                      <div className="judgeCallLine">
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm("ジャッジを呼び出しますか？呼出時刻が記録されます。")) {
                              recordJudgeCall(selectedMatch.id);
                            }
                          }}
                        >
                          ジャッジを呼ぶ
                        </button>
                        <small>困ったときは手を挙げてスタッフにも知らせてください。</small>
                      </div>
                    );
                  })()
                ) : null}
                {selectedMatch.status === "reported" || selectedMatch.status === "forced" ? (
                  <div className="resultNotice">
                    <strong>報告済み</strong>
                    <span>
                      {isComplete
                        ? selectedMatch.resultType === "double-loss"
                          ? "両者敗北"
                          : `${selectedMatch.scoreA ?? "-"} - ${selectedMatch.scoreB ?? "-"} / 勝者 ${playerName(tournament.players, selectedMatch.winnerId)}`
                        : "結果を受け付けました。順位は次のラウンド発表時に更新されます。"}
                    </span>
                  </div>
                ) : null}
                {canParticipantReport ? (
                  targetScore === 1 ? (
                    <div className="simpleReport">
                      <button
                        className="primaryAction"
                        type="button"
                        onClick={() => submitSimpleResult(true)}
                      >
                        勝ちました
                      </button>
                      <button type="button" onClick={() => submitSimpleResult(false)}>
                        負けました
                      </button>
                    </div>
                  ) : (
                  <>
                    <div className="scoreLine">
                      <span>自分</span>
                      <strong>{selectedPlayer.name}</strong>
                      {scoreButtons(reportScores.a, (score) =>
                        setReportScores((current) => ({ ...current, a: score })),
                      )}
                    </div>
                    <div className="scoreLine">
                      <span>相手</span>
                      <strong>{selectedOpponentName}</strong>
                      {scoreButtons(reportScores.b, (score) =>
                        setReportScores((current) => ({ ...current, b: score })),
                      )}
                    </div>
                    <div className="reportPreview">
                      {selectedPlayer.name} {reportScores.a} - {reportScores.b} {selectedOpponentName}
                    </div>
                    <button className="primaryAction" type="submit">
                      この結果で報告
                    </button>
                  </>
                  )
                ) : (
                  <div className="resultNotice">
                    <strong>参加者からの変更はできません</strong>
                    <span>修正が必要な場合はスタッフに連絡してください。</span>
                  </div>
                )}
              </form>
            ) : selectedMatch && !selectedMatch.playerBId ? (
              <div className="resultNotice">
                <strong>このラウンドは不戦勝（BYE）です</strong>
                <span>
                  対戦相手がいないため自動的に1勝がつきます。次のラウンド開始までお待ちください。
                </span>
              </div>
            ) : (
              <div className="emptyState">
                {tournament.state === "setup" || tournament.state === "ready"
                  ? "ラウンド開始待ちです。対戦表が発表されるとここに表示されます。"
                  : "現在の対戦はありません"}
              </div>
            )}
          </section>

          <StandingsPanel
            isFinal={isComplete}
            standings={isComplete ? standings : participantStandings}
            rounds={completedRounds}
            players={tournament.players}
            selfId={selectedPlayerId}
          />
        </section>
      )}

      {view === "admin" && tournament.events.length > 0 ? (
        <section className="ticker" aria-label="round events">
          <div className="tickerTrack">
            <div className="tickerGroup">
              {tournament.events.map((event) => (
                <span key={event.id}>{event.text}</span>
              ))}
            </div>
            <div className="tickerGroup" aria-hidden="true">
              {tournament.events.map((event) => (
                <span key={`dup-${event.id}`}>{event.text}</span>
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}

function Qr({ seed }: { seed: string }) {
  const modules = useMemo(() => {
    try {
      return qrModules(seed || "swiss-draw");
    } catch {
      return null;
    }
  }, [seed]);
  if (!modules) return null;
  const size = modules.length;
  const quiet = 4;
  const total = size + quiet * 2;
  return (
    <div className="qrBox">
      <svg
        role="img"
        aria-label="参加者URLのQRコード"
        shapeRendering="crispEdges"
        viewBox={`0 0 ${total} ${total}`}
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect fill="#ffffff" height={total} width={total} x={0} y={0} />
        {modules.flatMap((row, y) =>
          row.map((dark, x) =>
            dark ? (
              <rect
                fill="#000000"
                height={1}
                key={`${x}-${y}`}
                width={1}
                x={x + quiet}
                y={y + quiet}
              />
            ) : null,
          ),
        )}
      </svg>
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
  onJudgeCall,
  onJudgeResolve,
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
  onJudgeCall: (matchId: string) => void;
  onJudgeResolve: (matchId: string) => void;
  onSetFirstPlayer: (matchId: string, firstPlayerId: string) => void;
  onReport: (matchId: string, scoreA: number, scoreB: number) => void;
  targetScore: number;
}) {
  // -1 means "not selected yet" so a hurried tap on 確定 can never record a default winner.
  const [scoreA, setScoreA] = useState(match.scoreA ?? -1);
  const [scoreB, setScoreB] = useState(match.scoreB ?? -1);
  const [extensionMinutes, setExtensionMinutes] = useState(1);
  const [judgePlayerId, setJudgePlayerId] = useState(match.playerAId);
  const [judgeAction, setJudgeAction] = useState<JudgeActionType>("caution");
  const [judgeNote, setJudgeNote] = useState("");
  const playerAName = playerName(players, match.playerAId);
  const playerBName = playerName(players, match.playerBId);
  const scoresChosen = scoreA >= 0 && scoreB >= 0;
  const canConfirm =
    scoresChosen && scoreA !== scoreB && Math.max(scoreA, scoreB) === targetScore;
  const judgeCalls = match.judgeCalls ?? [];
  const openJudgeCall = judgeCalls.find((call) => !call.resolvedAt) ?? null;
  const lastResolvedCall = judgeCalls.find((call) => call.resolvedAt) ?? null;
  const lastResolvedSeconds = lastResolvedCall
    ? secondsBetween(lastResolvedCall.calledAt, lastResolvedCall.resolvedAt)
    : null;

  useEffect(() => {
    if (match.scoreA !== null) setScoreA(match.scoreA);
    if (match.scoreB !== null) setScoreB(match.scoreB);
  }, [match.scoreA, match.scoreB]);

  useEffect(() => {
    // After a judge call is resolved, suggest the interruption length as the extension.
    if (lastResolvedSeconds !== null && lastResolvedSeconds >= 60) {
      setExtensionMinutes(Math.max(1, Math.ceil(lastResolvedSeconds / 60)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastResolvedCall?.id, lastResolvedCall?.resolvedAt]);

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
            disabled={disabled || !canConfirm}
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
        {!disabled && !canConfirm ? (
          <p className="fieldNote">
            勝者のスコアを {targetScore} にすると確定できます（同点は「両者敗北」で記録します）。
          </p>
        ) : null}
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

      <div className={openJudgeCall ? "judgeCallLine active" : "judgeCallLine"}>
        {openJudgeCall ? (
          <>
            <strong>ジャッジ対応中 {formatElapsed(secondsBetween(openJudgeCall.calledAt))}</strong>
            <small>{new Date(openJudgeCall.calledAt).toLocaleTimeString("ja-JP")} 呼出</small>
            <button disabled={disabled} type="button" onClick={() => onJudgeResolve(match.id)}>
              対応終了
            </button>
          </>
        ) : (
          <>
            <button disabled={disabled} type="button" onClick={() => onJudgeCall(match.id)}>
              ジャッジ呼出を記録
            </button>
            {lastResolvedSeconds !== null ? (
              <small>
                前回対応 {formatElapsed(lastResolvedSeconds)}
                {lastResolvedSeconds >= 60 ? "（延長時間に反映済み。必要なら「延長」で記録）" : ""}
              </small>
            ) : null}
          </>
        )}
      </div>

      <div className="judgeTools">
        <div className="timeExtend">
          <input
            aria-label="延長時間（分）"
            disabled={disabled}
            min={1}
            type="number"
            value={extensionMinutes}
            onChange={(event) => setExtensionMinutes(Number(event.target.value))}
          />
          <button disabled={disabled} type="button" onClick={() => onExtendTime(match.id, extensionMinutes)}>
            +{extensionMinutes}分延長
          </button>
        </div>
        <select
          aria-label="ジャッジ対象プレイヤー"
          disabled={disabled}
          value={judgePlayerId}
          onChange={(event) => setJudgePlayerId(event.target.value)}
        >
          <option value={match.playerAId}>{players.find((player) => player.id === match.playerAId)?.name}</option>
          <option value={match.playerBId!}>{players.find((player) => player.id === match.playerBId)?.name}</option>
        </select>
        <select
          aria-label="ペナルティ種別"
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
          aria-label="裁定メモ"
          className="judgeNoteInput"
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
  selfId,
  showPenaltyLog = false,
  onToggleDrop,
}: {
  isFinal: boolean;
  standings: Standing[];
  rounds: Round[];
  players: Player[];
  selfId?: string;
  showPenaltyLog?: boolean;
  onToggleDrop?: (playerId: string) => void;
}) {
  const visibleStandings = standings.filter((standing) => !standing.disqualified);
  const disqualifiedStandings = standings.filter((standing) => standing.disqualified);
  const penalties = rounds.flatMap((round) =>
    round.matches.flatMap((match) =>
      match.judgeActions.map((action) => ({ round: round.number, table: match.table, action })),
    ),
  );
  const selfRank = selfId
    ? visibleStandings.findIndex((standing) => standing.id === selfId) + 1
    : 0;
  return (
    <section className="panel standingsPanel">
      <div className="panelHeader">
        <div>
          <p className="eyebrow">{isFinal ? "最終順位" : "暫定順位"}</p>
          <h2>{isFinal ? "最終順位" : "順位"}</h2>
        </div>
      </div>
      {isFinal ? (
        <p className="standingsHint">
          {selfId
            ? "おつかれさまでした。確定した最終順位です。"
            : "大会終了済み。この順位を確認してから外部連携用データを保存してください。"}
        </p>
      ) : (
        <p className="standingsHint">
          {selfId
            ? "各ラウンド終了時に更新される順位です。MP=マッチポイント（1勝3点）。OMW%=対戦相手のマッチ勝率（同点時の順位決定に使用）。"
            : "進行中の暫定順位です。順位は公式順（MP → OMW% → 勝利対戦相手のMP合計 → 相手のOMW%平均）で決定。行にカーソルを合わせると詳細値を表示します。"}
        </p>
      )}
      {selfId && selfRank > 0 ? (
        <p className="myRankLine">あなた: {selfRank}位</p>
      ) : null}
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
          <div
            className={[
              "standingRow",
              standing.dropped ? "dropped" : "",
              selfId === standing.id ? "selfRow" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            key={standing.id}
            title={`MWP ${formatPercentage(standing.matchWinPercentage)} / OMW ${formatPercentage(standing.opponentsMatchWinPercentage)} / 勝利相手MP合計 ${standing.defeatedOpponentsMatchPoints} / 相手OMW平均 ${formatPercentage(standing.opponentsOpponentsMatchWinPercentage)}`}
          >
            <span>{index + 1}</span>
            <strong>
              {standing.name}
              {standing.dropped ? <b className="rowBadge">棄権</b> : null}
              {onToggleDrop ? (
                <button
                  className="dropToggle"
                  type="button"
                  onClick={() => onToggleDrop(standing.id)}
                >
                  {players.find((player) => player.id === standing.id)?.dropped
                    ? "棄権取消"
                    : "ドロップ"}
                </button>
              ) : null}
            </strong>
            <span>{standing.matchPoints}MP</span>
            <span>{standing.wins}W</span>
            <span>{standing.losses}L</span>
            <span>{formatPercentage(standing.opponentsMatchWinPercentage)}</span>
          </div>
        ))}
        {disqualifiedStandings.map((standing) => (
          <div className="standingRow dqRow" key={standing.id}>
            <span>-</span>
            <strong>
              {standing.name}
              <b className="rowBadge dq">失格</b>
            </strong>
            <span>{standing.matchPoints}MP</span>
            <span>{standing.wins}W</span>
            <span>{standing.losses}L</span>
            <span>-</span>
          </div>
        ))}
      </div>

      {showPenaltyLog ? (
        <details className="penaltyLog">
          <summary>ペナルティ履歴（{penalties.length}件）</summary>
          {penalties.length === 0 ? (
            <p className="fieldNote">記録されたペナルティはありません。</p>
          ) : (
            penalties.map(({ round, table, action }) => (
              <div className="historyRow penaltyRow" key={action.id}>
                <span>R{round}-T{table}</span>
                <strong>{playerName(players, action.playerId)}</strong>
                <span>{judgeActionLabels[action.type]}</span>
                <small>
                  {action.createdAt ? new Date(action.createdAt).toLocaleTimeString("ja-JP") : ""}
                  {action.note ? ` / ${action.note}` : ""}
                </small>
              </div>
            ))
          )}
          <p className="fieldNote">全件は「全結果JSON」の penalties にも出力されます。</p>
        </details>
      ) : null}

      <div className="history">
        {rounds.map((round) => (
          <details key={round.number}>
            <summary>ラウンド {round.number}</summary>
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
                      ? "不戦勝(BYE)"
                      : match.status === "forced"
                        ? "裁定"
                        : matchStatusLabels[match.status]}
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
