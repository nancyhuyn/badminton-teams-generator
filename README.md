# 🏸 Badminton Team Generator

A phone-friendly, zero-dependency web app that builds fair badminton doubles (2v2)
teams for a casual session. It maximizes partner variety, avoids recent repeats,
rotates sit-outs fairly, and balances skill in one of two modes.

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
  (*present* checkbox), tick anyone back, then **Generate**.
- **A few extra players?** Add them, and remove them afterward with the **✕** next
  to their name to keep your core roster clean.
- **Fresh week?** **New session** clears last week's schedule but keeps the roster and
  everyone's skills.
- **Different crews?** Use **+ New** to keep separate named groups (e.g. "Sunday
  crew", "Work") and switch between them from the Group dropdown.

Older single-session saves are migrated into a "My group" automatically on first load.

## Sharing a roster

From the **Session** tab (no backend, no screenshots needed):

- **📤 Share roster** — sends a clean text version of the schedule to your phone's
  native share sheet (WhatsApp, iMessage, …); on desktop it copies to the clipboard.
  Best for just letting people read their teams.
- **🔗 Copy link** — encodes the whole roster into the link's `#hash` (nothing is sent
  to a server). Whoever opens it sees the schedule read-only under a banner, and can
  **Save a copy** to keep it as their own group or **Exit** to go back to their data.
  Merely opening a shared link never touches the viewer's saved groups.

## How it works

Everything is in three files:

| File | Role |
|------|------|
| `js/generator.js` | Pure team-forming logic (no DOM). Testable in Node. |
| `js/app.js` | UI: state, `localStorage`, rendering the three views. |
| `css/styles.css` | Mobile-first styling, light + dark. |

### The algorithm (`generateGame`)

Given the current session, it produces **one** game:

1. **Sit-outs** — when more players are present than `courts × 4`, the players who
   have sat out *least* so far sit out this game. Evens the burden over the session.
2. **Team forming** — random restarts + a local-search swap pass pick the
   lowest-cost split of the playing players into courts and teams. The cost function
   penalizes, in priority order:
   - **Repeated partnerships** (quadratic; recent repeats hurt more) — the core
     "play with everyone before repeating" rule.
   - **Skill**, per the active mode:
     - *Spread strong (default):* balance the two teams and **never stack two
       Advanced players** on one team → strong players spread across courts, each
       paired with a weaker one.
     - *Level-based:* keep similar levels on the same court → even, competitive games.
   - **Repeated opponents** (mild secondary variety).

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
long-session saturation case, and edge cases (fewer than 4 players, court capping).

## Ideas for later

Cross-session history (remember partnerships across weeks — the data model already
supports it), score tracking, fixed/locked pairs, and multi-device sync.
