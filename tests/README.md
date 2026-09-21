# Checks

236 checks over the app, in a browser, driven by Playwright.

```
cd tests && npm install      # once, if Playwright is not already about
node tests/run.js            # everything, UTC and Pacific/Auckland
```

Run a subset while working on something:

```
node tests/run.js leaps      # only files whose name matches
node tests/run.js --tz UTC   # one timezone
node tests/test_version.js   # one file, directly
```

A passing check prints nothing. A run prints one line per file, and a failure
prints the checks that failed underneath it.

## This is the only dependency in the project

The app is four files — `index.html`, `app.js`, `style.css`, `sw.js` — of
plain HTML, CSS and JavaScript, with no framework, no build step and nothing
fetched at runtime. That does not change. Playwright is installed for these
checks alone: nothing under `tests/` is served by GitHub Pages, referenced by
`index.html`, or reachable from the app in any way. Delete the folder and the
app is untouched.

`tests/helpers.js` looks for Playwright in `tests/node_modules` first, then in
the usual global places, then wherever `PLAYWRIGHT_PATH` says. It uses a
browser already on the machine if it finds one, and Playwright's own download
otherwise.

## The app is opened as `file://`

No server, no port, nothing to start. That is also one of the two ways the app
has to work, so testing it this way tests something real. The one consequence:
the service worker does not register on `file://`, so anything about offline
behaviour has to be tested over http.

## Two timezones

Almost every bug this app has had was a date bug, and a date bug hides
perfectly in the zone its author happens to be in. Pacific/Auckland is the
useful opposite of UTC — far enough ahead that "today" there is usually
tomorrow here, which is what breaks a naive day boundary.

## The clock is pinned

Anything about a night, an age or a band of weeks uses
`page.clock.install({ time })` rather than whatever time the suite happens to
run at. There is a trap worth knowing: `new Date('2026-09-08T07:49:00')` is
parsed in **node's** timezone, not the page's. Give the context an explicit
`timezoneId` and write the time with a `Z` on the end, or the pinned clock is
an hour out and every assertion quietly shifts with it.

## What is here

| File | Checks | What it is about |
|---|---|---|
| `test_version.js` | 6 | The release number in its five places, and that the worker caches the shell under the names the page asks for. No browser; runs in milliseconds. |
| `test_smoke.js` | 42 | Log one of everything, open and close every screen, check the shape of the top line and the depth of the buttons, insist the console stayed silent. Knows almost nothing, catches almost everything. |
| `test_journal.js` | 91 | The diary: the form filling itself from what is stored, a second save editing in place rather than adding a day, clearing a rating and clearing a day, filling in a day that had no entry from the date field and from the strip, a day in the future refused, editing an older day and cancelling out of it, the save button naming the day it writes to, moving an entry to another day as one record rather than two, backing out of a move, a move onto a taken day refused, and the feed still navigating past a half-typed draft, the good/hard tallies at two window widths, the notes for a specialist, what the import refuses, the switch that keeps the diary out of the AI summary, and that the screen carries no language switch. |
| `test_milk.js` | 46 | The freezer ledger: the balance walked forward through a made-up fortnight, a stocktake wiping what came before it, a stocktake of nothing, a negative balance named rather than clamped, both charts' bar counts, every button, what the form refuses, what the import refuses, the two lines that reach the AI summary, and that the screen carries no language switch. |
| `test_leaps.js` | 117 | The leaps chart: every banner state day by day, the rule that keeps it quiet mid-band, both empty states, markers and bands per row, and that nothing is written to storage. |
| `test_leap_sleep.js` | 25 | The chart checked against the log: agreeing, disagreeing, off-chart drops, both thresholds from both sides, and two traps — unlogged days must not read as a drop, and a shorter night must not move a daytime figure. |
| `test_nights_window.js` | 28 | The nights section of Statistics: the window the chips promise, and the night just gone appearing in the morning. |
| `test_manual_step.js` | 22 | The manual form's five-minute grid, and everything it could have broken — off-grid entries, a time nobody meant to change, the future guard, and the order two sleep entries end up in. |

## Writing another one

Start from `helpers.js`: it hands you `APP` (the `file://` url), `launch()`,
`source(name)` for reading an app file as text, and `tally()` for counting.
Keep a check's name a sentence about the app rather than about the code, so a
failure reads as a description of what is now wrong.

Two habits worth keeping. Seed state through `localStorage` and reload, rather
than clicking a fixture into existence — it is faster and it does not fail for
reasons unrelated to what is being tested. And when a check fails because your
expectation was wrong rather than the app's behaviour, fix the check and say
so, out loud, rather than quietly adjusting the app to agree with the test.
