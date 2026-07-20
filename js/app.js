/*
 * UI controller. Owns app state, persists to localStorage, and renders the
 * three views. All team-forming logic lives in generator.js (BadmintonGen).
 *
 * State model (v2): the app holds a list of named GROUPS (saved rosters you
 * play with repeatedly). Each group carries its own players, settings, and
 * current schedule, so switching groups swaps the whole view. One group is
 * active at a time. Older single-session saves are migrated in automatically.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'badminton-app-v2';
  var OLD_KEY = 'badminton-session-v1';
  var SKILL_LABEL = { 1: 'Beginner', 2: 'Intermediate', 3: 'Advanced' };

  // ---------- state ----------
  var state = loadState();

  function defaultConfig() {
    return { courts: 2, mode: 'spread', games: 10 };
  }
  // Court sizes for one game (4 = 2v2, 2 = 1v1), as the generator will pick them.
  function planFor(g) {
    g = g || group();
    var n = g.players.filter(function (p) { return p.present; }).length;
    return BadmintonGen.courtPlan(n, g.config.courts);
  }
  function newGroupObj(name) {
    return { id: gid(), name: name, players: [], config: defaultConfig(), games: [] };
  }
  function gid() {
    return 'g' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
  }
  function uid() {
    return 'p' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
  }

  function loadState() {
    // Preferred: the v2 multi-group store.
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var s = JSON.parse(raw);
        if (s && s.groups && s.groups.length) return normalize(s);
      }
    } catch (e) {
      /* fall through */
    }
    // Migrate a legacy single session into a "My group".
    try {
      var old = localStorage.getItem(OLD_KEY);
      if (old) {
        var os = JSON.parse(old);
        var g = newGroupObj('My group');
        g.players = (os.players || []).map(function (p) {
          return { id: p.id || uid(), name: p.name, skill: p.skill, present: p.present !== false };
        });
        g.config = {
          courts: (os.config && os.config.courts) || 2,
          mode: (os.config && os.config.mode) || 'spread',
          games: 10,
        };
        g.games = os.games || [];
        return { groups: [g], activeGroupId: g.id };
      }
    } catch (e) {
      /* fall through */
    }
    var g0 = newGroupObj('My group');
    return { groups: [g0], activeGroupId: g0.id };
  }

  // Backfill any missing fields so older/partial data renders safely.
  function normalize(s) {
    s.groups.forEach(function (g) {
      g.config = g.config || defaultConfig();
      if (g.config.games === undefined) g.config.games = 10;
      delete g.config.format; // pre-mixed-courts saves pinned a format; now derived

      g.games = g.games || [];
      g.players = (g.players || []).map(function (p) {
        return { id: p.id || uid(), name: p.name, skill: p.skill || 2, present: p.present !== false };
      });
    });
    if (!s.groups.some(function (g) { return g.id === s.activeGroupId; })) {
      s.activeGroupId = s.groups[0].id;
    }
    return s;
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      /* private mode / quota — app still works in-memory */
    }
  }

  // The active group is the working object every view reads from. Its shape
  // ({players, config, games}) is exactly what BadmintonGen.generateGame wants.
  function group() {
    return state.groups.find(function (g) { return g.id === state.activeGroupId; }) || state.groups[0];
  }
  function nameOf(id) {
    var p = group().players.find(function (x) { return x.id === id; });
    return p ? p.name : '?';
  }

  // ---------- $ helpers ----------
  function $(sel) {
    return document.querySelector(sel);
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  var toastTimer;
  function toast(msg) {
    var t = $('#toast') || (function () {
      var d = el('div', 'toast');
      d.id = 'toast';
      document.body.appendChild(d);
      return d;
    })();
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      t.classList.remove('show');
    }, 1900);
  }

  // ---------- navigation ----------
  $('#tabs').addEventListener('click', function (e) {
    var btn = e.target.closest('.tab');
    if (!btn) return;
    showView(btn.dataset.view);
  });
  function showView(name) {
    document.querySelectorAll('.tab').forEach(function (t) {
      t.classList.toggle('active', t.dataset.view === name);
    });
    document.querySelectorAll('.view').forEach(function (v) {
      v.classList.toggle('active', v.id === 'view-' + name);
    });
    // The fixed bottom bar only belongs to the session view.
    $('#session-bar').hidden = name !== 'session';
    if (name === 'stats') renderStats();
    if (name === 'session') renderSession();
  }

  // ---------- groups ----------
  function renderGroupSelect() {
    var sel = $('#group-select');
    sel.innerHTML = '';
    state.groups.forEach(function (g) {
      var o = el('option', null, g.name + ' (' + g.players.length + ')');
      o.value = g.id;
      if (g.id === state.activeGroupId) o.selected = true;
      sel.appendChild(o);
    });
    // Can't delete your only group.
    $('#btn-delete-group').disabled = state.groups.length <= 1;
  }

  function switchGroup(id) {
    state.activeGroupId = id;
    save();
    refreshAll();
  }

  $('#group-select').addEventListener('change', function () {
    switchGroup(this.value);
  });
  $('#btn-new-group').addEventListener('click', function () {
    var name = (prompt('Name this group (e.g. "Sunday crew"):') || '').trim();
    if (!name) return;
    var g = newGroupObj(name);
    state.groups.push(g);
    state.activeGroupId = g.id;
    save();
    refreshAll();
    toast('Created "' + name + '"');
  });
  $('#btn-rename-group').addEventListener('click', function () {
    var g = group();
    var name = (prompt('Rename group:', g.name) || '').trim();
    if (!name) return;
    g.name = name;
    save();
    renderGroupSelect();
    toast('Renamed');
  });
  $('#btn-delete-group').addEventListener('click', function () {
    if (state.groups.length <= 1) {
      toast("Can't delete your only group.");
      return;
    }
    var g = group();
    if (!confirm('Delete group "' + g.name + '" and its schedule? This cannot be undone.')) return;
    state.groups = state.groups.filter(function (x) { return x.id !== g.id; });
    state.activeGroupId = state.groups[0].id;
    save();
    refreshAll();
    toast('Deleted "' + g.name + '"');
  });

  // ---------- setup: players ----------
  $('#add-player-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('#player-name').value.trim();
    if (!name) return;
    group().players.push({
      id: uid(),
      name: name,
      skill: parseInt($('#player-skill').value, 10),
      present: true,
    });
    $('#player-name').value = '';
    $('#player-name').focus();
    save();
    renderPlayers();
    renderCapacityHint();
    renderGroupSelect(); // player count in the label
  });

  function renderPlayers() {
    var list = $('#player-list');
    var players = group().players;
    list.innerHTML = '';
    $('#player-empty').style.display = players.length ? 'none' : 'block';

    players.forEach(function (p) {
      var li = el('li');

      var chk = el('input', 'present-toggle');
      chk.type = 'checkbox';
      chk.checked = p.present;
      chk.title = 'Present this session';
      chk.addEventListener('change', function () {
        p.present = chk.checked;
        save();
        renderPlayers();
        renderCapacityHint();
      });

      var name = el('span', 'p-name' + (p.present ? '' : ' absent'), p.name);

      var skill = el('select', 'mini-select');
      [1, 2, 3].forEach(function (s) {
        var o = el('option', null, SKILL_LABEL[s]);
        o.value = s;
        if (s === p.skill) o.selected = true;
        skill.appendChild(o);
      });
      skill.addEventListener('change', function () {
        p.skill = parseInt(skill.value, 10);
        save();
      });

      var del = el('button', 'icon-btn', '✕');
      del.title = 'Remove player';
      del.addEventListener('click', function () {
        group().players = group().players.filter(function (x) { return x.id !== p.id; });
        save();
        renderPlayers();
        renderCapacityHint();
        renderGroupSelect();
      });

      li.appendChild(chk);
      li.appendChild(name);
      li.appendChild(skill);
      li.appendChild(del);
      list.appendChild(li);
    });
  }

  // ---------- setup: config ----------
  $('#cfg-courts').addEventListener('change', function () {
    group().config.courts = clampInt(this.value, 1, 6, 2);
    this.value = group().config.courts;
    save();
    renderCapacityHint();
  });
  $('#cfg-games').addEventListener('change', function () {
    group().config.games = clampInt(this.value, 1, 30, 10);
    this.value = group().config.games;
    save();
  });
  $('#cfg-mode').addEventListener('change', function () {
    group().config.mode = this.value;
    save();
  });
  function clampInt(v, min, max, dflt) {
    var n = parseInt(v, 10);
    if (isNaN(n)) return dflt;
    return Math.max(min, Math.min(max, n));
  }

  function presentCount() {
    return group().players.filter(function (p) { return p.present; }).length;
  }
  function renderCapacityHint() {
    renderHeader(); // present/court counts live in the header too
    var n = presentCount();
    var courts = group().config.courts;
    var hint = $('#capacity-hint');
    if (n < 2) {
      hint.textContent = 'Add at least 2 present players to make a game.';
      return;
    }
    var plan = planFor();
    var doubles = plan.filter(function (size) { return size === 4; }).length;
    var singles = plan.length - doubles;
    var playing = doubles * 4 + singles * 2;
    var sitting = n - playing;
    // Spell out the court mix, since it's now derived from the head count
    // rather than chosen: "2 courts (1 × 2v2, 1 × 1v1)".
    var mix = [];
    if (doubles) mix.push(doubles + ' × 2v2');
    if (singles) mix.push(singles + ' × 1v1');
    var msg =
      n + ' present · ' + plan.length + ' court' + (plan.length > 1 ? 's' : '') +
      ' (' + mix.join(', ') + ') · ' + playing + ' playing';
    if (sitting > 0) msg += ' · ' + sitting + ' sitting out each game';
    if (plan.length < courts) msg += ' (capped: not enough players for ' + courts + ' courts)';
    hint.textContent = msg;
  }

  // ---------- generate ----------
  function enoughPlayers() {
    if (presentCount() >= 2) return true;
    toast('Need at least 2 present players.');
    return false;
  }

  function generateFullSession() {
    if (!enoughPlayers()) return;
    var numGames = group().config.games || 10;
    group().games = [];
    for (var i = 0; i < numGames; i++) {
      var g = BadmintonGen.generateGame(group());
      if (g.error) {
        toast(g.error);
        break;
      }
      group().games.push(g);
    }
    save();
    showView('session');
    toast(group().games.length + ' games generated');
  }

  function nextGame() {
    if (!enoughPlayers()) return;
    var g = BadmintonGen.generateGame(group());
    if (g.error) {
      toast(g.error);
      return;
    }
    group().games.push(g);
    save();
    renderSession();
    var container = $('#games-container');
    container.lastElementChild && container.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function regenerateGame(index) {
    var g = BadmintonGen.generateGame(group(), { excludeFrom: index });
    if (g.error) {
      toast(g.error);
      return;
    }
    group().games[index] = g;
    save();
    renderSession();
    toast('Game ' + (index + 1) + ' regenerated');
  }

  function newSession() {
    if (!group().games.length) {
      toast('Schedule is already empty.');
      return;
    }
    if (!confirm('Clear this schedule and start a fresh session? Players and settings are kept.')) return;
    group().games = [];
    save();
    renderSession();
    toast('New session — adjust who’s here, then Generate.');
  }

  $('#btn-generate').addEventListener('click', generateFullSession);
  $('#btn-generate-2').addEventListener('click', generateFullSession);
  $('#btn-next').addEventListener('click', nextGame);
  $('#btn-newsession').addEventListener('click', newSession);

  // ---------- render: header ----------
  function renderHeader() {
    var g = group();
    var n = presentCount();
    var courts = Math.max(1, planFor(g).length);
    // textContent: group names can come from an untrusted share link.
    $('#header-title').textContent = g.name;
    $('#header-count').textContent = g.games.length + (g.games.length === 1 ? ' game' : ' games');
    $('#header-meta').textContent =
      n + ' present · ' + courts + (courts === 1 ? ' court' : ' courts');
  }

  // ---------- render: session ----------
  function renderSession() {
    var container = $('#games-container');
    var games = group().games;
    container.innerHTML = '';
    $('#session-empty').style.display = games.length ? 'none' : 'block';

    renderHeader();

    games.forEach(function (game, gi) {
      var card = el('div', 'game-card');

      var head = el('div', 'game-head');
      head.appendChild(el('h3', null, 'Game ' + (gi + 1)));
      var regen = el('button', 'regen-link', '↻ Regenerate');
      regen.addEventListener('click', function () {
        regenerateGame(gi);
      });
      head.appendChild(regen);
      card.appendChild(head);

      game.matches.forEach(function (m) {
        var court = el('div', 'court');
        court.appendChild(el('div', 'court-label', 'Court ' + m.court));

        var floor = el('div', 'court-floor');
        // '.solo' centres a lone player instead of leaving them in the left
        // column of the two-up doubles grid.
        var solo = m.teamA.length === 1 ? ' solo' : '';
        var sideA = el('div', 'court-side top' + solo);
        m.teamA.forEach(function (id) {
          sideA.appendChild(el('span', 'pl light', nameOf(id)));
        });
        var net = el('div', 'court-net');
        net.appendChild(el('span', null, 'NET'));
        var sideB = el('div', 'court-side bottom' + (m.teamB.length === 1 ? ' solo' : ''));
        m.teamB.forEach(function (id) {
          sideB.appendChild(el('span', 'pl dark', nameOf(id)));
        });
        floor.appendChild(sideA);
        floor.appendChild(net);
        floor.appendChild(sideB);
        court.appendChild(floor);
        card.appendChild(court);
      });

      if (game.sitOuts && game.sitOuts.length) {
        // Build with DOM nodes (not innerHTML): names can arrive from an
        // untrusted share link, so they must never be interpreted as HTML.
        var so = el('div', 'sit-outs');
        so.appendChild(document.createTextNode('Sitting out: '));
        so.appendChild(el('strong', null, game.sitOuts.map(nameOf).join(', ')));
        card.appendChild(so);
      }
      container.appendChild(card);
    });
  }

  // ---------- render: stats ----------
  function renderStats() {
    var games = group().games;
    var stats = BadmintonGen.deriveStats(games);
    var players = group().players.slice();
    var matrix = stats.partner;

    var wrap1 = $('#stats-players');
    if (!games.length) {
      wrap1.innerHTML = '<p class="muted">No games played yet.</p>';
      $('#stats-matrix').innerHTML = '<p class="muted">No games played yet.</p>';
      return;
    }
    var t1 = el('table', 'stats');
    var hr = el('tr');
    hr.appendChild(thCell('Player', true));
    hr.appendChild(thCell('Games'));
    hr.appendChild(thCell('Sat out'));
    t1.appendChild(hr);
    players.forEach(function (p) {
      var tr = el('tr');
      tr.appendChild(tdName(p.name));
      tr.appendChild(tdCell(stats.gamesPlayed[p.id] || 0));
      tr.appendChild(tdCell(stats.sitOuts[p.id] || 0));
      t1.appendChild(tr);
    });
    wrap1.innerHTML = '';
    wrap1.appendChild(t1);

    var t2 = el('table', 'stats');
    var head = el('tr');
    head.appendChild(thCell('', true));
    players.forEach(function (p) {
      head.appendChild(thCell(initials(p.name)));
    });
    t2.appendChild(head);
    players.forEach(function (rowP) {
      var tr = el('tr');
      tr.appendChild(tdName(rowP.name));
      players.forEach(function (colP) {
        if (rowP.id === colP.id) {
          tr.appendChild(cell('', 'diag'));
          return;
        }
        var rec = matrix[BadmintonGen.pairKey(rowP.id, colP.id)];
        var c = rec ? rec.count : 0;
        tr.appendChild(cell(c || '', 'cell-' + Math.min(c, 2)));
      });
      t2.appendChild(tr);
    });
    var wrap2 = $('#stats-matrix');
    wrap2.innerHTML = '';
    wrap2.appendChild(t2);
  }

  function thCell(text, nameCol) {
    return el('th', nameCol ? 'name-col' : null, text);
  }
  function tdCell(text) {
    return el('td', null, String(text));
  }
  function tdName(text) {
    return el('td', 'name-col', text);
  }
  function cell(text, cls) {
    return el('td', cls, String(text));
  }
  function initials(name) {
    var parts = name.trim().split(/\s+/);
    if (parts.length === 1) return name.slice(0, 3);
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  // ---------- sharing ----------
  // Two backend-free ways to share the active group's roster:
  //   • as formatted text (native share sheet, clipboard fallback)
  //   • as a read-only link that encodes the whole roster in the URL #hash

  function nameFrom(players, id) {
    var p = players.find(function (x) { return x.id === id; });
    return p ? p.name : '?';
  }

  function buildRosterText(g) {
    var lines = ['🏸 ' + g.name + ' — ' + g.games.length + ' game' + (g.games.length === 1 ? '' : 's')];
    g.games.forEach(function (game, gi) {
      lines.push('');
      lines.push('Game ' + (gi + 1));
      game.matches.forEach(function (m) {
        var a = m.teamA.map(function (id) { return nameFrom(g.players, id); }).join(' & ');
        var b = m.teamB.map(function (id) { return nameFrom(g.players, id); }).join(' & ');
        var prefix = game.matches.length > 1 ? '  Court ' + m.court + ': ' : '  ';
        lines.push(prefix + a + '  vs  ' + b);
      });
      if (game.sitOuts && game.sitOuts.length) {
        lines.push('  Sitting out: ' + game.sitOuts.map(function (id) { return nameFrom(g.players, id); }).join(', '));
      }
    });
    return lines.join('\n');
  }

  // utf-8-safe, URL-safe base64 (handles accented names etc.)
  function bytesToB64(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64ToBytes(b64) {
    b64 = b64.replace(/-/g, '+').replace(/_/g, '/');
    var pad = b64.length % 4;
    if (pad) b64 += '===='.slice(pad);
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  function toB64(str) {
    return bytesToB64(new TextEncoder().encode(str));
  }
  function fromB64(b64) {
    return new TextDecoder().decode(b64ToBytes(b64));
  }

  // ----- v1 (legacy) payload -----
  // Kept so links shared before the compact format still open. Only used for
  // encoding as a fallback when the roster is too big for the index alphabet.
  function encodePayload(g) {
    var idx = {};
    g.players.forEach(function (p, i) { idx[p.id] = i; });
    var payload = {
      v: 1,
      n: g.name || '',
      p: g.players.map(function (p) { return [p.name, p.skill, p.present ? 1 : 0]; }),
      c: [g.config.courts, g.config.mode === 'level' ? 'l' : 's'],
      g: (g.games || []).map(function (game) {
        return {
          // teamA then teamB, flattened — 2 entries for a 1v1 court, 4 for a
          // 2v2, so the length tells the decoder which kind of court this is.
          m: game.matches.map(function (m) {
            return m.teamA.concat(m.teamB).map(function (id) { return idx[id]; });
          }),
          s: (game.sitOuts || []).map(function (id) { return idx[id]; }),
        };
      }),
    };
    return toB64(JSON.stringify(payload));
  }
  function decodePayload(b64) {
    var payload = JSON.parse(fromB64(b64));
    if (!payload || !Array.isArray(payload.p)) return null;
    var players = payload.p.map(function (a, i) {
      return { id: 'p' + i, name: String(a[0]), skill: a[1] || 2, present: a[2] !== 0 };
    });
    function byIndex(i) { return players[i] ? players[i].id : players[0].id; }
    var games = (payload.g || []).map(function (game, gi) {
      return {
        index: gi,
        matches: (game.m || []).map(function (m, ci) {
          var half = m.length === 2 ? 1 : 2; // 2 entries -> 1v1, 4 -> 2v2
          return {
            court: ci + 1,
            teamA: m.slice(0, half).map(byIndex),
            teamB: m.slice(half, half * 2).map(byIndex),
          };
        }),
        sitOuts: (game.s || []).map(byIndex),
      };
    });
    return {
      id: '',
      name: payload.n || 'Shared roster',
      config: {
        courts: (payload.c && payload.c[0]) || 2,
        mode: payload.c && payload.c[1] === 'l' ? 'level' : 'spread',
        games: 10,
      },
      players: players,
      games: games,
    };
  }

  // ----- v2/v3 packed payload -----
  // v1 spent most of its bytes on JSON syntax: a single game serialised as
  // {"m":[[0,1,2,3],[4,5,6,7]],"s":[8,9]} — ~40 chars to carry 10 small ints.
  // Here each player index is one character, so a match is 4 chars and a game
  // is ~16. Deflating the result (v3) roughly halves it again; v2 is the same
  // packing left uncompressed for browsers without CompressionStream.
  var IDX = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  // Names are user text and may contain our delimiters, so escape those three.
  function esc(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/\|/g, '\\p').replace(/,/g, '\\c');
  }
  function unesc(s) {
    return s.replace(/\\(.)/g, function (_, c) {
      return c === 'p' ? '|' : c === 'c' ? ',' : c;
    });
  }

  function packPayload(g) {
    var idx = {};
    g.players.forEach(function (p, i) { idx[p.id] = i; });
    function ch(id) { return IDX[idx[id]] || IDX[0]; }

    // skill (1-3) and presence ride together in one character.
    var attrs = g.players.map(function (p) {
      var skill = p.skill >= 1 && p.skill <= 3 ? p.skill : 2;
      return IDX[skill * 2 + (p.present ? 1 : 0)];
    }).join('');

    // A game mixes 2v2 and 1v1 courts, so its match chars are variable-width.
    // Each game therefore leads with one digit per court — '4' or '2', the
    // player count of that court — then ':' and the chars themselves.
    var games = (g.games || []).map(function (game) {
      var sizes = game.matches.map(function (x) {
        return String(x.teamA.length + x.teamB.length);
      }).join('');
      var m = game.matches.map(function (x) {
        return x.teamA.concat(x.teamB).map(ch).join('');
      }).join('');
      return sizes + ':' + m + '.' + (game.sitOuts || []).map(ch).join('');
    }).join(',');

    // Config field: courts, then mode ('l'/'s').
    return [
      esc(g.name || ''),
      String(g.config.courts) + (g.config.mode === 'level' ? 'l' : 's'),
      g.players.map(function (p) { return esc(p.name); }).join(','),
      attrs,
      games,
    ].join('|');
  }

  /*
   * `legacyPer`, when given, is the fixed match width of a pre-mixed-courts
   * link (4 for doubles, 2 for singles) whose games carry no size prefix.
   */
  function unpackPayload(str, legacyPer) {
    var parts = str.split('|');
    if (parts.length < 5) return null;
    var names = parts[2] === '' ? [] : parts[2].split(',');
    var attrs = parts[3];
    var players = names.map(function (n, i) {
      var a = IDX.indexOf(attrs[i]);
      if (a < 0) a = 5; // skill 2, present
      return { id: 'p' + i, name: unesc(n), skill: Math.floor(a / 2), present: a % 2 === 1 };
    });
    if (!players.length) return null;

    function byIndex(c) {
      var i = IDX.indexOf(c);
      return players[i] ? players[i].id : players[0].id;
    }
    var courts = parseInt(parts[1], 10);
    var flags = parts[1].replace(/[0-9]/g, '');
    var games = parts[4] === '' ? [] : parts[4].split(',');

    return {
      id: '',
      name: unesc(parts[0]) || 'Shared roster',
      config: {
        courts: courts >= 1 && courts <= 6 ? courts : 2,
        mode: flags.charAt(0) === 'l' ? 'level' : 'spread',
        games: 10,
      },
      players: players,
      games: games.map(function (chunk, gi) {
        // "<sizes>:<matchchars>.<sitouts>", or "<matchchars>.<sitouts>" on a
        // legacy link, where every court was the same fixed width.
        var colon = chunk.indexOf(':');
        var sizes;
        if (legacyPer && colon < 0) {
          sizes = [];
          var courtCount = Math.floor((chunk.split('.')[0] || '').length / legacyPer);
          for (var k = 0; k < courtCount; k++) sizes.push(legacyPer);
        } else {
          sizes = chunk.slice(0, colon).split('').map(Number);
          chunk = chunk.slice(colon + 1);
        }
        var half = chunk.split('.');
        var m = half[0] || '';
        var matches = [];
        var i = 0;
        sizes.forEach(function (size) {
          if (size !== 2 && size !== 4) return; // ignore anything malformed
          if (i + size > m.length) return;
          matches.push({
            court: matches.length + 1,
            teamA: m.slice(i, i + size / 2).split('').map(byIndex),
            teamB: m.slice(i + size / 2, i + size).split('').map(byIndex),
          });
          i += size;
        });
        return { index: gi, matches: matches, sitOuts: (half[1] || '').split('').map(byIndex) };
      }),
    };
  }

  // deflate-raw via CompressionStream; resolves null where it isn't supported.
  function deflate(bytes) {
    if (typeof CompressionStream === 'undefined') return Promise.resolve(null);
    try {
      var cs = new CompressionStream('deflate-raw');
      var w = cs.writable.getWriter();
      w.write(bytes);
      w.close();
      return new Response(cs.readable).arrayBuffer().then(
        function (buf) { return new Uint8Array(buf); },
        function () { return null; }
      );
    } catch (e) {
      return Promise.resolve(null);
    }
  }
  function inflate(bytes) {
    var ds = new DecompressionStream('deflate-raw');
    var w = ds.writable.getWriter();
    w.write(bytes);
    w.close();
    return new Response(ds.readable).arrayBuffer().then(function (buf) {
      return new TextDecoder().decode(buf);
    });
  }

  // Returns the value that goes after '#s=' — a one-char format marker plus
  // base64. Legacy v1 links are unmarked and always start with 'e' (base64 of
  // '{"v"...'), so a digit marker can never be mistaken for one.
  //   4/5 — packed / deflated, per-court sizes (current)
  //   2/3 — the same, back when a whole schedule was one fixed format
  function encodeShareHash(g) {
    if (g.players.length > IDX.length) {
      return Promise.resolve(encodePayload(g)); // v1: more players than index chars
    }
    var packed = packPayload(g);
    var raw = new TextEncoder().encode(packed);
    return deflate(raw).then(function (z) {
      return z && z.length < raw.length ? '5' + bytesToB64(z) : '4' + bytesToB64(raw);
    });
  }

  // Never throws synchronously — malformed base64 and unsupported formats all
  // surface as a rejected promise for the caller's single error path.
  function decodeShareHash(h) {
    try {
      var marker = h[0];
      if (marker === '4') return Promise.resolve(unpackPayload(fromB64(h.slice(1))));
      if (marker === '5') return inflate(b64ToBytes(h.slice(1))).then(function (s) {
        return unpackPayload(s);
      });
      // Legacy packed links: the fixed match width lives in the config flags.
      function legacyPer(s) {
        return (s.split('|')[1] || '').indexOf('S') >= 0 ? 2 : 4;
      }
      if (marker === '2') {
        var s2 = fromB64(h.slice(1));
        return Promise.resolve(unpackPayload(s2, legacyPer(s2)));
      }
      if (marker === '3') return inflate(b64ToBytes(h.slice(1))).then(function (s) {
        return unpackPayload(s, legacyPer(s));
      });
      return Promise.resolve(decodePayload(h));
    } catch (e) {
      return Promise.reject(e);
    }
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (res, rej) {
      var ta = el('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        res();
      } catch (e) {
        rej(e);
      }
      document.body.removeChild(ta);
    });
  }

  // Encoding the link is async, and Safari revokes the user activation that
  // permits a clipboard write across an await — so hand ClipboardItem the
  // pending promise instead of awaiting it ourselves where that's supported.
  function copyTextAsync(textPromise) {
    if (navigator.clipboard && navigator.clipboard.write && window.ClipboardItem && window.isSecureContext) {
      try {
        var blobP = textPromise.then(function (t) { return new Blob([t], { type: 'text/plain' }); });
        return navigator.clipboard.write([new ClipboardItem({ 'text/plain': blobP })]);
      } catch (e) {
        /* ClipboardItem without promise support — fall through */
      }
    }
    return textPromise.then(copyText);
  }

  function shareRoster() {
    var g = group();
    if (!g.games.length) {
      toast('Generate a session first.');
      return;
    }
    var text = buildRosterText(g);
    if (navigator.share) {
      navigator.share({ title: g.name + ' — badminton', text: text }).catch(function () {
        /* user dismissed the share sheet */
      });
    } else {
      copyText(text).then(
        function () { toast('Roster copied to clipboard'); },
        function () { toast('Could not copy'); }
      );
    }
  }

  function copyLink() {
    var g = group();
    if (!g.games.length) {
      toast('Generate a session first.');
      return;
    }
    var base = location.origin + location.pathname;
    var linkP = encodeShareHash(g).then(function (h) { return base + '#s=' + h; });
    copyTextAsync(linkP).then(
      function () { toast('Link copied — paste it to share'); },
      function () { toast('Could not copy link'); }
    );
  }

  $('#btn-share').addEventListener('click', shareRoster);
  $('#btn-copylink').addEventListener('click', copyLink);

  // ----- viewing a shared link -----
  // A #s= link is loaded as a transient active group WITHOUT persisting, so
  // merely opening someone's link never touches the viewer's saved groups.
  var sharedCtx = { active: false, tempId: null, prevActiveId: null };

  function clearHash() {
    history.replaceState(null, '', location.pathname + location.search);
  }

  function bootShared(hash) {
    return decodeShareHash(hash).catch(function () { return null; }).then(function (g) {
      if (!g || !g.players.length) {
        toast('That shared link looks invalid.');
        clearHash();
        return false;
      }
      return showShared(g);
    });
  }

  function showShared(g) {
    g.id = gid();
    sharedCtx = { active: true, tempId: g.id, prevActiveId: state.activeGroupId };
    state.groups.push(g); // in memory only — not saved
    state.activeGroupId = g.id;
    refreshAll();
    showView('session');
    var banner = $('#share-banner');
    // textContent (not innerHTML): the group name comes from an untrusted URL.
    $('#share-banner .banner-text').textContent = 'Viewing shared roster: ' + g.name;
    banner.removeAttribute('hidden');
    return true;
  }

  $('#btn-save-copy').addEventListener('click', function () {
    if (!sharedCtx.active) return;
    // Disambiguate if the viewer already has a group with this name.
    var g = group();
    if (state.groups.some(function (x) { return x.id !== g.id && x.name === g.name; })) {
      g.name = g.name + ' (shared)';
    }
    save(); // the shared group is already the active in-memory group
    sharedCtx.active = false;
    $('#share-banner').setAttribute('hidden', '');
    clearHash();
    renderGroupSelect();
    toast('Saved as a new group');
  });

  $('#btn-exit-shared').addEventListener('click', function () {
    if (sharedCtx.active) {
      state.groups = state.groups.filter(function (g) { return g.id !== sharedCtx.tempId; });
      var prev = sharedCtx.prevActiveId;
      state.activeGroupId = prev && state.groups.some(function (g) { return g.id === prev; }) ? prev : state.groups[0].id;
      sharedCtx.active = false;
    }
    $('#share-banner').setAttribute('hidden', '');
    clearHash();
    refreshAll();
    showView('setup');
  });

  // ---------- boot ----------
  function refreshAll() {
    var g = group();
    $('#cfg-courts').value = g.config.courts;
    $('#cfg-games').value = g.config.games || 10;
    $('#cfg-mode').value = g.config.mode || 'spread';
    renderGroupSelect();
    renderPlayers();
    renderCapacityHint();
    renderSession();
  }
  function bootNormal() {
    refreshAll();
    save(); // persist the v2 store on first boot (e.g. right after a legacy migration)
  }

  var hash = location.hash || '';
  if (hash.indexOf('#s=') === 0) {
    // Viewing a shared link: rendered read-only, nothing persisted.
    bootShared(hash.slice(3)).then(function (ok) {
      if (!ok) bootNormal();
    });
  } else {
    bootNormal();
  }
})();
