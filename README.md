# 🏸 Badminton Team Generator

A phone-friendly, zero-dependency web app that builds fair badminton matchups for a
casual session. It spreads whoever turned up across the courts you have, maximizes
variety, avoids recent repeats, rotates sit-outs fairly, and balances skill in one of
two modes.

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

## How the courts get filled

There's no format to choose. Tell the app how many courts you have, and it spreads
whoever is present across them, using 2v2 or 1v1 on each court as the head count
allows. Two rules, in order:

1. seat as many people as the courts can hold
2. among equally full plans, use as many courts as possible

So **4 players on 2 courts** is two 1v1s — nobody benched to make a single 2v2 — and
**7 on 2 courts** is one 2v2 plus one 1v1, with one person sitting. Add an eighth
player and it becomes two 2v2s on its own.

Everything adapts to whatever mix comes out:

- Partnerships still drive variety on the 2v2 courts; on a 1v1 court **who you face**
  is the variety axis instead, and the generator protects it the same way.
- The 1v1 court is the tiring one, so it rotates: whoever has played the fewest
  singles so far gets it next.
- Both balancing modes still apply — *level-based* keeps similar levels on a court;
  *spread strong* keeps the two sides of each net even and refuses to stack the
  strong players together.

**Odd numbers are fine.** Whoever doesn't fit becomes the sit-out pool, and the
rotation evens it out over the session — 5 players on 2 courts sit one person per
game, and over 5 games each sits exactly once. The capacity line under Session
settings always spells out the split (e.g. *7 present · 2 courts (1 × 2v2, 1 × 1v1) ·
6 playing · 1 sitting out each game*), including when there aren't enough players to
fill the courts you asked for.

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
indices are single characters (a 2v2 court is 4 chars, a 1v1 is 2) and the result is
deflate-compressed before base64. A 16-player, 10-game session comes out around
270 characters of hash instead of ~1,100.

Since one game can mix court sizes, each game leads with one digit per court — `4`
or `2`, that court's player count — then `:` and the index characters, e.g.
`42:ABCDEF.G` for a 2v2 plus a 1v1 with one person sitting out.

The hash carries a one-character format marker:

| Marker | Format |
| --- | --- |
| `5` | packed + deflate-raw (normal case) |
| `4` | packed, uncompressed — browsers without `CompressionStream` |
| `3`, `2` | the same pair, from when a whole schedule was one fixed format |
| none | legacy JSON payload |

Rosters larger than 64 players fall back to the legacy JSON payload, since the index
alphabet is 64 characters wide.

Every older marker still decodes, so links shared before mixed courts keep working.
A `2`/`3` link has no per-court digits: its courts are all one size, given by an `S`
in the config field (`2s` → `2sS`) for 1v1, or no flag at all for 2v2.

## How it works

Everything is in three files:

| File | Role |
|------|------|
| `js/generator.js` | Pure team-forming logic (no DOM). Testable in Node. |
| `js/app.js` | UI: state, `localStorage`, rendering the three views. |
| `css/styles.css` | Mobile-first styling, light + dark. |

### The algorithm (`generateGame`)

Given the current session, it produces **one** game:

1. **Court plan** — `courtPlan` decides each court's size (4 or 2) from the head
   count and the court count, per the two rules above.
2. **Sit-outs** — anyone the plan can't seat sits; the players who have sat out
   *least* so far are chosen, evening the burden over the session.
3. **Team forming** — random restarts + a local-search swap pass pick the
   lowest-cost split of the playing players into courts and teams. Swaps are
   1-for-1, so a mixed plan keeps its shape. The cost function penalizes, in
   priority order:
   - **Repeated partnerships** (quadratic; recent repeats hurt more) — the core
     "play with everyone before repeating" rule, on the 2v2 courts.
   - **Hogging the 1v1 court** — scored from how many singles games each player has
     already had, so the small court rotates.
   - **Skill**, per the active mode:
     - *Spread strong (default):* balance the two teams and **never stack two
       Advanced players** on one team → strong players spread across courts, each
       paired with a weaker one.
     - *Level-based:* keep similar levels on the same court → even, competitive games.
   - **Repeated opponents** — a mild secondary nudge on a 2v2 court. On a 1v1 court
     there are no partnerships to vary, so this carries the weight partnerships
     carry above and becomes the rule that spreads matchups around.

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

Covers: the court plan itself, partnership variety, sit-out fairness, spread vs.
level behavior, the long-session saturation case, mixed 2v2/1v1 games and how the
1v1 court rotates, and edge cases (fewer than 2 players, court capping).

## Ideas for later

Cross-session history (remember partnerships across weeks — the data model already
supports it), score tracking, fixed/locked pairs, and multi-device sync.
