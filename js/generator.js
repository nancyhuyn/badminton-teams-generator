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
    LEVEL_SPREAD: 1500, // level mode: per unit of skill range within a court group
    OPPONENT_REPEAT: 5, // secondary: recently-faced opponents
    OPPONENT_SINGLES: 1000, // singles: who you face IS the variety axis, so it
    // carries the weight PARTNER_REPEAT carries in doubles.
    OPPONENT_SINGLES_RECENT: 800,
    SINGLES_SHARE: 1200, // per 1v1 game already played, so a mixed session's
    // tiring singles court rotates instead of landing on the same two people.
    // Above PARTNER_REPEAT: who gets the small court decides how hard someone's
    // night is, which matters more than one partnership coming round again.
  };

  var STRONG_TIER = 3; // skill===3 counts as "experienced/strong"

  /*
   * How to fill the courts for one game. Returns the size of each court group:
   * 4 = doubles (2v2), 2 = singles (1v1).
   *
   * Players are spread across the courts rather than packed into full doubles
   * games, so the format falls out of the head count instead of being a
   * setting. Two rules, in order:
   *   1. seat as many people as the courts can hold
   *   2. among equally full plans, use as many courts as possible
   * So 4 players on 2 courts is [2, 2] — two 1v1s, nobody benched to make a
   * single 2v2 — and 7 on 2 courts is [4, 2] with one sitting.
   */
  function courtPlan(present, requestedCourts) {
    var courts = Math.max(1, requestedCourts || 1);
    var bestD = 0;
    var bestS = 0;
    var bestUsed = -1;
    var maxD = Math.min(courts, Math.floor(present / 4));
    for (var d = 0; d <= maxD; d++) {
      var s = Math.min(courts - d, Math.floor((present - d * 4) / 2));
      var used = d * 4 + s * 2;
      // more players seated wins; then more courts in play (i.e. spread out)
      if (used > bestUsed || (used === bestUsed && d + s > bestD + bestS)) {
        bestUsed = used;
        bestD = d;
        bestS = s;
      }
    }
    var plan = [];
    var i;
    for (i = 0; i < bestD; i++) plan.push(4);
    for (i = 0; i < bestS; i++) plan.push(2);
    return plan;
  }
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
    var singlesPlayed = {}; // id -> count of 1v1 games (drives auto's rotation)

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
          if (m.teamA.length === 1) singlesPlayed[id] = (singlesPlayed[id] || 0) + 1;
        });
        // Singles teams are one player, so there is no partnership to record.
        if (m.teamA.length === 2) bump(partner, m.teamA[0], m.teamA[1], g);
        if (m.teamB.length === 2) bump(partner, m.teamB[0], m.teamB[1], g);
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
      singlesPlayed: singlesPlayed,
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

  function opponentPenalty(stats, a, b, gameIndex, singles) {
    var rec = stats.opponent[pairKey(a, b)];
    if (!rec) return 0;
    var gap = gameIndex - rec.last;
    if (!singles) return W.OPPONENT_REPEAT * rec.count * (gap <= 2 ? 2 : 1);
    // In singles there are no partnerships, so facing someone new is the whole
    // point — score it the way partnerPenalty scores partnerships in doubles.
    var cost = W.OPPONENT_SINGLES * rec.count * rec.count;
    if (gap <= 2) cost += W.OPPONENT_SINGLES_RECENT;
    else if (gap <= 4) cost += W.OPPONENT_SINGLES_RECENT / 2;
    return cost;
  }

  function skillPenaltyForMatch(mode, teamA, teamB) {
    function sum(t) {
      return t.reduce(function (s, p) { return s + p.skill; }, 0);
    }
    function strongCount(t) {
      return t.filter(function (p) { return p.skill === STRONG_TIER; }).length;
    }
    var diff = Math.abs(sum(teamA) - sum(teamB));
    if (mode === 'level') {
      var all = teamA.concat(teamB).map(function (p) { return p.skill; });
      var range = Math.max.apply(null, all) - Math.min.apply(null, all);
      // keep everyone on court similar in level, then keep the two sides even
      return W.LEVEL_SPREAD * range + W.BALANCE * diff;
    }
    // 'spread' (default): balance the two sides AND refuse to stack strong
    // players. (Stacking is impossible in singles, where a team is one player,
    // so there the term is simply always zero.)
    var stack = (strongCount(teamA) >= 2 ? 1 : 0) + (strongCount(teamB) >= 2 ? 1 : 0);
    return W.BALANCE * diff + W.CONCENTRATE * stack;
  }

  // Every way to split a court group into two even teams:
  //   singles (2 players) -> the single a-vs-b matchup
  //   doubles (4 players) -> the 3 distinct pairings
  function splitsOf(grp) {
    if (grp.length === 2) return [[[grp[0]], [grp[1]]]];
    return [
      [[grp[0], grp[1]], [grp[2], grp[3]]],
      [[grp[0], grp[2]], [grp[1], grp[3]]],
      [[grp[0], grp[3]], [grp[1], grp[2]]],
    ];
  }

  // Best of the possible team splits of one court group, with its cost.
  function bestSplitForGroup(grp, mode, stats, gameIndex) {
    var splits = splitsOf(grp);
    var singles = grp.length === 2;
    var best = null;
    for (var i = 0; i < splits.length; i++) {
      var teamA = splits[i][0];
      var teamB = splits[i][1];
      var cost = skillPenaltyForMatch(mode, teamA, teamB);
      // partnerships (doubles only — a singles "team" has nobody to repeat with)
      [teamA, teamB].forEach(function (team) {
        if (team.length === 2) cost += partnerPenalty(stats, team[0].id, team[1].id, gameIndex);
      });
      // opponents: every cross pair
      teamA.forEach(function (a) {
        teamB.forEach(function (b) {
          cost += opponentPenalty(stats, a.id, b.id, gameIndex, singles);
        });
      });
      // A mixed game's 1v1 court is the tiring one, so prefer to hand it to
      // whoever has played the fewest singles rather than the same two people.
      if (singles) {
        cost += W.SINGLES_SHARE * grp.reduce(function (s, p) {
          return s + (stats.singlesPlayed[p.id] || 0);
        }, 0);
      }
      if (!best || cost < best.cost) best = { teamA: teamA, teamB: teamB, cost: cost };
    }
    return best;
  }

  function groupCost(grp, mode, stats, gameIndex) {
    return bestSplitForGroup(grp, mode, stats, gameIndex).cost;
  }

  // Greedy local search: swap players between courts whenever it lowers total
  // cost. Cheap (courts are tiny) and reliably reaches the optimum the random
  // restarts got close to. Swaps are 1-for-1, so courts of different sizes
  // (a 2v2 next to a 1v1) keep their sizes and the plan stays intact.
  function improveGroups(groups, mode, stats, gameIndex) {
    var costs = groups.map(function (f) {
      return groupCost(f, mode, stats, gameIndex);
    });
    var improved = true;
    var guard = 0;
    while (improved && guard++ < 500) {
      improved = false;
      for (var i = 0; i < groups.length; i++) {
        for (var j = i + 1; j < groups.length; j++) {
          for (var a = 0; a < groups[i].length; a++) {
            for (var b = 0; b < groups[j].length; b++) {
              var tmp = groups[i][a];
              groups[i][a] = groups[j][b];
              groups[j][b] = tmp;
              var ci = groupCost(groups[i], mode, stats, gameIndex);
              var cj = groupCost(groups[j], mode, stats, gameIndex);
              if (ci + cj < costs[i] + costs[j] - 1e-9) {
                costs[i] = ci;
                costs[j] = cj;
                improved = true;
              } else {
                // revert
                var t2 = groups[i][a];
                groups[i][a] = groups[j][b];
                groups[j][b] = t2;
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

    if (present.length < 2) {
      return {
        error: 'Need at least 2 players to make a game.',
        index: gameIndex,
      };
    }

    // Court sizes for this game (4 = 2v2, 2 = 1v1), spread over the courts.
    var requested = (session.config && session.config.courts) || Math.ceil(present.length / 4);
    var plan = courtPlan(present.length, requested);
    var playingCount = plan.reduce(function (s, n) { return s + n; }, 0);
    var sitOutCount = present.length - playingCount;

    var sitOutIds = pickSitOuts(present, sitOutCount, stats, rng);
    var sitSet = {};
    sitOutIds.forEach(function (id) {
      sitSet[id] = true;
    });
    var playing = present.filter(function (p) {
      return !sitSet[p.id];
    });

    // Randomized restarts: shuffle players, chunk into court groups, score.
    var best = null;
    for (var s = 0; s < samples; s++) {
      var order = shuffle(playing, rng);
      var groups = [];
      var total = 0;
      var at = 0;
      for (var c = 0; c < plan.length; c++) {
        var grp = order.slice(at, at + plan[c]);
        at += plan[c];
        groups.push(grp);
        total += groupCost(grp, mode, stats, gameIndex);
      }
      if (!best || total < best.total) best = { total: total, groups: groups };
    }

    // Refine the best restart with local search.
    best.total = improveGroups(best.groups, mode, stats, gameIndex);

    function ids(team) {
      return team.map(function (p) { return p.id; });
    }
    var game = {
      index: gameIndex,
      matches: best.groups.map(function (grp, i) {
        var split = bestSplitForGroup(grp, mode, stats, gameIndex);
        return { court: i + 1, teamA: ids(split.teamA), teamB: ids(split.teamB) };
      }),
      sitOuts: sitOutIds,
      cost: best.total,
    };
    return game;
  }

  return {
    generateGame: generateGame,
    courtPlan: courtPlan,
    deriveStats: deriveStats,
    pairKey: pairKey,
    WEIGHTS: W,
    STRONG_TIER: STRONG_TIER,
  };
});
