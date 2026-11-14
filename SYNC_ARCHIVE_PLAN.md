# Sync archive — working plan (v133)

**Status:** IN PROGRESS. Tick the boxes as you go and commit this file along with the code it describes.
**Branch:** `claude/baby-tracker-app-96guwg`. While this plan is open, **do not** reset the branch from `origin/main`. If main moves, merge it in.
**Talk to the user** in Russian, short and plain. All app text stays in UK English.

## How to resume after a context compaction

1. `cd /home/user/Baby-Routine && git status && git log --oneline -5`
2. Read this file top to bottom. The ticked boxes in "Steps" show where work stopped.
3. Run `node tests/run.js sync` and `node tests/run.js archive`. They take seconds and show what currently works.
4. Carry on with the first unticked step. Do not redesign anything: the decisions below are settled with the user.

## Why

Today every sync uploads the **whole** log. At about 3,000 entries that is about 0.6 MB, sent base64 as about 0.8 MB, on every tap, and it grows by roughly 50 entries a day. Moving the settled past into monthly archive files, which rarely change, cuts each tap to about 10–30 KB. It also shortens the window in which two phones collide.

v132 already made big logs **correct**. Files over 1 MB are read through the git blob API, an unreadable file is never overwritten, requests time out, and a frozen sync is abandoned. This plan is about **speed and data use**. Correctness must not regress.

## Settled decisions (agreed with the user)

| # | Decision |
|---|----------|
| D1 | Only `events` are archived. `meta`, `plans`, `shopping`, `rotaShifts`, `milk` and `journal` stay in the live file, unchanged. They are small. A later generalisation is possible, but it is out of scope. |
| D2 | Archive files are grouped by the **month of the event's `time`**, taken as the UTC calendar month: `time.slice(0, 7)`, for example `2026-10`. Every entry has exactly one home, and that grouping is the same on every phone and in every timezone. |
| D3 | An entry leaves the live file once its **`updatedAt`** (falling back to `time`, see `updatedAtOf`) is older than `HOT_DAYS = 14` days. The age is measured by last change, not by event time. That way an edit or delete of an old entry goes into the live file, wins by `updatedAt`, and is folded into its month's archive 14+ days later. |
| D4 | Archive files are not strictly immutable. They are rewritten **rarely**: on a fold that touches that month. Every write uses the sha, so a conflict re-reads, re-merges and retries. |
| D5 | Nothing is left out of the live file unless this phone has **seen the same or a newer version of it in an archive file**, checked against the archive index (see I1). Being "old" is never on its own a reason to leave something out. |
| D6 | The live document's format goes 4 → **5** once it omits anything, meaning archives exist and this phone has a complete index. A v132 phone meeting format 5 is locked by the existing `DOC_FORMAT` check ("This phone is behind the log…"). It neither reads nor writes, and its own entries wait safely. **All phones must update to v133.** |
| D7 | The local copy keeps the **full** history in localStorage, exactly as today. Stats, the pattern chart, exports, share links and the AI prompt are untouched. |
| D8 | The archive index is kept in **IndexedDB**, falling back to memory for the session when IndexedDB is unavailable. It is never put in localStorage, which is near its limit at about 5 MB. |
| D9 | A fold happens only when the live file holds entries whose `updatedAt` is older than `HOT_DAYS + FOLD_SLACK_DAYS` (14 + 7 = 21 days). The live file therefore holds about 14–21 days. The first v133 sync on a v4 document folds the whole past at once, which is the migration. |
| D10 | The voice queue, tombstone TTL (30 days), meta merge, `joining` rule and remote-cache sha check keep their current meaning. |

## Repository layout (in the user's private sync repo)

```
baby-tracker-log.json            live document. Format 5 once archives exist; format 4 until then.
archive/events-2026-08.json      one file per UTC month of event time
archive/events-2026-09.json
...
voice-queue/...                  unchanged
```

