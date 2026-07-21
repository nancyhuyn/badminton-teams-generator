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
section('Court plan: players spread across the courts, 2v2 or 1v1 as they fit');
(function () {
  function plan(n, courts) { return G.courtPlan(n, courts).join(','); }

  // The two rules, in order: seat as many people as possible, then use as many
  // courts as possible.
  ok(plan(4, 2) === '2,2', '4 players on 2 courts -> two 1v1s, not one 2v2 (' + plan(4, 2) + ')');
  ok(plan(7, 2) === '4,2', '7 players on 2 courts -> a 2v2 and a 1v1 (' + plan(7, 2) + ')');
  ok(plan(8, 2) === '4,4', '8 players on 2 courts -> two 2v2s (' + plan(8, 2) + ')');
  ok(plan(6, 2) === '4,2', '6 players on 2 courts -> everyone plays (' + plan(6, 2) + ')');
  ok(plan(4, 1) === '4', '4 players on 1 court -> one 2v2 (' + plan(4, 1) + ')');
  ok(plan(3, 2) === '2', '3 players on 2 courts -> one 1v1, one sits (' + plan(3, 2) + ')');
  ok(plan(2, 3) === '2', '2 players -> a single 1v1 (' + plan(2, 3) + ')');
  ok(plan(9, 2) === '4,4', 'courts, not players, are the cap (' + plan(9, 2) + ')');
  ok(plan(1, 2) === '', 'nobody can play with 1 present (' + plan(1, 2) + ')');
})();

// ---------------------------------------------------------------------------
section('Mixed courts: a 2v2 and a 1v1 side by side, with the 1v1 rotating');
(function () {
  var session = {
    players: makePlayers([
      ['A', 2], ['B', 2], ['C', 2], ['D', 2],
      ['E', 2], ['F', 2], ['G', 2],
    ]),
    config: { courts: 2, mode: 'spread' },
    games: [],
  };
  playFullSession(session, 7, 700);

  var shapesOk = session.games.every(function (g) {
    var sizes = g.matches.map(function (m) { return m.teamA.length + m.teamB.length; });
    return sizes.length === 2 && sizes.indexOf(4) >= 0 && sizes.indexOf(2) >= 0;
  });
  ok(shapesOk, '7 players on 2 courts -> one 2v2 and one 1v1 every game');
  ok(
    session.games.every(function (g) { return g.sitOuts.length === 1; }),
    '7 players, 6 on court -> exactly 1 sitting out each game'
  );

  var stats = G.deriveStats(session.games);
  // 7 games x 1 singles court x 2 players = 14 singles slots over 7 players, so
  // ~2 each. The generator picks each game greedily against history rather than
  // planning the whole session, so it lands near even, not exactly even.
  var singles = session.players.map(function (p) { return stats.singlesPlayed[p.id] || 0; });
  var spreadS = Math.max.apply(null, singles) - Math.min.apply(null, singles);
  ok(spreadS <= 2, 'the 1v1 court rotates (spread ' + spreadS + ', counts ' + singles.join(',') + ')');
  ok(
    singles.every(function (c) { return c >= 1; }),
    'nobody is left out of the 1v1 court entirely (' + singles.join(',') + ')'
  );

  var sits = session.players.map(function (p) { return stats.sitOuts[p.id] || 0; });
  var spread = Math.max.apply(null, sits) - Math.min.apply(null, sits);
  ok(spread <= 1, 'sit-outs stay even (spread ' + spread + ', counts ' + sits.join(',') + ')');
})();

// ---------------------------------------------------------------------------
section('All-1v1 level mode: like plays like');
(function () {
  var session = {
    players: makePlayers([
      ['S1', 3], ['S2', 3], ['S3', 3], ['S4', 3],
      ['W1', 1], ['W2', 1], ['W3', 1], ['W4', 1],
    ]),
    config: { courts: 4, mode: 'level' }, // 8 players over 4 courts -> four 1v1s
    games: [],
  };
  var byId = {};
  session.players.forEach(function (p) { byId[p.id] = p; });
  playFullSession(session, 6, 800);

  var mismatched = 0;
  session.games.forEach(function (g) {
    ok(g.sitOuts.length === 0, 'all 8 players are on court across 4 1v1 courts');
    g.matches.forEach(function (m) {
      if (byId[m.teamA[0]].skill !== byId[m.teamB[0]].skill) mismatched++;
    });
  });
  ok(mismatched === 0, 'level mode never matched a strong player against a weak one (got ' + mismatched + ')');
})();

