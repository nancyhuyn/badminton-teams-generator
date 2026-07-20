# 🏸 Badminton Team Generator

A phone-friendly, zero-dependency web app that builds fair badminton matchups for a
casual session — **doubles (2v2)** or **singles (1v1)**. It maximizes variety, avoids
recent repeats, rotates sit-outs fairly, and balances skill in one of two modes.

## Running it

It's a static site — no build step, no server required for real browsers.

- **Simplest:** open `index.html` in Safari or Chrome.
- **Via a local server** (needed for some browsers' stricter file:// rules):

  ```sh
  python3 -m http.server 8000
  # then visit http://localhost:8000
  ```

- **Deploy:** it's fully static, so it drops straight onto GitHub Pages / Netlify.

State is saved in the browser via `localStorage`, so it survives a refresh.

## Reusing your group week to week

The app is built around **groups** — saved rosters you play with repeatedly. Each
group keeps its own players, skill levels, settings, and current schedule, so you set
a group up once and reuse it:

- **Same crew, minor changes?** Open the app, untick anyone who didn't show
  (*playing* checkbox), tick anyone back, then **Generate**.
- **A few extra players?** Add them, and remove them afterward with the **✕** next
  to their name to keep your core roster clean.
- **Fresh week?** **New session** clears last week's schedule but keeps the roster and
  everyone's skills.
- **Different crews?** Use **+ New** to keep separate named groups (e.g. "Sunday
  crew", "Work") and switch between them from the Group dropdown.

Older single-session saves are migrated into a "My group" automatically on first load.

## Doubles or singles

**Session settings → Format** switches the whole schedule between doubles (2v2) and
singles (1v1). A court then holds 2 players instead of 4, so the same room runs twice
as many courts — and a session needs only 2 players instead of 4.

Everything else adapts to match:

- Singles has no partnerships, so **who you face** becomes the variety axis the
  generator protects: it plays you against everyone once before repeating anyone.
- Stats swaps the Partnership matrix for a **Matchup matrix** (same read: aim for an
  even, mostly-1 grid).
- Both balancing modes still apply — *level-based* matches you against someone of
  your level; *spread strong* keeps the two sides of each net even.

A schedule is one format throughout, since partnership history and matchup history
aren't interchangeable. Switching format therefore clears the current schedule
(it asks first); players, skills, and settings are kept.

**Odd numbers are fine in either format.** Whatever doesn't divide into full courts
becomes the sit-out pool, and the rotation evens it out over the session — 5 players
on 2 singles courts sit one person per game, and over 5 games each sits exactly once.
The capacity line under Session settings always spells out the split (e.g.
*7 players · 1 court · 4 playing · 3 sitting out each game*), including when there
aren't enough players to fill the courts you asked for.

## Sharing a roster

From the **Session** tab (no backend, no screenshots needed):

- **📤 Share roster** — sends a clean text version of the schedule to your phone's
  native share sheet (WhatsApp, iMessage, …); on desktop it copies to the clipboard.
  Best for just letting people read their teams.
- **🔗 Copy link** — encodes the whole roster into the link's `#hash` (nothing is sent
  to a server). Whoever opens it sees the schedule read-only under a banner, and can
  **Save a copy** to keep it as their own group or **Exit** to go back to their data.
  Merely opening a shared link never touches the viewer's saved groups.

### Link format

Because the roster travels in the URL itself, the hash is packed hard: player
indices are single characters (a match is 4 chars, a game ~16) and the result is
deflate-compressed before base64. A 16-player, 10-game session comes out around
270 characters of hash instead of ~1,100.

The hash carries a one-character format marker:

| Marker | Format |
| --- | --- |
| `3` | packed + deflate-raw (normal case) |
| `2` | packed, uncompressed — browsers without `CompressionStream` |
| none | legacy JSON payload; still decoded so old links keep working |

Rosters larger than 64 players fall back to the legacy format, since the index
alphabet is 64 characters wide.

Singles links append an `S` to the config field (`2s` → `2sS`), which tells the
decoder a match is 2 characters rather than 4. Links made before singles existed
simply lack it and decode as doubles, so they keep working unchanged.

## How it works

Everything is in three files:

| File | Role |
|------|------|
| `js/generator.js` | Pure team-forming logic (no DOM). Testable in Node. |
| `js/app.js` | UI: state, `localStorage`, rendering the three views. |
| `css/styles.css` | Mobile-first styling, light + dark. |

### The algorithm (`generateGame`)

Given the current session, it produces **one** game:

1. **Sit-outs** — when more players are present than `courts × 4` (or `courts × 2` in
   singles), the players who have sat out *least* so far sit out this game. Evens the
   burden over the session.
2. **Team forming** — random restarts + a local-search swap pass pick the
   lowest-cost split of the playing players into courts and teams. The cost function
   penalizes, in priority order:
   - **Repeated partnerships** (quadratic; recent repeats hurt more) — the core
     "play with everyone before repeating" rule. Doubles only.
   - **Skill**, per the active mode:
     - *Spread strong (default):* balance the two teams and **never stack two
       Advanced players** on one team → strong players spread across courts, each
       paired with a weaker one.
     - *Level-based:* keep similar levels on the same court → even, competitive games.
   - **Repeated opponents** — a mild secondary nudge in doubles. In singles there are
     no partnerships to vary, so this carries the weight partnerships carry above and
     becomes the rule that spreads matchups around.

The same function powers "Generate full session" (called N times), "Next game", and
"Regenerate this game".

### Known trade-off

With very lopsided groups over a long session (e.g. 4 Advanced + 8 Beginners, 10+
games), a strong player runs out of distinct weaker partners. Spread mode then
**reuses a weak partnership rather than stacking two strong players** — keeping teams
balanced is treated as the higher priority. You'll see this as a few repeated pairings
late in the schedule (visible in the Stats → Partnership matrix).

## Tests

Pure-logic tests, no dependencies:

```sh
node test/generator.test.js
```

Covers: partnership variety, sit-out fairness, spread vs. level behavior, the
long-session saturation case, singles matchup variety and level matching, and edge
cases (too few players for the format, court capping).

## Ideas for later

Cross-session history (remember partnerships across weeks — the data model already
supports it), score tracking, fixed/locked pairs, and multi-device sync.
