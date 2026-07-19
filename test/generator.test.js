/* Plain Node test runner — no dependencies. Run: node test/generator.test.js */
var G = require('../js/generator.js');

var passed = 0;
var failed = 0;
function ok(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error('  ✗ ' + msg);
  }
}
function section(name) {
  console.log('\n' + name);
}

function makePlayers(specs) {
  // specs: array of [name, skill]
  return specs.map(function (s, i) {
    return { id: 'p' + i, name: s[0], skill: s[1], present: true };
  });
}

function playFullSession(session, numGames, seedBase) {
  for (var i = 0; i < numGames; i++) {
    var g = G.generateGame(session, { seed: seedBase + i });
    if (g.error) throw new Error(g.error);
    session.games.push(g);
  }
  return session;
}

// ---------------------------------------------------------------------------
section('Partnership variety: no repeats while novel options remain (8 players, 2 courts)');
(function () {
  var session = {
    players: makePlayers([
      ['A', 2], ['B', 2], ['C', 2], ['D', 2],
      ['E', 2], ['F', 2], ['G', 2], ['H', 2],
    ]),
    config: { courts: 2, mode: 'spread' },
    games: [],
  };
  playFullSession(session, 7, 100);

  // Count partnerships. With 8 players over 7 games x 2 partnerships/team x 2 teams
  // = 28 partnerships, and 28 distinct pairs exist, so ideally zero repeats.
  var stats = G.deriveStats(session.games);
  var repeats = 0;
  Object.keys(stats.partner).forEach(function (k) {
    if (stats.partner[k].count > 1) repeats++;
  });
  ok(repeats <= 3, 'partnership repeats kept low over 7 games (got ' + repeats + ')');
})();

// ---------------------------------------------------------------------------
section('Sit-out fairness (10 players, 2 courts -> 2 sit out each game)');
(function () {
  var session = {
    players: makePlayers([
      ['A', 2], ['B', 2], ['C', 2], ['D', 2], ['E', 2],
      ['F', 2], ['G', 2], ['H', 2], ['I', 2], ['J', 2],
    ]),
    config: { courts: 2, mode: 'spread' },
    games: [],
  };
  playFullSession(session, 10, 200);
  var stats = G.deriveStats(session.games);
  var counts = session.players.map(function (p) {
    return stats.sitOuts[p.id] || 0;
  });
  var spread = Math.max.apply(null, counts) - Math.min.apply(null, counts);
  // 10 players, 2 sit-outs/game, 10 games = 20 sit-outs / 10 players = 2 each, ideally spread 0.
  ok(spread <= 1, 'sit-out counts within 1 of each other (spread ' + spread + ', counts ' + counts.join(',') + ')');
})();

// ---------------------------------------------------------------------------
section('Spread mode: 4 strong + 8 weak are distributed, never stacked');
(function () {
  var session = {
    players: makePlayers([
      ['S1', 3], ['S2', 3], ['S3', 3], ['S4', 3], // strong
      ['W1', 1], ['W2', 1], ['W3', 1], ['W4', 1],
      ['W5', 1], ['W6', 1], ['W7', 1], ['W8', 1], // weak
    ]),
    config: { courts: 3, mode: 'spread' }, // 12 players, 3 courts, no sit-outs
    games: [],
  };
  var byId = {};
  session.players.forEach(function (p) {
    byId[p.id] = p;
  });
  playFullSession(session, 8, 300);

  var stackedTeams = 0;
  session.games.forEach(function (g) {
    g.matches.forEach(function (m) {
      [m.teamA, m.teamB].forEach(function (team) {
        var strong = team.filter(function (id) {
          return byId[id].skill === 3;
        }).length;
        if (strong >= 2) stackedTeams++;
      });
    });
  });
  ok(stackedTeams === 0, 'no team ever stacked two strong players (got ' + stackedTeams + ')');
})();

// ---------------------------------------------------------------------------
section('Spread mode holds up over a long (10-game) session despite partner saturation');
(function () {
  // Each strong player has only 8 possible weak partners, so a 10-game session
  // forces partnership reuse. Spread mode should reuse a weak partnership rather
  // than stack two strong players.
  var session = {
    players: makePlayers([
      ['S1', 3], ['S2', 3], ['S3', 3], ['S4', 3],
      ['W1', 1], ['W2', 1], ['W3', 1], ['W4', 1],
      ['W5', 1], ['W6', 1], ['W7', 1], ['W8', 1],
    ]),
    config: { courts: 3, mode: 'spread' },
    games: [],
  };
  var byId = {};
  session.players.forEach(function (p) {
    byId[p.id] = p;
  });
  playFullSession(session, 10, 500);
  var stacks = 0;
  session.games.forEach(function (g) {
    g.matches.forEach(function (m) {
      [m.teamA, m.teamB].forEach(function (team) {
        if (team.filter(function (id) { return byId[id].skill === 3; }).length >= 2) stacks++;
      });
    });
  });
  ok(stacks === 0, 'no stacked strong pair across 10 games (got ' + stacks + ')');
})();

// ---------------------------------------------------------------------------
section('Level mode: similar skills grouped on the same court');
(function () {
  var session = {
    players: makePlayers([
      ['S1', 3], ['S2', 3], ['S3', 3], ['S4', 3],
      ['W1', 1], ['W2', 1], ['W3', 1], ['W4', 1],
    ]),
    config: { courts: 2, mode: 'level' }, // 8 players, 2 courts
    games: [],
  };
  var byId = {};
  session.players.forEach(function (p) {
    byId[p.id] = p;
  });
  playFullSession(session, 6, 400);

  var mixedCourts = 0;
  session.games.forEach(function (g) {
    g.matches.forEach(function (m) {
      var skills = m.teamA.concat(m.teamB).map(function (id) {
        return byId[id].skill;
      });
      if (Math.max.apply(null, skills) - Math.min.apply(null, skills) > 0) mixedCourts++;
    });
  });
  ok(mixedCourts === 0, 'level mode never mixed strong+weak on one court (got ' + mixedCourts + ')');
})();

// ---------------------------------------------------------------------------
section('Edge cases');
(function () {
  var few = {
    players: makePlayers([['A', 2], ['B', 2], ['C', 2]]),
    config: { courts: 1, mode: 'spread' },
    games: [],
  };
  var g = G.generateGame(few, { seed: 1 });
  ok(!!g.error, 'fewer than 4 present players returns an error');

  var four = {
    players: makePlayers([['A', 2], ['B', 2], ['C', 2], ['D', 2]]),
    config: { courts: 1, mode: 'spread' },
    games: [],
  };
  var g2 = G.generateGame(four, { seed: 1 });
  ok(!g2.error && g2.matches.length === 1 && g2.sitOuts.length === 0, 'exactly 4 players -> one match, no sit-outs');

  // Courts capped when too few players for the requested court count.
  var six = {
    players: makePlayers([['A', 2], ['B', 2], ['C', 2], ['D', 2], ['E', 2], ['F', 2]]),
    config: { courts: 2, mode: 'spread' }, // asks 2 courts (needs 8) but only 6 present
    games: [],
  };
  var g3 = G.generateGame(six, { seed: 1 });
  ok(g3.matches.length === 1 && g3.sitOuts.length === 2, 'courts capped to available players (1 court, 2 sit out)');
})();

// ---------------------------------------------------------------------------
console.log('\n' + (failed === 0 ? '✓ ALL PASSED' : '✗ FAILURES') + ' — ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
