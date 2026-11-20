# Spoken diary + advisor — working plan (v136)

**Status:** B1 done (diary chat created). Next: the user does A1; the diary chat does B2–B4; then the app part (C) after the user confirms D2. Tick boxes as you go and commit this file with the work.
**Branch:** `claude/baby-tracker-app-96guwg`. While this plan is open, do not reset the branch from main; merge main in instead.
**Talk to the user** in Russian, short and plain. App UI stays in UK English. The diary itself is in Russian: that is the family's own setting, not the app's.
**Never** put the private repo's name, or anyone's name, in this file or in the public repo. Call it "the private sync repo".

## Resuming after a context compaction

1. Read this file. The ticked boxes show where work stopped.
2. The diary chat is a separate Claude Code session on the private sync repo, titled "Дневник". Its rules live in that repo's `CLAUDE.md`, which is the contract between that chat and the app.
3. Carry on with the first unticked step. Do not redesign anything: the decisions below are agreed with the user.

## What it is

The parents dictate short notes through the day: how she woke, her mood, how settling went, crying, eating. The notes land as Markdown in the private sync repo. Each day gets its own file, and a day runs from one **morning wake** to the next.

A dedicated Claude Code chat on that repo:
- writes the user's own dictated notes into the repo;
- folds the notes into the day files;
- gives advice **when asked**, against goals the user sets (sleep first), using the app's exact event log plus the diary text;
- as a trial, sets bedtime reminders in a shared Google Calendar.

The other parent has no Claude account and writes through the **app**. The user writes through both the app and the chat.

## Settled decisions

| # | Decision |
|---|----------|
| D1 | Same private sync repo, folder `journal/`. The app's existing files (`baby-tracker-log.json`, `archive/`, `voice-queue/`) are never touched by the chat. |
| D2 | Notes are **not** stored in `baby-tracker-log.json`. They are also kept out of the JSON backup export, share links and the "Ask an AI" prompt. Notes live on GitHub as Markdown. (The user said "не надо в JSON выгрузку". Confirm with them that this covers both the sync file and the backup export; it is assumed here.) |
| D3 | **One file per note**, so two phones and the chat never write the same file. Claude never rewrites a note file: it is the verbatim record. |
| D4 | A **day file** per baby-day is derived from the notes plus the app's log. It holds a rewritten **Сводка** (summary), the verbatim **Записи** (time, author, text), and **Цифры** (numbers from the app). It is rebuilt by the chat, never by the app. |
| D5 | **Day boundary:** a baby-day starts at the morning wake, the first `sleep_end` between 04:00 and 11:00 local that ends a sleep begun inside the night window. A note before that wake belongs to the previous day. If no such wake is logged, the boundary is 06:00. The app and the chat use the same rule. |
| D6 | **Author:** each phone has a local "Who's using this phone" name. It is stored on that phone only: not synced, not exported. Every note carries it. Chat notes carry the user's name and `source: chat`. |
| D7 | Advice only **when asked**, for now. |
| D8 | **Reminders, trial:** a dedicated Google Calendar the user creates and shares with the other parent. Event at **bedtime − 10 min**: "🌙 Через 10 минут — спать: начинайте пеленать / укачивать". The alert fires at the event's start. |
| D9 | Notes go to GitHub **only through sync**. Without sync connected, notes stay on the phone, and the screen says so. |

## Note file format (the contract between the app and the chat)

Path: `journal/notes/YYYY/MM/<YYYYMMDDTHHMMSSZ>__<author-slug>__<id>.md`, where the timestamp is the note's `at` in UTC.

```markdown
---
id: 3f9c2b7a-...
author: Женя
at: 2026-11-20T07:10:00Z
updated: 2026-11-20T07:12:31Z
source: app            # or chat
---
Проснулась в хорошем настроении, улыбается.
```

- An **edit** is a PUT of the same path with its sha, plus a new `updated` timestamp.
- A **delete** is a DELETE of the file.
- `author-slug` is the author name transliterated to `[a-z0-9-]`, or `anon`.
- The app reads the author from the front matter, not from the slug.

## Day file format (written by the chat only)

Path: `journal/days/YYYY/YYYY-MM-DD.md`, where the date is the date of that morning wake.

```markdown
# 20 ноября 2026, пятница
_Проснулась в 07:10 · день до следующего утреннего пробуждения_

## Сводка
(Rewritten on every update: mood, naps, settling, crying, feeding, anything notable.)

## Записи
- 07:10 · Женя — Проснулась в хорошем настроении, улыбается.
- 13:40 · (other parent) — Долго укладывали, минут 40.

## Цифры (из приложения)
Сон днём 3 ч 10 мин в 4 снах · ночью … · бодрствования: 1:20, 1:35, … · кормлений 8 …
```

## Private repo layout

```
CLAUDE.md                       rules for the diary chat (see below)
journal/notes/YYYY/MM/*.md      one file per note: verbatim, written by the app or the chat
journal/days/YYYY/YYYY-MM-DD.md day files, rebuilt by the chat
goals.md                        current goals with start dates, e.g. «ночной сон: дольше 4 ч подряд»
insights.md                     what has been learnt: what helps her settle, what doesn't
tasks.md                        reminders set, and their outcomes
tools/analyze.py                reads baby-tracker-log.json + archive/ → day stats, wake windows, next sleep due
```

## What `CLAUDE.md` in the private repo must say

