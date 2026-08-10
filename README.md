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
- **It tells you when it is out of date.** On opening, and when you come back to it (at most every 15 minutes), the app asks the server what version is deployed and offers a green **Update** if that is newer than what is running — so a phone sitting on a cached copy stops being a silent problem. Being offline is not treated as a fault, nothing is shown when the running copy is ahead, and "not now" holds until a later release turns up. Updating never touches the log.
- **The version number, at the foot of the main screen** — so two phones can be compared at a glance when one of them is behaving differently. Tapping it asks for the app again under an address the browser has never seen, which is the reliable way past a cached copy; your log is untouched. The number comes from the cache-busting query on the script itself, so what is on screen is always the version actually loaded.
- **Ask an AI, without one being built in.** An optional button hands a short summary of the log to Claude, ChatGPT or Perplexity — whichever the parent already pays for. There is no API key, no account and no bill attached to this app, and no model runs inside it. You get a question box with a few openers, you choose how much of the log to include, and you see the exact text before anything moves: it goes into the link where it fits and onto the clipboard where it does not. Off by default, and off again the moment you untick it. The prompt tells the assistant to be brief and to send you to a health visitor, GP or NHS 111 rather than guessing — a log of a newborn attracts medical questions, and a model will answer them confidently either way.
- **The summary carries the aggregates an adviser asks for**, not just a list of days: totals and a per-day average for feeds and nappies, average sleep, the typical gap between feeds and between nappies with the shortest and longest either side of it, the longest overnight stretch, the longest single sleep, and — once any are recorded — time spent feeding per day and per feed, saying how many of the feeds that figure actually covers. Gaps are measured inside the period you chose rather than borrowed from the forecast, which answers a different question and would contradict the days listed above it. Averages divide by the days that have entries, so three days of log inside a fortnight is three days. Where a length was never recorded it says so rather than implying zero, and it always states that volume is not recorded at all — an assistant asked how much was taken will otherwise assume the number was simply left out.
- **How long a feed took, in one tap.** Right after logging a feed, the card that already offers the next gap now also asks how long this one took: six lengths from 10 minutes to an hour, tuned to where feeds actually land rather than spread evenly. The everyday answer is marked out — the parent's own recent median, rounded to whichever chip exists, and just 20 minutes until there is a history to draw on — but nothing is recorded until they tap, so the card never puts a length on the entry on their behalf. Tapping the same one again clears it. The manual form offers the same six for a backdated feed, and an entry opened for editing shows the length it already has. It appears on the log row, joins the feed count in each day heading, and rides in the CSV, the Markdown report, the JSON backup and a share link — appended as a new column, so an older link still reads clean.
- **How your baby is fed** — breastfed, formula, mixed, expressed, or prefer not to say. It is the first thing anyone giving advice asks, and it is a standing fact about the baby rather than something to answer at every feed, so it sits in Settings and travels with the name and date of birth across sync, backups and share links.
- **A style for the name.** Settings offers eight ways to set your baby's name on the main screen, from a plain sans to a full greeting-card script with flourishes. Each option is previewed with the actual name, since that is the only preview worth having. They are typefaces your phone already has — nothing is downloaded, which is what keeps the app free of external requests — so only the ones your device can really render are offered, and the choice stays on that device rather than travelling with your entries.
- Dark theme with large touch targets, for one-handed use in the middle of the night.
- Live clock; the screen refreshes the moment you return to the app.

## Built with

Plain HTML, CSS and JavaScript. No frameworks, no build step. All data lives in the browser's `localStorage` — there is no backend and nothing is sent anywhere.

## Running it locally

Open `index.html` in a browser. It works from `file://` exactly as it does when served. No `npm install` required.

## Deployment

Served as static files by GitHub Pages: Settings → Pages → Source: `main` branch, `/ (root)`.

**Releasing.** Bump the `?v=` on both assets in `index.html`, the `version` in `version.json` and the `file://` fallback in `app.js` to the same number, in one commit. The `?v=` is what makes browsers fetch the new files; `version.json` is what makes an already-open copy notice. `test_update.js` and `test_version.js` fail if any of the three disagree, and the version shown on screen is read from the script's own `?v=`, so it can never claim to be something other than what loaded.

## How data is stored

- `baby-tracker-events` — a JSON array of events: `{ id, type, time: ISO-8601, updatedAt, nextMin?, nappy?, fedMin?, value?, deleted? }`. `updatedAt` is when the entry last changed and decides which side wins on merge; `deleted: true` is a tombstone, kept so the deletion can propagate. CSV and Markdown exports omit tombstones; the JSON backup keeps them. `type` is one of `feed`, `diaper`, `sleep_start`, `sleep_end`, `weight`, `height`, `temp`. `nextMin` is the optional one-off gap in minutes until the next event of that type; `nappy` is `"wet"`, `"dirty"`, `"both"` or `"dry"`; `fedMin` is how long a feed took in minutes, absent when nobody answered — never zero; `value` carries the reading for a measurement — grams for weight, cm for length and head circumference, °C for temperature; `label` and `unit` carry the name and unit of a free reading (`type: "other"`).
- `baby-tracker-name` — the baby's name (string).
- `baby-tracker-intervals` — the planned interval per type, in minutes.
- `baby-tracker-dob` — the date of birth as `YYYY-MM-DD`.
- `baby-tracker-feeding` — how the baby is fed: `breast`, `formula`, `mixed`, `expressed`, or absent for "prefer not to say". Part of the settings group, so it syncs and merges by recency like the name and date of birth.
- `baby-tracker-meta-updated` — when the name, date of birth, feeding type or intervals last changed, so settings merge by recency too.
- `baby-tracker-sync` — the private repository and access token, if sync is connected. Deliberately excluded from every export.
- `baby-tracker-name-font` — which typeface the name is set in. A per-device preference, so it is not exported, shared or synced.
- `baby-tracker-ai` — whether the Ask an AI button is shown and whether the summary may carry the baby's name. Per-device and never exported, shared or synced: whether a phone is willing to send anything outwards is that phone's own business, and it must not arrive switched on from elsewhere.

Nothing about the version check is stored: it is a plain request for `version.json` on each open, and no identifier, log content or setting goes with it.

Nothing is uploaded to any server of ours, because there is not one, and nothing is measured or tracked. What can leave the browser leaves only when you send it: sync writes to a private repository you own, a share link travels inside a URL you pass on yourself, and Ask an AI hands a summary to a third party — the one place your data is governed by somebody else's terms — after showing you the exact text. All three are off until you turn them on.

The flip side of a browser-only log is that there is only ever one copy: clearing site data or changing phone will destroy it. The "Export & backup" section is there so you can keep a copy and restore from it.

## A note on the guidance

The information in the "For new parents" section follows general NHS and Lullaby Trust advice. It is not medical advice. If you are worried about your baby, contact your midwife, health visitor or GP, call NHS 111, or call 999 in an emergency.

## Licence

Free and open source software under the **MIT licence** — see [LICENSE](LICENSE).

You may use, copy, modify, merge, publish, distribute, sublicense and sell copies of it, including commercially, provided the copyright notice and the licence text are included. It is provided as is, without warranty of any kind.

Each source file carries an `SPDX-License-Identifier: MIT` header, so the licence stays with the file if only part of the project is reused. The app itself states its licence and links back here from the Help screen.
