import {
  formatPercentage,
  playerName,
  type Round,
  type Standing,
  type Tournament,
} from "./tournament.ts";

const exportVersion = 1;

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvLine(values: unknown[]) {
  return values.map(csvCell).join(",");
}

export function buildResultsPayload(tournament: Tournament, standings: Standing[]) {
  return {
    version: exportVersion,
    exportedAt: new Date().toISOString(),
    event: {
      code: tournament.settings.eventCode,
      name: tournament.settings.name,
      state: tournament.state,
      participantCount: tournament.players.length,
      swissRounds: tournament.settings.swissRounds,
      bestOf: tournament.settings.bestOf,
      timeLimitMinutes: tournament.settings.timeLimitMinutes,
      eliminationMode: tournament.settings.eliminationMode,
    },
    players: tournament.players.map((player) => ({
      id: player.id,
      name: player.name,
      checkedIn: player.checkedIn,
      deckName: player.deckName ?? "",
      deckImageName: player.deckImageName ?? "",
      deckRegisteredAt: player.deckRegisteredAt ?? "",
      byeCount: player.byeCount,
      disqualified: player.disqualified ?? false,
    })),
    standings: standings.map((standing, index) => ({
      rank: index + 1,
      id: standing.id,
      name: standing.name,
      matchPoints: standing.matchPoints,
      wins: standing.wins,
      losses: standing.losses,
      draws: standing.draws,
      gameWins: standing.gameWins,
      gameLosses: standing.gameLosses,
      matchWinPercentage: standing.matchWinPercentage,
      opponentsMatchWinPercentage: standing.opponentsMatchWinPercentage,
      defeatedOpponentsMatchPoints: standing.defeatedOpponentsMatchPoints,
      opponentsOpponentsMatchWinPercentage: standing.opponentsOpponentsMatchWinPercentage,
      dropped: standing.dropped,
      disqualified: standing.disqualified ?? false,
      checkedIn: standing.checkedIn,
      deckName: standing.deckName ?? "",
      deckImageName: standing.deckImageName ?? "",
    })),
    rounds: tournament.rounds.map((round) => exportRound(round, tournament)),
    events: tournament.events,
    // Raw tournament snapshot so the app can restore state from this file.
    tournament,
  };
}

function exportRound(round: Round, tournament: Tournament) {
  return {
    number: round.number,
    status: round.status,
    matches: round.matches.map((match) => ({
      id: match.id,
      table: match.table,
      status: match.status,
      resultType: match.resultType ?? "unreported",
      playerAId: match.playerAId,
      playerAName: playerName(tournament.players, match.playerAId),
      playerBId: match.playerBId,
      playerBName: playerName(tournament.players, match.playerBId),
      scoreA: match.scoreA,
      scoreB: match.scoreB,
      winnerId: match.winnerId,
      winnerName: playerName(tournament.players, match.winnerId),
      firstPlayerId: match.firstPlayerId ?? "",
      firstPlayerName: playerName(tournament.players, match.firstPlayerId ?? null),
      pairingRecordA: match.pairingRecordA,
      pairingRecordB: match.pairingRecordB,
      timeLimitSeconds: match.timeLimitSeconds,
      timeRemainingSeconds: match.timeRemainingSeconds,
      timeExtensionSeconds: match.timeExtensionSeconds,
      resultNote: match.resultNote ?? "",
      judgeActions: match.judgeActions,
    })),
  };
}

export function buildStandingsCsv(standings: Standing[]) {
  const rows: unknown[][] = [
    [
      "rank",
      "player_id",
      "player_name",
      "match_points",
      "wins",
      "losses",
      "draws",
      "game_wins",
      "game_losses",
      "mwp",
      "omw",
      "defeated_opponents_match_points",
      "opp_omw",
      "checked_in",
      "deck_name",
      "deck_image",
      "dropped",
      "disqualified",
    ],
    ...standings.map((standing, index) => [
      index + 1,
      standing.id,
      standing.name,
      standing.matchPoints,
      standing.wins,
      standing.losses,
      standing.draws,
      standing.gameWins,
      standing.gameLosses,
      formatPercentage(standing.matchWinPercentage),
      formatPercentage(standing.opponentsMatchWinPercentage),
      standing.defeatedOpponentsMatchPoints,
      formatPercentage(standing.opponentsOpponentsMatchWinPercentage),
      standing.checkedIn ? "yes" : "no",
      standing.deckName ?? "",
      standing.deckImageName ?? "",
      standing.dropped ? "yes" : "no",
      standing.disqualified ? "yes" : "no",
    ]),
  ];
  return rows.map(csvLine).join("\n");
}

export function buildMatchesCsv(tournament: Tournament) {
  const rows: unknown[][] = [
    [
      "round",
      "table",
      "status",
      "result_type",
      "player_a_id",
      "player_a_name",
      "player_b_id",
      "player_b_name",
      "score_a",
      "score_b",
      "winner_id",
      "winner_name",
      "first_player_id",
      "first_player_name",
      "pairing_record_a",
      "pairing_record_b",
      "judge_actions",
    ],
  ];

  tournament.rounds.forEach((round) => {
    round.matches.forEach((match) => {
      rows.push([
        round.number,
        match.table,
        match.status,
        match.resultType ?? "unreported",
        match.playerAId,
        playerName(tournament.players, match.playerAId),
        match.playerBId ?? "",
        playerName(tournament.players, match.playerBId),
        match.scoreA ?? "",
        match.scoreB ?? "",
        match.winnerId ?? "",
        playerName(tournament.players, match.winnerId),
        match.firstPlayerId ?? "",
        playerName(tournament.players, match.firstPlayerId ?? null),
        match.pairingRecordA,
        match.pairingRecordB,
        match.judgeActions
          .map((action) => `${action.playerId}:${action.type}${action.note ? `:${action.note}` : ""}`)
          .join(" | "),
      ]);
    });
  });

  return rows.map(csvLine).join("\n");
}
