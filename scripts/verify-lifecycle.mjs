import {
  buildStandings,
  createRound,
  defaultSettings,
  normalizeMatch,
  parsePlayers,
  recommendedSwissRounds,
} from "../lib/domain/tournament.ts";
import {
  buildMatchesCsv,
  buildResultsPayload,
  buildStandingsCsv,
} from "../lib/domain/export.ts";

const participantCounts = [8, 16, 32, 64, 128, 256];

function makeNames(count) {
  return Array.from({ length: count }, (_, index) => `Player ${String(index + 1).padStart(3, "0")}`).join("\n");
}

function makeTournament(count) {
  const settings = {
    ...defaultSettings,
    name: `Lifecycle ${count}`,
    participantCount: count,
    swissRounds: recommendedSwissRounds(count),
    eventCode: `LC-${count}`,
  };
  return {
    settings,
    state: "ready",
    players: parsePlayers(makeNames(count), count),
    rounds: [],
    events: [],
  };
}

function activateRound(round, settings) {
  return {
    ...round,
    status: "active",
    matches: round.matches.map((match) =>
      match.status === "waiting"
        ? { ...normalizeMatch(match, settings), status: "active" }
        : normalizeMatch(match, settings),
    ),
  };
}

function participantReport(match, selectedPlayerId, ownScore, opponentScore) {
  const isA = match.playerAId === selectedPlayerId;
  return {
    scoreA: isA ? ownScore : opponentScore,
    scoreB: isA ? opponentScore : ownScore,
  };
}

function reportMatch(match, scoreA, scoreB) {
  if (!match.playerBId) return { ...match, status: "reported" };
  if (scoreA === scoreB) throw new Error(`draw score was accepted for ${match.id}`);
  return {
    ...match,
    scoreA,
    scoreB,
    winnerId: scoreA > scoreB ? match.playerAId : match.playerBId,
    resultType: "win",
    resultNote: "",
    status: "reported",
  };
}

function completeCurrentRound(tournament, roundSeed) {
  const currentRound = tournament.rounds.at(-1);
  if (!currentRound) throw new Error("no active round");

  const matches = currentRound.matches.map((match, index) => {
    if (!match.playerBId) return { ...match, status: "reported" };
    const selectedPlayerId = index % 2 === 0 ? match.playerAId : match.playerBId;
    const selectedPlayerWins = (roundSeed + index) % 3 !== 0;
    const { scoreA, scoreB } = participantReport(
      match,
      selectedPlayerId,
      selectedPlayerWins ? 1 : 0,
      selectedPlayerWins ? 0 : 1,
    );
    return reportMatch(match, scoreA, scoreB);
  });

  return {
    ...tournament,
    rounds: tournament.rounds.map((round, index) =>
      index === tournament.rounds.length - 1
        ? { ...round, status: "complete", matches }
        : round,
    ),
  };
}

function startOrAdvance(tournament) {
  const completedRounds = tournament.rounds.filter((round) => round.status === "complete");
  if (completedRounds.length >= tournament.settings.swissRounds) {
    return { ...tournament, state: "complete", rounds: completedRounds };
  }
  const nextRound = activateRound(
    createRound(tournament.players, completedRounds, tournament.settings),
    tournament.settings,
  );
  return {
    ...tournament,
    state: "running",
    rounds: [...completedRounds, nextRound],
  };
}

function assertRoundIntegrity(tournament, round) {
  const seen = new Set();
  for (const match of round.matches) {
    if (match.status !== "reported" && match.status !== "forced") {
      throw new Error(`${tournament.settings.name}: ${match.id} is not reported`);
    }
    for (const playerId of [match.playerAId, match.playerBId].filter(Boolean)) {
      if (seen.has(playerId)) throw new Error(`${tournament.settings.name}: duplicate ${playerId} in round ${round.number}`);
      seen.add(playerId);
    }
    if (match.playerBId && !match.winnerId && match.resultType !== "double-loss") {
      throw new Error(`${tournament.settings.name}: ${match.id} has no winner`);
    }
  }
}

