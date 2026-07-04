export type InputMode = "paste" | "qr" | "lookup";
export type EliminationMode = "none" | "single" | "double" | "triple" | "quad" | "penta";
export type TournamentState = "setup" | "ready" | "running" | "complete";
export type RoundStatus = "draft" | "active" | "complete";
export type MatchStatus = "waiting" | "active" | "reported" | "forced";
export type JudgeActionType = "caution" | "warning" | "game-loss" | "match-loss" | "disqualification";
export type MatchResultType = "unreported" | "win" | "double-loss" | "bye";

export type Settings = {
  name: string;
  participantCount: number;
  inputMode: InputMode;
  timeLimitMinutes: number;
  bestOf: number;
  swissRounds: number;
  eliminationMode: EliminationMode;
  hasEntryFee: boolean;
  entryFee: number;
  eventCode: string;
};

export type Player = {
  id: string;
  name: string;
  checkedIn: boolean;
  byeCount: number;
  disqualified?: boolean;
  deckName?: string;
  deckImageName?: string;
  deckRegisteredAt?: string;
};

export type JudgeAction = {
  id: string;
  playerId: string;
  type: JudgeActionType;
  note: string;
  createdAt: string;
};

export type Match = {
  id: string;
  round: number;
  table: number;
  playerAId: string;
  playerBId: string | null;
  scoreA: number | null;
  scoreB: number | null;
  winnerId: string | null;
  firstPlayerId?: string | null;
  resultType?: MatchResultType;
  resultNote?: string;
  status: MatchStatus;
  pairingRecordA: string;
  pairingRecordB: string;
  timeLimitSeconds: number | null;
  timeRemainingSeconds: number | null;
  timeExtensionSeconds: number;
  judgeActions: JudgeAction[];
};

export type Round = {
  number: number;
  status: RoundStatus;
  matches: Match[];
};

export type TimelineEvent = {
  id: string;
  text: string;
};

export type Tournament = {
  settings: Settings;
  state: TournamentState;
  players: Player[];
  rounds: Round[];
  events: TimelineEvent[];
};

export type Standing = Player & {
  wins: number;
  losses: number;
  draws: number;
  gameWins: number;
  gameLosses: number;
  matchPoints: number;
  playedRounds: number;
  matchWinPercentage: number;
  opponentsMatchWinPercentage: number;
  opponents: string[];
  dropped: boolean;
};

export const sampleNames = [
  "Aki Naruse",
  "Ren Kisaragi",
  "Mio Senda",
  "Kai Fujimoto",
  "Sora Tachibana",
  "Yuna Arai",
  "Riku Hayami",
  "Noa Kanzaki",
];

export const participantCountOptions = [8, 16, 32, 64, 128, 256];
export const timeLimitOptions = [20, 25, 30, 40, 50];
export const bestOfOptions = [1, 3, 5, 7, 9];

export function generateEventCode() {
  return "SW-" + Math.random().toString(36).slice(2, 7).toUpperCase();
}

export function normalizeBestOf(value: number) {
  return bestOfOptions.includes(value) ? value : 1;
}

export function recommendedSwissRounds(participantCount: number) {
  if (participantCount <= 8) return 3;
  if (participantCount <= 16) return 4;
  if (participantCount <= 32) return 5;
  if (participantCount <= 64) return 6;
  if (participantCount <= 128) return 7;
  if (participantCount <= 226) return 8;
  if (participantCount <= 409) return 9;
  return 10;
}

export function countEntryNames(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.split(/\t|,/)[0]?.trim())
    .filter(Boolean).length;
}

export function participantCapForEntryCount(count: number) {
  return participantCountOptions.find((option) => count <= option) ?? Math.max(2, count);
}

