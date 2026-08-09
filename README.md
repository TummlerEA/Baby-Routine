# Baby Tracker 👶

A mobile web app for tracking a newborn's three basic needs: **feeds**, **nappies** and **sleep**. It predicts when the next one is due from the typical interval between past entries.

Live version: **https://tummlerea.github.io/Baby-Routine/**

## Features

- Three large one-tap buttons: Feed, Nappy, and Sleep (which toggles to Wake up while your baby is asleep).
- **What was in the nappy** — wee, poo, both or dry. The entry is saved the instant you tap Nappy, and the question appears in the prompt that follows, so answering it is optional and never stands between you and a one-handed tap in the dark. Day summaries then show the wet and dirty counts a health visitor asks about.
- **Predictions built from your plan, not from averages.** You set how often you intend each thing to happen (3 hours by default for all three) and the forecast follows that from the very first entry, instead of waiting for a pattern to emerge. A single long overnight stretch no longer drags the daytime predictions hours late.
- **A one-off gap for any single entry.** Right after logging something, a prompt offers the planned time and a row of alternatives — tap 8h when you put your baby down for the night, and only that one gap changes. Your everyday plan stays put.
- **Plan versus reality.** Each prediction shows the plan it is based on, and says "actually averaging 4h 30m" when the real routine has drifted meaningfully away from it (median of the last 5 gaps, ignoring anything under 10 minutes so an accidental double tap can't skew it).
- **Active sleep banner** showing how long your baby has been asleep. Past 12 hours it points out that the wake-up was probably never logged.
- **History grouped by day**: the last two days are open, older days collapse into headers you can tap open. Each day header shows that day's feed and nappy counts and total sleep.
- **Sleep durations** are worked out automatically from each "fell asleep → woke up" pair, and sleep crossing midnight is split correctly between the two days. Unpaired entries are flagged.
- **Editing**: tap any entry in the history to open it in the form.
- **Backdated entries** for anything you missed at the time.
- **Undo on delete**: a deleted entry can be restored for seven seconds.
- **Export and backup**: CSV (opens in Excel), Markdown (a readable report) and JSON (a full backup). Restoring from CSV or JSON adds entries to what you have and skips duplicates.
- **Guidance for new parents**: how to read your baby's sleep phases, how to check they're breathing without waking them, the red flags that mean calling 999, and safer sleep basics.
- **A separate Settings screen**, reached by the gear in the top bar, holding the baby's name, the planned intervals and export/backup — so the main screen stays down to what you actually tap at 3am.
- Dark theme with large touch targets, for one-handed use in the middle of the night.
- Live clock; the screen refreshes the moment you return to the app.

## Built with

Plain HTML, CSS and JavaScript. No frameworks, no build step. All data lives in the browser's `localStorage` — there is no backend and nothing is sent anywhere.

## Running it locally

Open `index.html` in a browser. It works from `file://` exactly as it does when served. No `npm install` required.

## Deployment

Served as static files by GitHub Pages: Settings → Pages → Source: `main` branch, `/ (root)`.

## How data is stored

- `baby-tracker-events` — a JSON array of events: `{ id, type: "feed"|"diaper"|"sleep_start"|"sleep_end", time: ISO-8601, nextMin?, nappy? }`. `nextMin` is the optional one-off gap in minutes until the next event of that type; `nappy` is `"wet"`, `"dirty"`, `"both"` or `"dry"` and only appears on nappy changes.
- `baby-tracker-name` — the baby's name (string).
- `baby-tracker-intervals` — the planned interval per type, in minutes.

Nothing leaves the browser. The flip side is that there is only ever one copy: clearing site data or changing phone will destroy it. The "Export & backup" section is there so you can keep a copy and restore from it.

## A note on the guidance

The information in the "For new parents" section follows general NHS and Lullaby Trust advice. It is not medical advice. If you are worried about your baby, contact your midwife, health visitor or GP, call NHS 111, or call 999 in an emergency.

## Licence

MIT — see [LICENSE](LICENSE).