function verifyPresetCount(count) {
  let tournament = makeTournament(count);
  const expectedRounds = tournament.settings.swissRounds;

  while (tournament.state !== "complete") {
    tournament = startOrAdvance(tournament);
    if (tournament.state === "complete") break;
    const activeRound = tournament.rounds.at(-1);
    if (activeRound.status !== "active") {
      throw new Error(`${count}: next round was not active`);
    }
    tournament = completeCurrentRound(tournament, activeRound.number);
  }

  if (tournament.rounds.length !== expectedRounds) {
    throw new Error(`${count}: expected ${expectedRounds} rounds, got ${tournament.rounds.length}`);
  }
  tournament.rounds.forEach((round) => assertRoundIntegrity(tournament, round));
  const standings = buildStandings(tournament.players, tournament.rounds, tournament.settings);
  if (standings.length !== count) throw new Error(`${count}: standings length mismatch`);
  const totalMatchPoints = standings.reduce((total, standing) => total + standing.matchPoints, 0);
  const expectedMatchPoints = tournament.rounds.reduce(
    (total, round) => total + round.matches.filter((match) => match.resultType !== "double-loss").length * 3,
    0,
  );
  if (totalMatchPoints !== expectedMatchPoints) {
    throw new Error(`${count}: match point mismatch ${totalMatchPoints}/${expectedMatchPoints}`);
  }
  const exportPayload = buildResultsPayload(tournament, standings);
  if (exportPayload.standings.length !== count) {
    throw new Error(`${count}: export standings length mismatch`);
  }
  if (exportPayload.rounds.length !== expectedRounds) {
    throw new Error(`${count}: export rounds length mismatch`);
  }
  const standingsCsvLines = buildStandingsCsv(standings).split("\n");
  if (standingsCsvLines.length !== count + 1) {
    throw new Error(`${count}: standings CSV line mismatch`);
  }
  const matchesCsvLines = buildMatchesCsv(tournament).split("\n");
  if (matchesCsvLines.length <= 1) {
    throw new Error(`${count}: matches CSV is empty`);
  }
  return {
    participantCount: count,
    roundCount: tournament.rounds.length,
    matchCount: tournament.rounds.reduce((total, round) => total + round.matches.length, 0),
    top: `${standings[0].id} ${standings[0].matchPoints}MP`,
  };
}

function verifyOddByeScenario() {
  let tournament = makeTournament(9);
  tournament = startOrAdvance(tournament);
  tournament = completeCurrentRound(tournament, 1);
  const byeCount = tournament.rounds[0].matches.filter((match) => !match.playerBId).length;
  if (byeCount !== 1) throw new Error(`9-player scenario expected one BYE, got ${byeCount}`);
  return { participantCount: 9, byeCount };
}

function verifyJudgedResultScenario() {
  let tournament = makeTournament(8);
  tournament = startOrAdvance(tournament);
  const round = tournament.rounds.at(-1);
  const [firstMatch, secondMatch] = round.matches.filter((match) => match.playerBId);
  const judgedRound = {
    ...round,
    matches: round.matches.map((match) => {
      if (match.id === firstMatch.id) {
        return {
          ...match,
          firstPlayerId: match.playerAId,
          scoreA: 0,
          scoreB: 0,
          winnerId: null,
          resultType: "double-loss",
          resultNote: "judge call",
          status: "forced",
        };
      }
      if (match.id === secondMatch.id) {
        return {
          ...match,
          firstPlayerId: match.playerBId,
          scoreA: 0,
          scoreB: 1,
          winnerId: match.playerBId,
          resultType: "win",
          resultNote: "",
          status: "forced",
          judgeActions: [
            {
              id: "judge-1",
              playerId: match.playerAId,
              type: "match-loss",
              note: "penalty",
              createdAt: new Date(0).toISOString(),
            },
          ],
        };
      }
      if (!match.playerBId) return { ...match, status: "reported" };
      return reportMatch(match, 1, 0);
    }),
  };
  tournament = {
    ...tournament,
    rounds: [{ ...judgedRound, status: "complete" }],
  };
  const standings = buildStandings(tournament.players, tournament.rounds, tournament.settings);
  const firstA = standings.find((standing) => standing.id === firstMatch.playerAId);
  const firstB = standings.find((standing) => standing.id === firstMatch.playerBId);
  if (firstA?.losses !== 1 || firstB?.losses !== 1) {
    throw new Error("double-loss did not count as losses for both players");
  }
  if (tournament.rounds[0].matches.find((match) => match.id === firstMatch.id)?.firstPlayerId !== firstMatch.playerAId) {
    throw new Error("first player selection was not preserved");
  }
  return { doubleLossMatch: firstMatch.id, forcedMatch: secondMatch.id };
}

const results = participantCounts.map(verifyPresetCount);
const oddScenario = verifyOddByeScenario();
const judgedScenario = verifyJudgedResultScenario();

for (const result of results) {
  console.log(
    `${result.participantCount} players: ${result.roundCount} rounds, ${result.matchCount} matches, top ${result.top}`,
  );
}
console.log(`odd scenario: ${oddScenario.participantCount} players, ${oddScenario.byeCount} BYE`);
console.log(`judged scenario: ${judgedScenario.doubleLossMatch} double-loss, ${judgedScenario.forcedMatch} forced`);
