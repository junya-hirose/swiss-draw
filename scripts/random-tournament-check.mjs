import {
  buildStandings,
  createRound,
  defaultSettings,
  recommendedSwissRounds,
} from "../lib/domain/tournament.ts";
import {
  buildMatchesCsv,
  buildResultsPayload,
  buildStandingsCsv,
} from "../lib/domain/export.ts";

const tournamentCount = 20;
const maxPlayers = 200;

function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = Math.imul(state, 1664525) + 1013904223;
    return (state >>> 0) / 2 ** 32;
  };
}

function stableHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function makePlayers(count, seed) {
  return Array.from({ length: count }, (_, index) => ({
    id: `P${String(index + 1).padStart(3, "0")}`,
    name: `Random ${String(index + 1).padStart(3, "0")}`,
    checkedIn: stableHash(`${seed}:check:${index}`) % 17 !== 0,
    byeCount: 0,
    disqualified: false,
    deckName: stableHash(`${seed}:deck:${index}`) % 5 === 0 ? "" : `Deck ${((index % 12) + 1).toString().padStart(2, "0")}`,
    deckImageName: stableHash(`${seed}:img:${index}`) % 7 === 0 ? "" : `deck-${index + 1}.jpg`,
    deckRegisteredAt: new Date(1_700_000_000_000 + index * 60_000).toISOString(),
  }));
}

function activateRound(round) {
  return {
    ...round,
    status: "active",
    matches: round.matches.map((match) =>
      match.status === "waiting" ? { ...match, status: "active" } : match,
    ),
  };
}