Archive file body:
```json
{ "app": "baby-tracker", "kind": "archive", "version": 5, "month": "2026-09",
  "writtenBy": "133", "events": [ ...normalised entries, same shape as in the live file... ] }
```

The live document keeps its existing shape (`app`, `version`, `writtenBy`, `meta`, `events`, `plans`, …) and adds one field:
```json
"archive": { "dir": "archive", "foldedAt": "2026-11-14T10:00:00.000Z" }
```
This field is informational only. The source of truth for which months exist and their shas is the **directory listing** of `archive/`.

## Invariants (every step must keep these)

- **I1 — nothing silently dropped.** An entry may be left out of the live file only if the archive index says that archive month holds this `id` with `updatedAt >= local updatedAt`.
- **I2 — archive first, live second.** A fold writes archive files **before** it writes the live document that omits their entries. A crash between the two leaves duplicates, which are harmless because merge is by id and newest `updatedAt` wins. It never leaves a gap.
- **I3 — never write over what could not be read.** If an archive month cannot be read (bad JSON, failed blob), the fold does not write that month, and the index has no entry for it. Its events therefore stay in the live file, by I1.
- **I4 — the index mirrors the server, not this phone.** Index entries come only from archive files actually downloaded or actually written with a 2xx reply.
- **I5 — self-healing.** If an index month lists a non-deleted id that the local `events` lack, that month is re-downloaded on the next sync, whatever its sha. This covers restored backups, a cleared browser and similar cases. Deleted ids are excluded from this check, because local pruning of expired tombstones would otherwise cause endless re-downloads.
- **I6 — a merge only adds.** All merging goes through the existing rules (`normaliseImported`, `tombstoneExpired`, newer `updatedAt` wins).

## Archive index (IndexedDB)

- Database `baby-tracker-archive`, version 1, object store `months`, keyed by month string.
- Value: `{ month, sha, ids: { "<id>": ["<updatedAt>", 0|1 deleted] } }`.
- A separate key `"__dir"` holds `{ sha: "<tree sha of archive/ from the root listing>", repo: "<owner/repo>" }`.
- Helpers, modelled on the music IndexedDB code (`musicDb`, `musicTx`, `musicPut`, `musicGet`, `musicDelete`):
  - `archiveDb()`, `archiveLoadAll()`, `archivePutMonth(rec)`, `archiveForget()`.
  - `archiveForget()` clears the whole store. Call it on disconnect, on connecting to a different repo or token, and when `repo` in `__dir` differs from `syncConfig.repo`.
- In memory: `archiveIndex = { loaded: bool, dirSha, months: { "2026-09": { sha, ids } } }`, loaded once at startup. If IndexedDB is unavailable, it starts empty each session. That costs a full archive download once per app start, but stays correct.

## Sync algorithm (v133)

`attempt()` inside `syncNow` becomes:

1. **Root listing:** `GET /contents/?ref=HEAD`. This gives the live file's sha and the `archive` directory's tree sha, if present. If it fails, fall back to today's path: plain download of the live file, and archives treated as unknown, so nothing is omitted (I1).
2. **Live document:** reuse `remoteCache` when its sha matches. Otherwise `downloadRemote` (blob fallback included). Keep the existing format check: if `version > 5`, lock.
3. **Archive months:**
   - If the archive dir sha differs from `archiveIndex.dirSha`, or any month needs healing (I5), `GET /contents/archive?ref=HEAD` and list the files `events-YYYY-MM.json` with their shas.
   - For each month whose sha differs from the index, or that needs healing, download it (blob fallback; reuse `downloadRemote(config, path)`, which handles a path and the 1 MB case).
   - Merge its events with `mergeIntoLocal` and rebuild that month's index from the file's contents.
   - If a month cannot be read, drop that month from the index (I3) and carry on.
   - After all months are handled, store the new dir sha.
   - Months removed from the server are removed from the index.
   - Downloads run one at a time to stay gentle. Usually there are zero.
