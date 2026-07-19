/*
 * Badminton team generator — pure logic module.
 *
 * No DOM, no framework, no dependencies. Works in the browser (attaches to
 * window.BadmintonGen) and in Node (module.exports) so it can be unit-tested.
 *
 * Core entry point: generateGame(session, options) -> Game
 *   Given the current session state it produces ONE game (the court/team layout
 *   plus sit-outs). Call it repeatedly to build a full session; each call reads
 *   history from session.games so partnerships and sit-outs stay fair.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BadmintonGen = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /*
   * Tunable weights. The active balancing mode decides which term is
   * near-hard and which is secondary:
   *   spread mode -> CONCENTRATE (don't stack strong players) outranks partner
   *                  variety, which outranks fine skill balance.
   *   level mode  -> LEVEL_SPREAD (keep similar levels together) outranks
   *                  partner variety.
   * Both intentionally sit ABOVE PARTNER_REPEAT so the mode's core promise
   * holds even when honouring it forces a partnership to repeat.
   */
  var W = {
    PARTNER_REPEAT: 1000, // base cost for any repeated partnership (scales with count)
    PARTNER_RECENT: 800, // extra cost when the repeat happened very recently
    CONCENTRATE: 2500, // spread mode: two "strong" players stacked on one team.
    // Kept above a single partnership-repeat (<=1800) so that late in a long
    // session the generator reuses a weak partnership rather than stacking two
    // strong players. Only true saturation (a pair already partnered twice,
    // cost 4000) outweighs it.
    BALANCE: 30, // spread mode: per-match team skill-sum difference
    LEVEL_SPREAD: 1500, // level mode: per unit of skill range within a foursome
    OPPONENT_REPEAT: 5, // secondary: recently-faced opponents
  };

  var STRONG_TIER = 3; // skill===3 counts as "experienced/strong"
  var DEFAULT_SAMPLES = 400; // random restarts; a local-search pass refines each

  // ---------- small helpers ----------

  function pairKey(a, b) {
    return a < b ? a + '|' + b : b + '|' + a;
  }

  function shuffle(arr, rng) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  // Deterministic RNG (mulberry32) so tests are reproducible when a seed is given.
  function makeRng(seed) {
    if (seed === undefined || seed === null) return Math.random;
    var s = seed >>> 0;
    return function () {
      s |= 0;
      s = (s + 0x6d2b79f5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /*
   * Roll the recorded games up into the stats the cost function needs.
   * `upTo` (exclusive) lets "regenerate game i" ignore game i and everything
   * after it, so the replacement is scored against the same history the
   * original game saw.
   */
  function deriveStats(games, upTo) {
    var limit = upTo === undefined ? games.length : upTo;
    var partner = {}; // pairKey -> {count, last}
    var opponent = {}; // pairKey -> {count, last}
    var gamesPlayed = {}; // id -> count
    var sitOuts = {}; // id -> count

    function bump(map, a, b, idx) {
      var k = pairKey(a, b);
      if (!map[k]) map[k] = { count: 0, last: -Infinity };
      map[k].count++;
      map[k].last = idx;
    }

    for (var g = 0; g < limit; g++) {
      var game = games[g];
      (game.sitOuts || []).forEach(function (id) {
        sitOuts[id] = (sitOuts[id] || 0) + 1;
      });
      game.matches.forEach(function (m) {
        var all = m.teamA.concat(m.teamB);
        all.forEach(function (id) {
          gamesPlayed[id] = (gamesPlayed[id] || 0) + 1;
        });
        bump(partner, m.teamA[0], m.teamA[1], g);
        bump(partner, m.teamB[0], m.teamB[1], g);
        // every cross-team pair faced each other
        m.teamA.forEach(function (a) {
          m.teamB.forEach(function (b) {
            bump(opponent, a, b, g);
          });
        });
      });
    }
    return {
      partner: partner,
      opponent: opponent,
      gamesPlayed: gamesPlayed,
      sitOuts: sitOuts,
      nextIndex: limit,
    };
  }

  // ---------- scoring ----------

  function partnerPenalty(stats, a, b, gameIndex) {
    var rec = stats.partner[pairKey(a, b)];
    if (!rec) return 0; // never partnered — the outcome we want
    var cost = W.PARTNER_REPEAT * rec.count * rec.count; // quadratic: really avoid 2nd+ repeats
    var gap = gameIndex - rec.last;
    if (gap <= 2) cost += W.PARTNER_RECENT;
    else if (gap <= 4) cost += W.PARTNER_RECENT / 2;
    return cost;
  }

  function opponentPenalty(stats, a, b, gameIndex) {
    var rec = stats.opponent[pairKey(a, b)];
    if (!rec) return 0;
    var gap = gameIndex - rec.last;
    return W.OPPONENT_REPEAT * rec.count * (gap <= 2 ? 2 : 1);
  }

  function skillPenaltyForMatch(mode, teamA, teamB) {
    function sum(t) {
      return t[0].skill + t[1].skill;
    }
    function strongCount(t) {
      return (t[0].skill === STRONG_TIER ? 1 : 0) + (t[1].skill === STRONG_TIER ? 1 : 0);
    }
    if (mode === 'level') {
      var all = [teamA[0].skill, teamA[1].skill, teamB[0].skill, teamB[1].skill];
      var range = Math.max.apply(null, all) - Math.min.apply(null, all);
      // keep the four similar in level, then keep the two teams even
      return W.LEVEL_SPREAD * range + W.BALANCE * Math.abs(sum(teamA) - sum(teamB));
    }
    // 'spread' (default): balance the two teams AND refuse to stack strong players
    var stack = (strongCount(teamA) >= 2 ? 1 : 0) + (strongCount(teamB) >= 2 ? 1 : 0);
    return W.BALANCE * Math.abs(sum(teamA) - sum(teamB)) + W.CONCENTRATE * stack;
  }

  // Best of the 3 possible team splits of a foursome, with its cost.
  function bestSplitForFoursome(four, mode, stats, gameIndex) {
    var splits = [
      [[four[0], four[1]], [four[2], four[3]]],
      [[four[0], four[2]], [four[1], four[3]]],
      [[four[0], four[3]], [four[1], four[2]]],
    ];
    var best = null;
    for (var i = 0; i < splits.length; i++) {
      var teamA = splits[i][0];
      var teamB = splits[i][1];
      var cost =
        partnerPenalty(stats, teamA[0].id, teamA[1].id, gameIndex) +
        partnerPenalty(stats, teamB[0].id, teamB[1].id, gameIndex) +
        skillPenaltyForMatch(mode, teamA, teamB);
      // opponents: all four cross pairs
      teamA.forEach(function (a) {
        teamB.forEach(function (b) {
          cost += opponentPenalty(stats, a.id, b.id, gameIndex);
        });
      });
      if (!best || cost < best.cost) best = { teamA: teamA, teamB: teamB, cost: cost };
    }
    return best;
  }

  function foursomeCost(four, mode, stats, gameIndex) {
    return bestSplitForFoursome(four, mode, stats, gameIndex).cost;
  }

  // Greedy local search: swap players between courts whenever it lowers total
  // cost. Cheap (courts are tiny) and reliably reaches the optimum the random
  // restarts got close to.
  function improveFoursomes(foursomes, mode, stats, gameIndex) {
    var costs = foursomes.map(function (f) {
      return foursomeCost(f, mode, stats, gameIndex);
    });
    var improved = true;
    var guard = 0;
    while (improved && guard++ < 500) {
      improved = false;
      for (var i = 0; i < foursomes.length; i++) {
        for (var j = i + 1; j < foursomes.length; j++) {
          for (var a = 0; a < 4; a++) {
            for (var b = 0; b < 4; b++) {
              var tmp = foursomes[i][a];
              foursomes[i][a] = foursomes[j][b];
              foursomes[j][b] = tmp;
              var ci = foursomeCost(foursomes[i], mode, stats, gameIndex);
              var cj = foursomeCost(foursomes[j], mode, stats, gameIndex);
              if (ci + cj < costs[i] + costs[j] - 1e-9) {
                costs[i] = ci;
                costs[j] = cj;
                improved = true;
              } else {
                // revert
                var t2 = foursomes[i][a];
                foursomes[i][a] = foursomes[j][b];
                foursomes[j][b] = t2;
              }
            }
          }
        }
      }
    }
    return costs.reduce(function (s, c) {
      return s + c;
    }, 0);
  }

  // ---------- sit-out selection ----------

  // Pick who sits this game: those who have sat out the FEWEST so far, so the
  // burden evens out. Ties broken by fewest games played, then randomly.
  function pickSitOuts(present, count, stats, rng) {
    if (count <= 0) return [];
    var ordered = shuffle(present, rng).slice().sort(function (a, b) {
      var sa = stats.sitOuts[a.id] || 0;
      var sb = stats.sitOuts[b.id] || 0;
      if (sa !== sb) return sa - sb;
      var ga = stats.gamesPlayed[a.id] || 0;
      var gb = stats.gamesPlayed[b.id] || 0;
      return ga - gb; // fewer games -> shouldn't happen much, but keeps it fair
    });
    return ordered.slice(0, count).map(function (p) {
      return p.id;
    });
  }

  // ---------- main entry ----------

  /*
   * options:
   *   excludeFrom : ignore games at this index and later when reading history
   *                 (used by "regenerate game i" — pass i)
   *   samples     : number of random partitions to evaluate (default 1500)
   *   seed        : optional integer for reproducible output
   */
  function generateGame(session, options) {
    options = options || {};
    var rng = makeRng(options.seed);
    var samples = options.samples || DEFAULT_SAMPLES;
    var mode = (session.config && session.config.mode) || 'spread';

    var present = session.players.filter(function (p) {
      return p.present;
    });
    var stats = deriveStats(session.games || [], options.excludeFrom);
    var gameIndex = options.excludeFrom !== undefined ? options.excludeFrom : (session.games || []).length;

    if (present.length < 4) {
      return { error: 'Need at least 4 present players to make a game.', index: gameIndex };
    }

    // How many courts can we actually run this game?
    var requested = (session.config && session.config.courts) || Math.floor(present.length / 4);
    var courts = Math.max(1, Math.min(requested, Math.floor(present.length / 4)));
    var playingCount = courts * 4;
    var sitOutCount = present.length - playingCount;

    var sitOutIds = pickSitOuts(present, sitOutCount, stats, rng);
    var sitSet = {};
    sitOutIds.forEach(function (id) {
      sitSet[id] = true;
    });
    var playing = present.filter(function (p) {
      return !sitSet[p.id];
    });

    // Randomized restarts: shuffle players, chunk into foursomes, score.
    var best = null;
    for (var s = 0; s < samples; s++) {
      var order = shuffle(playing, rng);
      var foursomes = [];
      var total = 0;
      for (var c = 0; c < courts; c++) {
        var four = order.slice(c * 4, c * 4 + 4);
        foursomes.push(four);
        total += foursomeCost(four, mode, stats, gameIndex);
      }
      if (!best || total < best.total) best = { total: total, foursomes: foursomes };
    }

    // Refine the best restart with local search.
    best.total = improveFoursomes(best.foursomes, mode, stats, gameIndex);

    var game = {
      index: gameIndex,
      matches: best.foursomes.map(function (four, i) {
        var split = bestSplitForFoursome(four, mode, stats, gameIndex);
        return {
          court: i + 1,
          teamA: [split.teamA[0].id, split.teamA[1].id],
          teamB: [split.teamB[0].id, split.teamB[1].id],
        };
      }),
      sitOuts: sitOutIds,
      cost: best.total,
    };
    return game;
  }

  return {
    generateGame: generateGame,
    deriveStats: deriveStats,
    pairKey: pairKey,
    WEIGHTS: W,
    STRONG_TIER: STRONG_TIER,
  };
});