- **Who it is:** a diary keeper and sleep advisor for this family. Russian only.
- **Each dictated message:**
  - write a note file (`source: chat`, author = the user's name);
  - update the day file;
  - reply in one line confirming it.
- **On request "собери день" / at any update:** rebuild the day file from all notes for that day, plus `tools/analyze.py`.
- **Advice when asked:**
  - run `tools/analyze.py`, and read the last 7 day files, `goals.md` and `insights.md`;
  - answer with what to expect today, what to do and when, and why, using her own numbers;
  - say plainly when the data is thin;
  - it is not medical advice: anything worrying goes to the health visitor or GP.
- **Reminders:** create the event in the shared calendar via the Google Calendar connector, with the wording from D8. Never spam: one event per expected sleep, and update it rather than adding a second.
- **Never** edit `baby-tracker-log.json`, `archive/` or `voice-queue/`.
- **Never** print or ask for tokens.
- **Commit messages:** «Дневник: …».

## Steps

### Part A — the user, by hand
- [ ] A1. Create a Google Calendar named after the baby:
  - calendar.google.com → Other calendars → ＋ → Create new calendar;
  - share it with the other parent, choosing "Make changes to events";
  - on both phones, make sure its notifications are on: Google Calendar app → Settings → that calendar → notifications.
- [ ] A2. After v136, on each phone: Settings → **Who's using this phone** → type the name.
- [ ] A3. Optional, later: a Claude account for the other parent. Not needed, because she writes through the app.

### Part B — the diary chat (a separate session on the private repo)
- [x] B1. Create the session, titled «Дневник», with a setup prompt carrying this plan's formats.
- [ ] B2. In that session, write `CLAUDE.md`, `goals.md`, `insights.md` and `tasks.md`, and the empty `journal/` tree.
- [ ] B3. In that session, write `tools/analyze.py` (stdlib only). It must:
  - read the live file plus every `archive/events-*.json`, merged by id with the newest `updatedAt` winning, ignoring tombstones;
  - print, for a given day: sleeps, wake windows, feeds and nappies;
  - estimate the next sleep due as her median awake stretch at this time of day over 7 days.
- [ ] B4. Trial dictation: the user sends a note, and a note file plus a day file appear.
- [ ] B5. Once A1 is done: in that session, a scheduled task fires hourly from 07:00 to 20:00 London time, in a fresh session on that repo. Each run:
  - runs `analyze.py`;
  - if the baby is awake and the next sleep is due within 75 minutes, creates or updates the calendar event at due − 10 min.

  Run it as a one-week trial, then ask the user whether to keep it.

### Part C — the app (v136), in this repo
- [ ] C1. Settings: **Who's using this phone**, a local-only key `baby-tracker-author`. Excluded from sync, backup, share and AI.
- [ ] C2. Diary screen: a **Notes** section at the top.
  - A text box: the keyboard's 🎤 dictation works. Reuse the app's own voice button if it fits.
  - Save, with Undo.
  - The current baby-day's notes from both parents, shown as time · author · text, newest last.
  - Tap your own note to edit or delete it. Notes by the other parent are read-only.
  - A day picker, so earlier days can be read.
- [ ] C3. Local store: `baby-tracker-notes` as `[{id, author, at, updated, text, deleted?, sha?, path?, pending?}]`.
  - A note is shown at once and marked pending until it is pushed.
- [ ] C4. Sync, riding the existing `syncNow`. The live JSON is untouched.
  - **Push:** PUT each pending note, as new or with its sha; DELETE each pending deletion.
  - **Pull:** list `journal/notes/<this month>` and `<last month>`, cached by the folder sha the way the archive is. Download files whose sha is unknown (small), then parse the front matter.
  - **Conflicts:** 409 or 422 re-reads the file and retries. The other parent's edits win for their own notes.
  - The listing piggybacks on the root listing's `journal` tree sha, so there are no extra requests when nothing changed.
- [ ] C5. Keep notes out of `localDocument()`, the JSON export, share links and the AI prompt. Add tests asserting each.
- [ ] C6. Day grouping uses rule D5. Put it in a helper `babyDayOf(time)` and test it across midnight and with no wake logged.
- [ ] C7. README, plus a help topic (EN/RU): "Notes for the diary".
- [ ] C8. `tests/test_notes.js`, extending the fake GitHub from `test_archive.js`:
  - two phones with two authors;
  - add, edit and delete;
  - offline then online;
  - a note at 02:00 belongs to the previous day;
  - notes absent from the live JSON and the export;
  - no requests when the folder sha is unchanged.
- [ ] C9. Bump to v136, run the full suite (61 runs expected), open a PR, squash-merge.
- [ ] C10. Tell the user, in Russian: how to set the author on each phone, where Notes are, and that the diary chat folds the notes into days.
- [ ] C11. Delete this plan file in the final PR (or the next one).

### Later, only if the user asks
- An author on ordinary events (feed, nappy, sleep): an optional `by` field. It needs a `normaliseImported` change.
- Advice pushed proactively, such as a morning plan.

## Risks and notes

- **Cost and noise:** the hourly reminder task is 14 fresh sessions a day. That is why it is a trial.
- **Calendar alerts** depend on the phone's calendar notification settings. Check them with a test event first.
- **The connector:** if the Google Calendar connector is not available in the diary session, say so plainly. The reminder trial is then blocked; nothing else is.
- **Privacy:** notes go to GitHub through the existing opt-in sync route, and to Anthropic only inside the diary chat the user runs. Nothing goes to a new place.