4. **Merge the live document** exactly as today: events, plans, shopping, rota, milk, journal, meta.
5. **Prune** exactly as today.
6. **Fold?** Fold when `archiveIndexComplete` (the listing succeeded and every listed month is indexed) and some local non-deleted-or-deleted event has `updatedAt < now − 21 days` and is not covered by the index. **On the first migration, the index is empty and everything older than 14 days qualifies.** For the fold:
   - `cutoff = now − HOT_DAYS` (14 days).
   - `candidates` = local events with `updatedAt < cutoff` that the index does not already cover at the same or a newer version.
   - Group the candidates by `time.slice(0, 7)`.
   - For each month, in order:
     - Re-download that month if the index sha is stale or missing and the listing has the file.
     - Merge the candidates in, newest `updatedAt` wins, and drop expired tombstones.
     - Write the month with `PUT archive/events-YYYY-MM.json` and its sha.
     - On **409**: re-download, re-merge, retry up to `SYNC_RETRIES` times. Still failing → abort the fold. The live document is then written without omitting those months' new candidates.
     - On success: update the index from **what was written** (I4).
     - If a month is unreadable: skip it (I3).
7. **Build the live document:** `localDocument()` with `events` = local events **not covered** by the index (I1, D5).
   - Set `version` to 5 if anything was omitted, else 4. Add `archive` info when the index is non-empty.
8. **mustPush** compares against **live ∪ index**. `remoteHasNothingOfOurs` gets a version that treats an event as present remotely when either the remote live copy or the index covers it, with `updatedAt >=`. Also push when a fold ran, or when the remote live file holds events that are now covered by the index and older than the cutoff. That second case lets another phone's leftover bloat shrink.
9. `putRemote` the live document with the live sha. A **409** retries the whole `attempt`, which already exists.

The remaining steps are unchanged: status line, toasts, retries, the frozen-sync guard.

## Constants (put them next to the `SYNC_*` constants, near `DOC_FORMAT`)

```js
var DOC_FORMAT = 5;          // was 4. The live file omits archived entries from 5 on.
var ARCHIVE_DIR = "archive";
var HOT_DAYS = 14;
var FOLD_SLACK_DAYS = 7;
var ARCHIVE_NAME_RE = /^events-(\d{4}-\d{2})\.json$/;
```

The lock check is `remoteFormat > DOC_FORMAT`. With `DOC_FORMAT = 5`, v133 still reads format 4 documents, as intended.

## Steps

- [x] **S0. Write this plan.** Commit and push it on the branch.
- [ ] **S1. Transport groundwork, with no change in behaviour.**
  - Make the root listing return the live sha and the archive dir sha: `remoteListing(config)` returns `{ logSha, archiveSha }`.
  - Make `fetchRemote` use it.
  - Add `listArchive(config)` and `downloadArchiveMonth(config, month)`. Reuse `downloadRemote` with a path, and make sure the remote cache only applies when there is no path. It already does.
  - Add `putArchiveMonth(config, month, doc, sha)`.
  - Commit, then run `node tests/run.js sync` — it must stay green.
- [ ] **S2. Archive index module** (IndexedDB plus memory fallback). Load it at startup next to `musicTidy()` and clear it on disconnect or repo change. Add the `covered(event)` helper.
- [ ] **S3. Reading archives.** Do step 3 of the algorithm, the I5 heal check, and the `covered`-aware `remoteHasNothingOfOurs` and live builder (steps 7–8). Bump `DOC_FORMAT` to 5. No fold yet. Check by hand that a repo with archives created by the test reads correctly.
- [ ] **S4. Fold** (step 6), including the 409 loop for archive months and abort-safety.
- [ ] **S5. Tests: `tests/test_archive.js`.** Extend the fake GitHub from `tests/test_sync.js`: directory listings with tree shas, multiple paths, per-path shas, PUT/409 per path, blobs per sha. Cover the matrix below.
- [ ] **S6. User-facing text.**
  - README sync bullet: add the archive paragraph.
  - Help topic `sync` (`app.js`, `id: "sync"`): one line in EN and RU about monthly archives and that all phones must update together.
  - The status line may say "Synced · archive up to <month>". This is optional, so keep it small.
