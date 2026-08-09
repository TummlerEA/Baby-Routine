# Baby Tracker 👶

A mobile web app for tracking a newborn's three basic needs: **feeds**, **nappies** and **sleep**. It predicts when the next one is due from the typical interval between past entries.

Live version: **https://tummlerea.github.io/Baby-Routine/**

## Features

- Three large one-tap buttons: Feed, Nappy, and Sleep (which toggles to Wake up while your baby is asleep).
- **Predictions** based on the median of the last 5 intervals. Gaps under 10 minutes are discarded, so an accidental double tap in the dark doesn't throw the forecast off. With no data yet it falls back to newborn defaults (feed ~2.5h, nappy ~2h, sleep ~1.5h), marked as an estimate.
- **Active sleep banner** showing how long your baby has been asleep. Past 12 hours it points out that the wake-up was probably never logged.
- **History grouped by day**: the last two days are open, older days collapse into headers you can tap open. Each day header shows that day's feed and nappy counts and total sleep.
- **Sleep durations** are worked out automatically from each "fell asleep → woke up" pair, and sleep crossing midnight is split correctly between the two days. Unpaired entries are flagged.
- **Editing**: tap any entry in the history to open it in the form.
- **Backdated entries** for anything you missed at the time.
- **Undo on delete**: a deleted entry can be restored for seven seconds.
- **Export and backup**: CSV (opens in Excel), Markdown (a readable report) and JSON (a full backup). Restoring from CSV or JSON adds entries to what you have and skips duplicates.
- **Guidance for new parents**: how to read your baby's sleep phases, how to check they're breathing without waking them, the red flags that mean calling 999, and safer sleep basics.
- Editable baby name.
- Dark theme with large touch targets, for one-handed use in the middle of the night.
- Live clock; the screen refreshes the moment you return to the app.

## Built with

Plain HTML, CSS and JavaScript. No frameworks, no build step. All data lives in the browser's `localStorage` — there is no backend and nothing is sent anywhere.

## Running it locally

Open `index.html` in a browser. It works from `file://` exactly as it does when served. No `npm install` required.

## Deployment

Served as static files by GitHub Pages: Settings → Pages → Source: `main` branch, `/ (root)`.

## How data is stored

- `baby-tracker-events` — a JSON array of events: `{ id, type: "feed"|"diaper"|"sleep_start"|"sleep_end", time: ISO-8601 }`.
- `baby-tracker-name` — the baby's name (string).

Nothing leaves the browser. The flip side is that there is only ever one copy: clearing site data or changing phone will destroy it. The "Export & backup" section is there so you can keep a copy and restore from it.

## A note on the guidance

The information in the "For new parents" section follows general NHS and Lullaby Trust advice. It is not medical advice. If you are worried about your baby, contact your midwife, health visitor or GP, call NHS 111, or call 999 in an emergency.

## Licence

MIT — see [LICENSE](LICENSE).
