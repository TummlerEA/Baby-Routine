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
- **Export and backup**: CSV (opens in Excel), Markdown (a readable report) and JSON (a full backup).
- **Automatic sync between phones**, through a **private** GitHub repository holding one JSON file. No server of ours: the app talks to the GitHub Contents API directly. It syncs on open, on return, roughly once a minute while on screen, and shortly after anything you log, batching a burst of taps into one commit. Concurrent writes are safe — a stale-sha conflict is retried after re-merging, and because merging is order-independent nothing is lost either way. The access token is stored on the device that typed it and never appears in a backup, a report or a share link.
- **Pasting a link, for Home Screen users.** On iOS a web app added to the Home Screen keeps its data entirely separately from Safari, and a tapped link always opens in Safari — never in the installed app. So Settings takes a pasted share link: copy the link out of the chat instead of tapping it, and the entries land where you actually work. A link already opened in Safari offers a button that copies it ready for pasting.
- **Inviting a partner.** One button produces a message with the app's address and a short explanation of how the two of you will swap entries — worth sending before any data, since it also asks them to open it in Safari and add it to their Home Screen. Your baby's name, date of birth and planned intervals travel across with the first batch of entries, so nobody retypes them.
- **Share links for a partner.** Settings makes a link carrying your recent entries — a day, two days, a week, or everything. The data rides in the URL fragment, so it is never uploaded anywhere and the hosting server never sees it. Opening the link on another phone offers to merge it rather than doing so silently, and because merging is order-independent it works in both directions: send one back after your shift and both logs agree. A two-day link is about 1.6 KB; the app warns when a period is long enough that messaging apps might mangle it.
- **Merging, not replacing.** Every entry records when it last changed, and deleting leaves a tombstone rather than dropping the row. A tombstone carries only the id, type and time — never the reading, the nappy detail or the one-off gap — and every device discards it once it is 30 days old, by the same deterministic rule, so none of them push it back at each other. Restoring a file therefore merges correctly in any order: the newer version of an entry wins, deletions travel with it, and importing an out-of-date file cannot resurrect something deleted or undo a newer edit. That makes passing a JSON file between two phones a workable way to share a log, and lays the groundwork for real sync later.
- **Measurements** — weight, length, head circumference and temperature, tucked behind a collapsible section rather than a button, since they are not something you log half-asleep. Plus **anything else you are handed a number for**: name it and give it a unit once and it is offered back next time, so a bilirubin result or a bottle volume builds its own history. Free readings are recorded and displayed only — never interpreted, since an arbitrary test has no general safe range. Weight shows in kg and in lb/oz, with the change since the last reading and the percentage of birth weight. No centile charts: those live in your red book, which is what your health visitor plots.
- **Temperature is treated as a safety matter.** A reading at or above the threshold for your baby's age raises an alert on entry and a banner on the main screen while it is recent, repeating the NHS routing the app already carries: 999 for a baby under 3 months at 38°C or above, NHS 111 otherwise. A reading below 36°C is flagged too.
- **Date of birth** in Settings, used for your baby's age, weight change since birth, and picking the right temperature threshold.
- **A Help screen** behind the ℹ️ in the top bar, covering how the app works: what one tap does, what the card after it is for, where predictions come from, how to correct a mistake, and — prominently — that the data lives only in this browser and wants backing up. It also explains adding the app to your home screen.
- **A getting-started card** for a brand new user, shown under the buttons while there is nothing logged and gone the moment there is.
- **Guidance for new parents**, on the same Help screen: how to read your baby's sleep phases, how to check they're breathing without waking them, the red flags that mean calling 999, and safer sleep basics.
- **A separate Settings screen**, reached by the gear in the top bar, holding the baby's name, date of birth, the planned intervals and export/backup — so the main screen stays down to what you actually tap at 3am.
- Dark theme with large touch targets, for one-handed use in the middle of the night.
- Live clock; the screen refreshes the moment you return to the app.

## Built with

Plain HTML, CSS and JavaScript. No frameworks, no build step. All data lives in the browser's `localStorage` — there is no backend and nothing is sent anywhere.

## Running it locally

Open `index.html` in a browser. It works from `file://` exactly as it does when served. No `npm install` required.

## Deployment

Served as static files by GitHub Pages: Settings → Pages → Source: `main` branch, `/ (root)`.

## How data is stored

- `baby-tracker-events` — a JSON array of events: `{ id, type, time: ISO-8601, updatedAt, nextMin?, nappy?, value?, deleted? }`. `updatedAt` is when the entry last changed and decides which side wins on merge; `deleted: true` is a tombstone, kept so the deletion can propagate. CSV and Markdown exports omit tombstones; the JSON backup keeps them. `type` is one of `feed`, `diaper`, `sleep_start`, `sleep_end`, `weight`, `height`, `temp`. `nextMin` is the optional one-off gap in minutes until the next event of that type; `nappy` is `"wet"`, `"dirty"`, `"both"` or `"dry"`; `value` carries the reading for a measurement — grams for weight, cm for length and head circumference, °C for temperature; `label` and `unit` carry the name and unit of a free reading (`type: "other"`).
- `baby-tracker-name` — the baby's name (string).
- `baby-tracker-intervals` — the planned interval per type, in minutes.
- `baby-tracker-dob` — the date of birth as `YYYY-MM-DD`.
- `baby-tracker-meta-updated` — when the name, date of birth or intervals last changed, so settings merge by recency too.
- `baby-tracker-sync` — the private repository and access token, if sync is connected. Deliberately excluded from every export.

Nothing leaves the browser. The flip side is that there is only ever one copy: clearing site data or changing phone will destroy it. The "Export & backup" section is there so you can keep a copy and restore from it.

## A note on the guidance

The information in the "For new parents" section follows general NHS and Lullaby Trust advice. It is not medical advice. If you are worried about your baby, contact your midwife, health visitor or GP, call NHS 111, or call 999 in an emergency.

## Licence

Free and open source software under the **MIT licence** — see [LICENSE](LICENSE).

You may use, copy, modify, merge, publish, distribute, sublicense and sell copies of it, including commercially, provided the copyright notice and the licence text are included. It is provided as is, without warranty of any kind.

Each source file carries an `SPDX-License-Identifier: MIT` header, so the licence stays with the file if only part of the project is reused. The app itself states its licence and links back here from the Help screen.