- [ ] **S7. Version bump to 133**, all four places: the two `?v=` in `index.html`, `version.json`, `var fallback` in `app.js`, `var VERSION` in `sw.js`.
- [ ] **S8. Full suite:** `node tests/run.js`, run in the background, about 10 minutes, 59 runs expected once the archive test is added. Do not edit files while it runs. All must pass, with EXIT 0.
- [ ] **S9. PR, then squash-merge.** Use the usual `gh api` commands; see the project notes. In the PR body, warn that all phones must update.
- [ ] **S10. Rollout message to the user, in Russian:**
  1. On one phone, make a JSON backup first (Settings → Export), just in case.
  2. Update **all** phones: restart the app until it says version 133.
  3. The first sync will create the `archive/` folder in the repo. That is expected.
  4. Any phone still on v132 will say it is behind the log. Updating it fixes that, and nothing on it is lost.
- [ ] **S11.** Mark this plan DONE. Delete it from the repo in the same PR, or in the next one, and leave a short note in README instead.

## Test matrix for `tests/test_archive.js`

Use realistic UUID ids. Use `ctx.clock` to move time on by weeks.

1. **Migration.** A v4 live document holds 3,000 events spread over 3 months. A v133 phone syncs.
   - Archive files are created, one per month, holding exactly the entries older than 14 days.
   - The live file is format 5 and holds only the last 14 days, plus anything newer.
   - The union of the files equals the original set.
2. **Small taps.** After migration, logging one feed produces a live PUT under 50 KB and **no** archive PUT.
3. **A new phone joins.** It gets the full history (count equals the original) and all the archive months indexed.
4. **Editing an archived entry** on phone A:
   - it goes into the live file and B picks up the edit;
   - 22 days later a fold rewrites only that month, and the live file no longer holds it;
   - the union is still correct, with the new value winning.
5. **Deleting an archived entry.** The tombstone propagates. 31+ days later it is pruned everywhere, and there is no re-download loop (I5 excludes deleted ids).
6. **Concurrent fold.** Two phones fold at once: the archive PUT returns 409, followed by a retry. No entry is lost and the end state has no duplicates.
7. **Offline phone.** A phone is offline for 30 days with entries created back then (old `updatedAt`). When it comes back, those entries reach the other phone and are folded later.
8. **Importing an old backup.** Entries whose old `updatedAt` is not in the archive propagate.
9. **Cleared browser.** localStorage is cleared but the index survives in IndexedDB. The history is re-downloaded (I5).
10. **IndexedDB unavailable** (stub `indexedDB.open` to fail). Still correct, at the cost of a full archive download per session.
11. **Unreadable archive month.** That month is never overwritten. Its events stay in the live file, and the status line does not claim success for the archive.
12. **Archive month over 1 MB.** It is read through the blob path.
13. **Lock.** A document with format 6 locks a v133 phone. The existing behaviour is kept.
14. **Timezones.** The suite runs in UTC and Pacific/Auckland, and month grouping must be identical in both: `time.slice(0, 7)` of the ISO UTC string.
15. **No page errors.**

## Risks and notes

- **localStorage capacity** (about 5 MB on iOS): at about 30k entries the local copy itself will not fit. That is a separate future task (move `events` to IndexedDB). Note it to the user if asked, and do not do it now.
- **GitHub rate limit:** 5,000 requests an hour per token. A normal sync is root listing + voice queue + maybe a live download + maybe a PUT. The archive listing happens only when the archive dir sha moves, so there is no meaningful increase.
- **Clock skew between phones:** hot/cold depends on each phone's own clock. That is fine because of I1: a phone with a wrong clock can only keep **more** in the live file, never lose anything. It could trigger an early fold, which is also safe, because folding only moves entries into archives that it then indexes.
- Keep `tests/test_sync.js` passing unchanged, except where the format number appears.