function reportRound(round, seed) {
  return {
    ...round,
    status: "complete",
    matches: round.matches.map((match) => {
      if (!match.playerBId) return { ...match, status: "reported" };
      const rollA = stableHash(`${seed}:${match.id}:${match.playerAId}`);
      const rollB = stableHash(`${seed}:${match.id}:${match.playerBId}`);
      if ((rollA + rollB) % 47 === 0) {
        return {
          ...match,
          scoreA: 0,
          scoreB: 0,
          winnerId: null,
          resultType: "double-loss",
          resultNote: "random judge double loss",
          status: "forced",
        };
      }
      const playerAWins = rollA >= rollB;
      return {
        ...match,
        firstPlayerId: rollA % 2 === 0 ? match.playerAId : match.playerBId,
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

function nextPowerCut(count) {
  if (count < 2) return 0;
  if (count <= 8) return 2;
  if (count <= 32) return 4;
  if (count <= 96) return 8;
  return 16;
}

function simulateTopCut(standings, seed) {
  const cutSize = Math.min(nextPowerCut(standings.length), standings.length);
  if (cutSize < 2) return null;
  let competitors = standings.slice(0, cutSize).map((standing, index) => ({
    seed: index + 1,
    id: standing.id,
    name: standing.name,
  }));
  const rounds = [];

  while (competitors.length > 1) {
    const matches = [];
    const winners = [];
    for (let index = 0; index < competitors.length / 2; index += 1) {
      const playerA = competitors[index];
      const playerB = competitors[competitors.length - 1 - index];
      const playerAWins = stableHash(`${seed}:top:${competitors.length}:${playerA.id}:${playerB.id}`) % 100 >= 35;
      const winner = playerAWins ? playerA : playerB;
      matches.push({
        playerA,
        playerB,
        scoreA: playerAWins ? 2 : 1,
        scoreB: playerAWins ? 1 : 2,
        winner,
      });
      winners.push(winner);
    }
    rounds.push({ size: competitors.length, matches });
    competitors = winners.sort((a, b) => a.seed - b.seed);
  }

  return {
    cutSize,
    champion: competitors[0],
    rounds,
  };
}

function validateTournament(tournament, standings) {
  const errors = [];
  tournament.rounds.forEach((round) => {
    const seen = new Set();
    round.matches.forEach((match) => {
      if (match.status !== "reported" && match.status !== "forced") {
        errors.push(`${round.number}:${match.id}: unreported`);
      }
      [match.playerAId, match.playerBId].filter(Boolean).forEach((playerId) => {
        if (seen.has(playerId)) errors.push(`${round.number}: duplicate player ${playerId}`);
        seen.add(playerId);
      });
      if (match.playerBId && match.scoreA === match.scoreB && match.resultType !== "double-loss") {
        errors.push(`${round.number}:${match.id}: tied non-double-loss`);
      }
    });
  });

  const payload = buildResultsPayload(tournament, standings);
  if (payload.standings.length !== standings.length) errors.push("json standings length mismatch");
  if (payload.rounds.length !== tournament.rounds.length) errors.push("json round length mismatch");
  if (buildStandingsCsv(standings).split("\n").length !== standings.length + 1) {
    errors.push("standings csv length mismatch");
  }
  if (buildMatchesCsv(tournament).split("\n").length <= 1 && tournament.rounds.length > 0) {
    errors.push("matches csv empty");
  }

  return errors;
}

function simulateTournament(index, rng) {
  const requestedPlayers = Math.floor(rng() * maxPlayers) + 1;
  const mode = rng() < 0.55 ? "予選のみ" : "本戦あり";
  const players = makePlayers(requestedPlayers, `random-${index}`);
  const settings = {
    ...defaultSettings,
    name: `Random Check ${String(index).padStart(2, "0")}`,
    participantCount: requestedPlayers,
    swissRounds: recommendedSwissRounds(requestedPlayers),
    eventCode: `RND-${String(index).padStart(2, "0")}-${requestedPlayers}`,
    bestOf: rng() < 0.25 ? 3 : 1,
  };
  const tournament = {
    settings,
    state: "running",
    players,
    rounds: [],
    events: [],
  };

  for (let roundIndex = 0; roundIndex < settings.swissRounds; roundIndex += 1) {
    const draft = createRound(tournament.players, tournament.rounds, settings);
    tournament.rounds.push(reportRound(activateRound(draft), `${index}:${roundIndex}`));
  }
  tournament.state = "complete";
  const standings = buildStandings(tournament.players, tournament.rounds, settings);
  const topCut = mode === "本戦あり" ? simulateTopCut(standings, `random-${index}`) : null;
  const errors = validateTournament(tournament, standings);
  const top = standings[0];
  return {
    index,
    requestedPlayers,
    mode,
    swissRounds: settings.swissRounds,
    matchCount: tournament.rounds.reduce((total, round) => total + round.matches.length, 0),
    deckRegistered: players.filter((player) => player.deckName || player.deckImageName).length,
    checkedIn: players.filter((player) => player.checkedIn).length,
    errors,
    topStanding: top ? `${top.id} ${top.name} ${top.matchPoints}MP ${top.wins}-${top.losses}-${top.draws}` : "none",
    champion: topCut?.champion ? `${topCut.champion.id} ${topCut.champion.name}` : "-",
    topCutSize: topCut?.cutSize ?? 0,
  };
}

const rng = makeRng(0x5eed2026);
const results = Array.from({ length: tournamentCount }, (_, index) => simulateTournament(index + 1, rng));
let failed = false;

console.log("Random tournament check: 20 tournaments, players 1-200");
for (const result of results) {
  const status = result.errors.length === 0 ? "OK" : "NG";
  console.log(
    [
      `#${String(result.index).padStart(2, "0")}`,
      status,
      `${result.requestedPlayers} players`,
      result.mode,
      `${result.swissRounds}R`,
      `${result.matchCount} matches`,
      `check-in ${result.checkedIn}/${result.requestedPlayers}`,
      `deck ${result.deckRegistered}/${result.requestedPlayers}`,
      `top ${result.topStanding}`,
      result.topCutSize > 0 ? `top${result.topCutSize} champion ${result.champion}` : "no top cut",
    ].join(" | "),
  );
  result.errors.forEach((error) => console.log(`  error: ${error}`));
  failed ||= result.errors.length > 0;
}

if (failed) process.exitCode = 1;