// ---------------------------------------------------------------------------
section('Odd player counts: the remainder just rotates through the sit-out list');
(function () {
  // 5 players on 2 courts -> two 1v1s, 1 sits. Over 5 games everyone should
  // sit exactly once.
  var s1 = {
    players: makePlayers([['A', 2], ['B', 2], ['C', 2], ['D', 2], ['E', 2]]),
    config: { courts: 2, mode: 'spread' },
    games: [],
  };
  playFullSession(s1, 5, 900);
  var st1 = G.deriveStats(s1.games);
  var sits1 = s1.players.map(function (p) { return st1.sitOuts[p.id] || 0; });
  ok(
    sits1.every(function (c) { return c === 1; }),
    '5 players over 5 games -> everyone sits exactly once (' + sits1.join(',') + ')'
  );
  ok(
    s1.games.every(function (g) { return g.matches.length === 2 && g.sitOuts.length === 1; }),
    '5 players on 2 courts -> two 1v1s + 1 sit-out every game'
  );

  // 11 players on 2 courts: two 2v2s, so 3 sit each game.
  var s2 = {
    players: makePlayers([
      ['A', 2], ['B', 2], ['C', 2], ['D', 2], ['E', 2], ['F', 2],
      ['G', 2], ['H', 2], ['I', 2], ['J', 2], ['K', 2],
    ]),
    config: { courts: 2, mode: 'spread' },
    games: [],
  };
  playFullSession(s2, 7, 950);
  ok(
    s2.games.every(function (g) { return g.matches.length === 2 && g.sitOuts.length === 3; }),
    '11 players on 2 courts -> two 2v2s, 3 sitting out (capped by the courts)'
  );
  var st2 = G.deriveStats(s2.games);
  var sits2 = s2.players.map(function (p) { return st2.sitOuts[p.id] || 0; });
  var spread2 = Math.max.apply(null, sits2) - Math.min.apply(null, sits2);
  ok(spread2 <= 1, 'odd player count keeps sit-outs within 1 (' + sits2.join(',') + ')');

  // 9 players, 4 courts: 8 play as four 1v1s, 1 sits — an odd count that still
  // fills every court.
  var s3 = {
    players: makePlayers([
      ['A', 2], ['B', 2], ['C', 2], ['D', 2], ['E', 2],
      ['F', 2], ['G', 2], ['H', 2], ['I', 2],
    ]),
    config: { courts: 4, mode: 'spread' },
    games: [],
  };
  playFullSession(s3, 9, 990);
  var st3 = G.deriveStats(s3.games);
  var sits3 = s3.players.map(function (p) { return st3.sitOuts[p.id] || 0; });
  ok(
    sits3.every(function (c) { return c === 1; }),
    '9 players over 9 games -> everyone sits exactly once (' + sits3.join(',') + ')'
  );
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
  ok(
    !g.error && g.matches.length === 1 && g.matches[0].teamA.length === 1 && g.sitOuts.length === 1,
    '3 players on 1 court -> a 1v1 with 1 sitting out'
  );

  var four = {
    players: makePlayers([['A', 2], ['B', 2], ['C', 2], ['D', 2]]),
    config: { courts: 1, mode: 'spread' },
    games: [],
  };
  var g2 = G.generateGame(four, { seed: 1 });
  ok(!g2.error && g2.matches.length === 1 && g2.sitOuts.length === 0, 'exactly 4 players -> one match, no sit-outs');

  // Six on two courts fills both rather than benching two people for one 2v2.
  var six = {
    players: makePlayers([['A', 2], ['B', 2], ['C', 2], ['D', 2], ['E', 2], ['F', 2]]),
    config: { courts: 2, mode: 'spread' },
    games: [],
  };
  var g3 = G.generateGame(six, { seed: 1 });
  ok(
    g3.matches.length === 2 && g3.sitOuts.length === 0,
    '6 players on 2 courts -> a 2v2 plus a 1v1, nobody sits'
  );

  var one = {
    players: makePlayers([['A', 2]]),
    config: { courts: 1, mode: 'spread' },
    games: [],
  };
  ok(!!G.generateGame(one, { seed: 1 }).error, 'fewer than 2 present players returns an error');
})();

// ---------------------------------------------------------------------------
section('Match results: winner, scores, and W/L stats');
(function () {
  ok(G.winnerOf({ teamA: ['p0'], teamB: ['p1'] }) === null, 'no result recorded -> null');
  ok(G.winnerOf({ teamA: ['p0'], teamB: ['p1'], winner: 'B' }) === 'B', 'explicit winner is used');
  ok(G.winnerOf({ teamA: ['p0'], teamB: ['p1'], score: [21, 15] }) === 'A', 'a score decides the match');
  ok(
    G.winnerOf({ teamA: ['p0'], teamB: ['p1'], score: [15, 21], winner: 'A' }) === 'B',
    'a decisive score outranks a stale explicit winner'
  );
  ok(G.winnerOf({ teamA: ['p0'], teamB: ['p1'], score: [10, 10] }) === null, 'a tie is not a result');
  ok(!G.hasScore({ teamA: ['p0'], teamB: ['p1'], score: [21] }), 'a half-filled score is not a score');

  var games = [
    {
      index: 0,
      matches: [{ court: 1, teamA: ['p0', 'p1'], teamB: ['p2', 'p3'], score: [21, 17] }],
      sitOuts: [],
    },
    {
      index: 1,
      matches: [{ court: 1, teamA: ['p0', 'p2'], teamB: ['p1', 'p3'], winner: 'B' }],
      sitOuts: [],
    },
    // no result on this one — it should count as a game played but not a loss
    { index: 2, matches: [{ court: 1, teamA: ['p0', 'p3'], teamB: ['p1', 'p2'] }], sitOuts: [] },
  ];
  var st = G.deriveStats(games);
  ok(st.wins.p0 === 1 && st.losses.p0 === 1, 'p0: won game 1, lost game 2');
  ok(st.wins.p1 === 2 && !st.losses.p1, 'p1: won both recorded games');
  ok(st.gamesPlayed.p0 === 3, 'unrecorded games still count as played');
  ok((st.wins.p2 || 0) + (st.losses.p2 || 0) === 2, 'only recorded matches reach W/L');
  ok(st.pointsFor.p0 === 21 && st.pointsAgainst.p0 === 17, 'points tracked per side');
  ok(!st.pointsFor.p3 || st.pointsFor.p3 === 17, 'losing side keeps its own points');
})();

// ---------------------------------------------------------------------------
console.log('\n' + (failed === 0 ? '✓ ALL PASSED' : '✗ FAILURES') + ' — ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
