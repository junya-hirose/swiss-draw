import {
  buildStandings,
  createRound,
  defaultSettings,
  recommendedSwissRounds,
} from "../lib/domain/tournament.ts";

const participantCounts = [8, 16, 32, 64, 128, 256];

function makePlayers(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `P${String(index + 1).padStart(3, "0")}`,
    name: `Player ${String(index + 1).padStart(3, "0")}`,
    checkedIn: true,
    byeCount: 0,
    disqualified: false,
  }));
}

function stableHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function reportRound(round, seed) {
  return {
    ...round,
    status: "complete",
    matches: round.matches.map((match) => {
      if (!match.playerBId) return { ...match, status: "reported" };
      const aScore = stableHash(`${seed}:${match.id}:${match.playerAId}`) % 1000;
      const bScore = stableHash(`${seed}:${match.id}:${match.playerBId}`) % 1000;
      const playerAWins = aScore >= bScore;
      return {
        ...match,
        scoreA: playerAWins ? 1 : 0,
        scoreB: playerAWins ? 0 : 1,
        winnerId: playerAWins ? match.playerAId : match.playerBId,
        resultType: "win",
        resultNote: "",
        status: "reported",
      };
    }),
  };
}

function validateRound(round, participantCount) {
  const seenPlayers = new Set();
  const tableNumbers = new Set();
  const errors = [];

  round.matches.forEach((match) => {
    if (tableNumbers.has(match.table)) {
      errors.push(`duplicate table ${match.table} in round ${round.number}`);
    }
    tableNumbers.add(match.table);

    [match.playerAId, match.playerBId].filter(Boolean).forEach((playerId) => {
      if (seenPlayers.has(playerId)) {
        errors.push(`duplicate player ${playerId} in round ${round.number}`);
      }
      seenPlayers.add(playerId);
    });

    if (match.status !== "reported" && match.status !== "forced") {
      errors.push(`unreported match ${match.id}`);
    }
  });

  if (participantCount % 2 === 0 && seenPlayers.size !== participantCount) {
    errors.push(`round ${round.number} saw ${seenPlayers.size}/${participantCount} players`);
  }

  return errors;
}

function validateNoDuplicatePairings(rounds) {
  const seenPairs = new Set();
  const repeats = [];
  rounds.forEach((round) => {
    round.matches.forEach((match) => {
      if (!match.playerBId) return;
      const key = [match.playerAId, match.playerBId].sort().join(":");
      if (seenPairs.has(key)) repeats.push(`${key} in round ${round.number}`);
      seenPairs.add(key);
    });
  });
  return repeats;
}

function simulate(count) {
  const settings = {
    ...defaultSettings,
    name: `Simulation ${count}`,
    participantCount: count,
    swissRounds: recommendedSwissRounds(count),
    eventCode: `SIM-${count}`,
  };
  const players = makePlayers(count);
  const rounds = [];
  const errors = [];

  for (let roundIndex = 0; roundIndex < settings.swissRounds; roundIndex += 1) {
    const draftRound = createRound(players, rounds, settings);
    const activeRound = {
      ...draftRound,
      status: "active",
      matches: draftRound.matches.map((match) =>
        match.status === "waiting" ? { ...match, status: "active" } : match,
      ),
    };
    const completedRound = reportRound(activeRound, `${count}:${roundIndex + 1}`);
    errors.push(...validateRound(completedRound, count));
    rounds.push(completedRound);
  }

  const standings = buildStandings(players, rounds, settings);
  const duplicatePairings = validateNoDuplicatePairings(rounds);
  const top = standings[0];

  return {
    participantCount: count,
    roundCount: settings.swissRounds,
    matchCount: rounds.reduce((total, round) => total + round.matches.length, 0),
    errors,
    duplicatePairingCount: duplicatePairings.length,
    duplicatePairingSamples: duplicatePairings.slice(0, 5),
    topStanding: top
      ? {
          id: top.id,
          name: top.name,
          matchPoints: top.matchPoints,
          wins: top.wins,
          losses: top.losses,
          opponentsMatchWinPercentage: Number(top.opponentsMatchWinPercentage.toFixed(4)),
        }
      : null,
  };
}

const results = participantCounts.map(simulate);
let failed = false;

results.forEach((result) => {
  console.log(
    `${result.participantCount} players: ${result.roundCount} rounds, ${result.matchCount} matches, ` +
      `${result.errors.length} errors, ${result.duplicatePairingCount} repeat pairings`,
  );
  if (result.topStanding) {
    console.log(
      `  top: ${result.topStanding.id} ${result.topStanding.matchPoints}MP ` +
        `${result.topStanding.wins}-${result.topStanding.losses}, OMW ${result.topStanding.opponentsMatchWinPercentage}`,
    );
  }
  if (result.duplicatePairingSamples.length > 0) {
    console.log(`  repeats: ${result.duplicatePairingSamples.join(", ")}`);
  }
  result.errors.forEach((error) => console.log(`  error: ${error}`));
  failed ||= result.errors.length > 0;
});

if (failed) {
  process.exitCode = 1;
}