export function formatPercentage(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

export function standingRecord(standing: Pick<Standing, "wins" | "losses" | "draws"> | undefined) {
  if (!standing) return "0-0-0";
  return `${standing.wins}-${standing.losses}-${standing.draws}`;
}

export function normalizeMatch(
  match: Match,
  settings: Settings,
  recordA = match.pairingRecordA ?? "0-0-0",
  recordB = match.pairingRecordB ?? (match.playerBId ? "0-0-0" : "BYE"),
): Match {
  const baseSeconds = settings.timeLimitMinutes > 0 ? settings.timeLimitMinutes * 60 : null;
  const inferredResultType: MatchResultType =
    match.resultType ??
    (!match.playerBId
      ? "bye"
      : match.status === "waiting" || match.status === "active"
        ? "unreported"
        : match.winnerId
          ? "win"
          : "double-loss");
  return {
    ...match,
    firstPlayerId: match.firstPlayerId ?? null,
    resultType: inferredResultType,
    resultNote: match.resultNote ?? "",
    pairingRecordA: match.pairingRecordA ?? recordA,
    pairingRecordB: match.pairingRecordB ?? recordB,
    timeLimitSeconds: match.timeLimitSeconds ?? baseSeconds,
    timeRemainingSeconds: match.timeRemainingSeconds ?? baseSeconds,
    timeExtensionSeconds: match.timeExtensionSeconds ?? 0,
    judgeActions: match.judgeActions ?? [],
  };
}

export function normalizeTournament(tournament: Tournament): Tournament {
  const normalizedPlayers = tournament.players.map((player) => ({
    ...player,
    checkedIn: player.checkedIn ?? true,
    deckName: player.deckName ?? "",
    deckImageName: player.deckImageName ?? "",
    deckRegisteredAt: player.deckRegisteredAt ?? "",
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
      swissRounds:
        tournament.settings.swissRounds ??
        recommendedSwissRounds(tournament.settings.participantCount),
    },
    players: normalizedPlayers,
    rounds: normalizedRounds,
  };
}

export const defaultSettings: Settings = {
  name: "Friday Night Swiss",
  participantCount: 8,
  inputMode: "paste",
  timeLimitMinutes: 20,
  bestOf: 1,
  swissRounds: 3,
  eliminationMode: "none",
  hasEntryFee: false,
  entryFee: 1000,
  eventCode: "",
};

export function parsePlayers(text: string, expectedCount: number): Player[] {
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

export function lossLimit(mode: EliminationMode) {
  if (mode === "single") return 1;
  if (mode === "double") return 2;
  if (mode === "triple") return 3;
  if (mode === "quad") return 4;
  if (mode === "penta") return 5;
  return Number.POSITIVE_INFINITY;
}

export function pairKey(a: string, b: string) {
  return [a, b].sort().join(":");
}

export function estimateRemainingRepeatPairs(candidates: Standing[], previousPairs: Set<string>) {
  const waiting = [...candidates];
  let repeats = 0;
  while (waiting.length > 1) {
    const playerA = waiting.shift();
    if (!playerA) break;
    let opponentIndex = waiting.findIndex(
      (candidate) => !previousPairs.has(pairKey(playerA.id, candidate.id)),
    );
    if (opponentIndex < 0) opponentIndex = 0;
    const [playerB] = waiting.splice(opponentIndex, 1);
    if (playerB && previousPairs.has(pairKey(playerA.id, playerB.id))) repeats += 1;
  }
  return repeats;
}

export function buildStandings(players: Player[], rounds: Round[], settings: Settings): Standing[] {
  const table = new Map<string, Standing>();
  players.forEach((player) => {
    table.set(player.id, {
      ...player,
      wins: 0,
      losses: 0,
      draws: 0,
      gameWins: 0,
      gameLosses: 0,
      matchPoints: 0,
      playedRounds: 0,
      matchWinPercentage: 0,
      opponentsMatchWinPercentage: 0,
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
        a.matchPoints += 3;
        a.playedRounds += 1;
        a.gameWins += 1;
        return;
      }

      a.opponents.push(b.id);
      b.opponents.push(a.id);
      a.playedRounds += 1;
      b.playedRounds += 1;
      a.gameWins += match.scoreA ?? 0;
      a.gameLosses += match.scoreB ?? 0;
      b.gameWins += match.scoreB ?? 0;
      b.gameLosses += match.scoreA ?? 0;

      if (match.winnerId === a.id) {
        a.wins += 1;
        a.matchPoints += 3;
        b.losses += 1;
      } else if (match.winnerId === b.id) {
        b.wins += 1;
        b.matchPoints += 3;
        a.losses += 1;
      } else {
        a.losses += 1;
        b.losses += 1;
      }
    });
  });

  const limit = lossLimit(settings.eliminationMode);
  const standings = Array.from(table.values()).map((standing) => {
    const rawMatchWinPercentage =
      standing.playedRounds > 0 ? standing.matchPoints / (standing.playedRounds * 3) : 0;
    return {
      ...standing,
      matchWinPercentage:
        standing.playedRounds > 0 ? Math.max(0.33, rawMatchWinPercentage) : 0,
    };
  });
  const byId = new Map(standings.map((standing) => [standing.id, standing]));

  return standings
    .map((standing) => ({
      ...standing,
      opponentsMatchWinPercentage:
        standing.opponents.length > 0
          ? standing.opponents.reduce(
              (total, opponentId) => total + (byId.get(opponentId)?.matchWinPercentage ?? 0),
              0,
            ) / standing.opponents.length
          : 0,
      dropped: standing.disqualified === true || standing.losses >= limit,
    }))
    .sort((a, b) => {
      const pointDiff = b.matchPoints - a.matchPoints;
      if (pointDiff) return pointDiff;
      const opponentDiff = b.opponentsMatchWinPercentage - a.opponentsMatchWinPercentage;
      if (opponentDiff) return opponentDiff;
      const lossDiff = a.losses - b.losses;
      if (lossDiff) return lossDiff;
      const gameDiff = b.gameWins - b.gameLosses - (a.gameWins - a.gameLosses);
      if (gameDiff) return gameDiff;
      return a.name.localeCompare(b.name);
    });
}

export function createRound(players: Player[], rounds: Round[], settings: Settings): Round {
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
      firstPlayerId: byePlayer.id,
      resultType: "bye",
      resultNote: "",
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
    const opponentIndex = waiting.reduce((bestIndex, candidate, candidateIndex) => {
      const best = waiting[bestIndex];
      const candidateRest = waiting.filter((_, index) => index !== candidateIndex);
      const bestRest = waiting.filter((_, index) => index !== bestIndex);
      const candidateScore =
        (previousPairs.has(pairKey(playerA.id, candidate.id)) ? 100 : 0) +
        (candidate.wins === playerA.wins ? 0 : 10) +
        estimateRemainingRepeatPairs(candidateRest, previousPairs);
      const bestScore =
        (previousPairs.has(pairKey(playerA.id, best.id)) ? 100 : 0) +
        (best.wins === playerA.wins ? 0 : 10) +
        estimateRemainingRepeatPairs(bestRest, previousPairs);
      return candidateScore < bestScore ? candidateIndex : bestIndex;
    }, 0);
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
      firstPlayerId: null,
      resultType: "unreported",
      resultNote: "",
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

export function playerName(players: Player[], id: string | null) {
  if (!id) return "BYE";
  return players.find((player) => player.id === id)?.name ?? id;
}

export function playerRecord(standings: Standing[], id: string | null) {
  if (!id) return "BYE";
  const standing = standings.find((player) => player.id === id);
  return standingRecord(standing);
}

export function isStairPairing(match: Match) {
  if (!match.playerBId) return false;
  return match.pairingRecordA !== match.pairingRecordB;
}

export function seriesTarget(bestOf: number) {
  return Math.floor(bestOf / 2) + 1;
}

export function isChampionDecided(standings: Standing[], rounds: Round[]) {
  if (rounds.length === 0) return false;
  const undefeated = standings.filter((player) => player.losses === 0 && !player.dropped);
  return undefeated.length <= 1;
}

export function makeEvent(text: string): TimelineEvent {
  return {
    id: Math.random().toString(36).slice(2),
    text,
  };
}
