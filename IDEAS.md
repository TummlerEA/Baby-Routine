<!-- SPDX-License-Identifier: MIT -->

# Ideas not yet built

Things worth doing one day, with enough of the reasoning written down that
picking one up later does not mean working it all out again. Nothing here is
promised, and anything that turns out to be a bad idea should be struck out
rather than quietly left to look pending.

## Move to a domain of our own

Today the app lives at `tummlerea.github.io/Baby-Routine/`. That address ties
the project to GitHub for good: the moment it is on somebody's Home Screen it
cannot be changed without taking their app away. A domain we own costs about
£10 a year and buys the freedom to move the hosting later — to somewhere that
keeps request logs, for instance, since GitHub Pages keeps none and there is
otherwise no way to know whether anyone is using this at all.

**The obvious plan does not work.** Setting a custom domain on GitHub Pages
does not give you two working addresses; GitHub redirects the `github.io` one
to the new domain. Both links keep *resolving*, which is the easy half, but
they cannot both keep serving the app, so there is no gentle period where old
and new run side by side.

**The real work is not DNS, it is the data.** Browser storage belongs to an
origin, so on the new domain every install opens empty: the log, the settings,
the planned intervals, the sync token. Nothing is destroyed, but nothing is
found either, and to whoever is holding the phone those look the same.

**The switch is one-way and there is no second chance at it.** After the DNS
change the old page never executes — the redirect happens at the server, so the
app gets no opportunity to hand its data over. Everything needed for the move
must therefore ship *before* the domain changes, while the old address still
runs code.

A plan that would cost nobody their history:

1. Release a version that offers to carry the data across. The share encoder
   already packs entries into a URL fragment; aimed at the new host it is a
   migration link, and one tap on the phone that holds the data is the whole
   job. Check what the payload leaves behind — settings, the diary — and either
   carry those too or say plainly that they need re-entering.
2. Fall back to the JSON backup when the history is too long for a URL. Slower
   and it asks more of the user, but it has no ceiling and it already exists.
3. Warn about sync in the same breath. The token lives in browser storage like
   everything else, and a personal access token cannot be read a second time on
   GitHub, so the move means creating a new one. Better said up front than
   discovered.
4. Leave a decent gap — weeks, not days — before flipping the DNS, so people
   have opened the app at least once and seen the offer.

**When to do it:** before the link is published anywhere public, never after.
Migrating a handful of families is an evening; migrating strangers who have no
reason to read a migration notice is not possible at all. Registering the name
is cheap and can happen long before any of this — a domain that simply
redirects to `github.io` changes no origins and breaks nothing, and it stops
somebody else taking the name in the meantime.

## Seven days, as movement

The other half of this was the 24-hour strip, and that is built: it sits at the
top of the handover screen from v34, hand-drawn as inline SVG. Its code is the
template for anything else drawn here.

What is left is the longer view. Feeds a day, total sleep a day, the longest
overnight stretch, the gap between feeds — one bar or line per day, so the eye
catches a change faster than it would in a table. Seven days is the right span:
long enough to show a direction, short enough that a newborn's pattern has not
changed underneath it.

Watch the dark theme: thin lines and mid greys disappear on a phone at night,
and colour must not be the only thing carrying meaning. The strip solves this
by labelling each rail with the same icon as its button; do the same rather
than relying on a legend.

Be strict about what earns a place. A newborn has no weekly rhythm, so
day-of-week breakdowns say nothing, and a pie chart of nappy types answers a
question nobody asks. Everything beyond the four figures above is decoration on
a screen meant to be read one-handed.

One trap the handover sidestepped and this one cannot: it reads a rolling
window, so there is no part day in it at all. Here the day *is* the unit being
compared, and today drawn as a bar beside six complete ones is the same mistake
the AI summary had to be taught out of. Either leave today off the chart, or
mark it plainly as unfinished.

## The rest of the app in a second language

The handover reads in Russian from v35. Nothing else does, and that was a
deliberate stopping point rather than an unfinished job: it is the one screen
somebody who cannot read English has to read every day.

What the machinery already provides, if this goes further: a strings table with
both languages side by side, three-form plurals, genitive months, Russian
durations, comma decimals, and the rule that no sentence may require a gender
for the baby. Copy that shape; do not invent a second one.

**What the next step would cost.** The screens a carer actually touches — the
three buttons, the card after a tap, the history, the manual form — are roughly
another 120 strings and 25 sentences. That leaves the app visibly half
translated: Settings, Help, the exports and the AI screen would still be
English. Ugly, but a carer never opens those.

**What full translation would cost, and why it is not obviously worth it.** The
Help screen is about 3,100 words — around nine tenths of all the text in the
app — and it is not ordinary prose: NHS routing, the red flags that mean 999,
safer sleep, temperature thresholds. Translating that is a responsibility, not
a task, and every future edit is then made twice. The AI prompt is another
question again: if the interface is Russian the prompt should probably go out
in Russian so the answer comes back in Russian, which means re-writing the
part-day warnings that took several attempts to get right in English.

**Leave the exports in English whichever way this goes.** A CSV or a Markdown
report may end up in front of a doctor, and stable column headings are worth
more than a translated one.

## Who logged it, with three tokens on one account

Three people log on three phones: two parents and a nanny. Sync goes through
one private repository owned by one of them, and the other two hold personal
access tokens issued from that same account. Nobody has a GitHub account of
their own here, and nobody needs one. What is wanted is small: at the end of
a night, knowing who recorded the three o'clock feed.

**The obvious shortcut does not exist.** Every sync write is a commit, and a
commit carries an author — so it looks as though GitHub is already recording
this for free. It is not. A token proves which *account* is calling, never
which token was used: there is no endpoint that reports it and no response
header that carries it. With three tokens on one account, all three phones
write commits signed by the same person. Checked before it was designed
around, and worth writing down because the idea is tempting every time.

**Fingerprinting the token locally works and still should not be done.** The
phone holds its own token, so it could hash it and use that as an identity
without asking GitHub anything. `crypto.subtle` is available even with the
app opened as a `file://` page, which is the objection that first comes to
mind and is not the real one. The real ones are these. It saves no setting:
a hash is opaque, so somebody still has to say once that this one is the
nanny — the same text box, for nothing. Tokens expire, fine-grained ones by
obligation, and the day the nanny's is replaced her history splits in two and
she becomes a stranger until she is named again. It would put a value derived
from the token into the synced document, turning "the token never leaves the
device" into "the token never leaves the device, except this", which is a
worse rule to hold in your head than an absolute one. And it identifies the
wrong thing: one token on two phones is one identity, a new token on one
phone is two.

**So the phone names itself, not its token.** A random short id, made on
first run and kept for the life of the install, written onto every entry that
phone creates. Eight hex characters is ample for a household and this field
rides in every entry of a document that is uploaded whole, so it should not
be a UUID. It survives a token being replaced, it exists before sync is set
up at all, and it never touches the secret.

**The id goes on the entry; the name does not.** Which phone is "Nanny" is a
lookup kept once in settings, travelling with `nightWindow` and the intervals
by the same last-write-wins rule. That split is what makes naming work
backwards: a phone that has been logging for a fortnight before anybody gets
round to naming it has every one of those entries labelled the moment the
name is set, because the entries only ever carried the id. Nothing needs
rewriting and nothing needs a migration.

**Say what it actually knows.** This records the phone an entry was made on.
If the nanny logs a feed on the mother's phone it will say the mother, and
that is not a fault to be engineered away — it is what the field means. The
wording has to match: "logged on Mum's phone", never "Mum did this". It is
legibility, not permission. Every phone holds the whole file and a token that
can write it, so nothing here restricts anybody and it must never be
described as though it does.

**What cannot be recovered.** Everything already logged has no id on it and
never will; it should read as not recorded rather than be guessed at. The
information is faintly present in the repository's history — each past commit
was pushed by somebody, and diffing them would show which entry ids first
appeared in which push — but that is one API call per commit over hundreds of
them, and it would attribute an entry to whichever phone first *pushed* it
rather than the one that made it. Not worth the requests or the wrongness.

**One thing the three-token setup does give, once phones are named.** The
Contents API takes `author` and `committer` in the body of a write, and
`putRemote` currently sends neither, which is why every commit is signed by
the account that owns the repository. Passing the phone's name makes the
repository's own history readable — "Nanny, 14:03" instead of three identical
lines — and the email there need not match any GitHub account, so nobody's
profile is falsely attached to anything. That is the app telling GitHub who
it is rather than the other way round, and it costs one field.

**Decide before building: where the name is allowed to travel.** Onto the
handover screen and into exports it plainly belongs — that is the whole
point. A share link is the one to think about rather than assume: it already
carries the baby's data and goes only to somebody being trusted with it, so a
household label is probably fine, but it is a person's role in a URL and that
should be a decision rather than a side effect. The id itself should never
appear anywhere a person reads; if there is no name for it yet, say so.

## Developmental leaps, and the honest version of them

The Wonder Weeks says a baby passes through ten mental leaps on a fixed
schedule counted in weeks, each announced by a stretch of clinginess and
crying and followed by a new ability. The commercial chart puts the first
year's at weeks 5, 8, 12, 19, 26, 37, 46 and 55. An app that already knows
the date of birth could obviously put a line on the main screen saying one is
due, and that is the idea worth thinking about properly rather than either
adopting or dismissing.

**What the evidence actually is, both ways.** The theory comes from Hetty van
de Rijt and Frans Plooij, whose 1992 paper in the *Journal of Reproductive
and Infant Psychology* rested on longitudinal observation of about fifteen
mother-infant pairs. Plooij's own PhD student then failed to replicate it: de
Weerth and van Geert, *British Journal of Developmental Psychology* 1998,
watched four pairs weekly for fifteen months and found the strictly timed
pattern in one of the four. Plooij pressed her not to publish, replied in
print when she did, and the dispute cost him his standing in the field. It is
not one-sided, though, and pretending otherwise would be as sloppy as
swallowing the marketing: Sadurní and Rostan reported eight regression
periods in eighteen Catalan infants in 2002, and the ISIRP group published
supporting work around 2003. Every study on both sides is tiny — four, then
fifteen, then eighteen. This is a contested hypothesis with thin evidence
either way, not settled science and not nonsense.

**The chart is not the research.** The week numbers in the published papers —
5, 8, 12, 17, 26, 36, 44, 53 — are close to but not the same as the ones the
commercial chart prints. Whichever is quoted, it should not be quoted as
though it came from the other. (The source page itself could not be opened
from where this was written up; the numbers above come from secondary
accounts and should be checked against it before anything ships.)

**The problem is not really the evidence, it is what a fixed calendar does in
use.** Babies are unsettled often. A window drawn on a chart weeks in advance
will land on a bad patch a good share of the time whatever is true, and the
parent reading it has no way to be wrong: a hard week inside the window
confirms the leap, a calm one means she took it well. Something that cannot
fail to be right is not telling you anything, and at four in the morning it
invites a worse move than that — reading a bad night as a scheduled stage to
be waited out, when it is the night you would otherwise have taken a
temperature.

**And it would be the first thing this app asserts that it did not measure.**
Every number on every screen comes from the household's own log, and the one
place the app speaks with any authority — the Help screen's NHS routing, the
red flags that mean 999, safer sleep — is guidance that can be checked
against a source that stands behind it. Putting a contested developmental
calendar beside that borrows the same voice for something that has not earned
it. If any of this is built, it must not sit anywhere near the health
guidance, and it must say plainly whose theory it is and that replication has
been mixed.

**There is a licence question as well as a scientific one.** The Wonder Weeks
is a trademark with a paid app behind it. Week numbers are facts and nobody
owns them, but the leap names and the descriptions of each one are somebody's
writing, and this repository is MIT. Nothing of theirs should be copied in.

**The version actually worth building inverts it.** The app does not need a
chart to say when this baby had a hard few days — it has been logging every
feed, every nappy and every stretch of sleep since she was born, and it
already knows what her ordinary week looks like. It can mark the stretches
where her own pattern came apart: nights broken more often than usual, naps
that stopped holding, feeds bunching. That is measured rather than predicted,
it is about this baby rather than babies in general, it can be wrong in a way
the parent can see, and it needs no theory to justify it. Set beside the age
in weeks it answers the same question a parent actually has — "is this a
phase or is something wrong?" — without claiming to know the answer in
advance. If leaps are real they will show up in it. If they are not, nothing
false was ever said.

**One thing to get right if the ages are ever shown at all.** The weeks are
counted from the due date, not the birth date, and for a baby born five weeks
early that is the whole difference between a chart that fits and one that
does not. The app stores a date of birth and has no notion of a due date, so
this is a new setting before it is anything else — and a reason on its own to
prefer the version that reads the log.

## A shopping list — built, in v38

Behind 🛒 in the top bar. What it turned out to need beyond the original plan:

An Amazon link on each item, opened by the phone itself — no scripted
redirect, a plain `<a href>` so the OS hands it to the Amazon app the normal
way. Left blank, the button searches `amazon.co.uk` for whatever was typed
instead. Checked at the time: there is no public API for a real Amazon wish
list — the Product Advertising API cannot read or write one, and scraping the
page would be a request to somebody else's server, which this app does not
make. A link field is the honest version of the same idea.

Bilingual from the start, sharing the handover's language setting rather than
asking again — the reasoning for why is recorded under "The rest of the app in
a second language" above.

A count on the top-bar icon, and a line on the handover screen naming what is
outstanding. Neither is a real notification — there still isn't a server —
but between them the list is seen without a deliberate trip to its own screen,
which is as close as this app gets to nagging anybody.

**v39.** Two refinements once it was in daily use. A link on its own is now
enough to add something — the name is filled in later, or left as the link
itself, shown in italics as a visible placeholder rather than a blank. Fetching
the real title from Amazon was asked for and is not possible without a request
to Amazon's server, which stays off the table for the reason above; the link
standing in for the name until somebody renames it is the honest middle
ground.

And a status ahead of "bought": **New → Ordered → Arrived**, a pill that
states the next tap rather than the current state, cycling forward and
wrapping back round so a mis-tap costs one more tap rather than a rebuild.
Buying is still independent of it — the tick works from any status, New
included, and the pill retires once something is bought, since there is
nothing left to track. It stays a pre-purchase detail, not a fourth thing to
maintain forever: resisting fields is still the right default, this one earned
its place by being asked for directly.

## When the carer is here — built, in v41

Which days the carer works and roughly how long. The point is a parent
knowing where the week stands at a glance. The detail is settled between the
carer and the other parent directly, so the app should show the shape of the
arrangement and stay out of the arrangement itself.

**The first design was a recurring weekly pattern — Monday to Thursday, six
hours or eight — and it was wrong.** It shipped, was shown around, and did
not survive contact with an actual rota: which day the week starts on, and
what time each shift starts, both move from one week to the next. A template
that is right about half the time is worse than no template, since every week
now needs correcting rather than just recording. It was pulled before release
and replaced with what is live behind 🤗 in the top bar now:

**Every shift is its own date.** Add a date, roughly how many hours, and a
start time if it is known — the same shape a plan or a shopping item already
has, so it syncs, merges and tombstones the exact same way: last write wins,
a deletion travels as a tombstone, nothing here invents a second mechanism.
There is no pattern behind it and nothing is assumed about next week from
this week; a family whose days really are regular just adds each one as it is
known, same as anybody else.

A start time earns a quiet line on the main screen while today's shift is on
— **Carer here until five**. A shift with no start time gets none, since
there is no moment to count down to.

**Second false start: a date/hours/start-time form for every shift.** Correct
in principle, wrong to use — a week's worth of shifts meant opening the form
seven times, and the native time input scrolled a minute at a time to reach
a start time nobody actually needed to the minute. Direct feedback after
using it for real: too many taps, and marking a day as **off** — the thing
asked to be quick — needed as many of them as recording a shift did.

**What replaced it: a week on screen at a time, every day tappable in
place.** Behind 🤗, one week's seven days always shown, prev/next to move to
another. Tapping a day steps it forward — nothing set → off → working → back
to nothing set — so off is always exactly one tap away, from wherever a day
currently stands. Once a day is working, two dropdowns appear inline: hours,
and a start time in half-hour steps rather than one-minute ones, both
pre-set to sensible defaults (6 hours, 9:00) instead of blank, since moving
a default is faster than typing one in from nothing. Every change saves
immediately — there is no separate add/save step to open or close. The
total for the week on screen sits beside the date range, so "6 off 6 6 7"
reads as a number as well as a row.

**Not built yet: feeding the rota into the handover screen.** It still offers
a choice of 6, 12 or 24 hours because it has nothing better to go on; with
today's actual shift on record it would not have to guess, since "since the
shift started" is a real moment rather than a round number of hours back.

**Deliberately not a timesheet.** No clocking in, no recording who actually
turned up when, no pay. That is a different product, it changes what the app is
between people who see each other every day, and it is not what was asked for.

One trap, already met once: work out when today's shift ends from calendar
local time rather than by adding milliseconds. Adding hours across a clock
change is how the immunisation dates came out a day early — the rota's own
range works out a shift's start and end from the calendar day, not from
epoch arithmetic, for the same reason.

**Order.** The handover and its 24-hour strip are built, in v34. The shopping
list is built, in v38. The carer rota is built, in v41 — a plain per-date
record after the recurring pattern turned out to be the wrong shape; next is
wiring today's shift into the handover window. The seven-day charts last: the
most enjoyable to build and the least likely to change what anybody does.

## Voice logging — the queue side is built (v43–v44); no working trigger yet

Saying "Feed" to Siri, hands-free, and having it land in the log. No backend
of ours to receive it — everything the app owns already lives in a private
GitHub repository, so a Siri Shortcut just writes there directly, using the
same repository and token sync already has.

**A queue directory, rather than editing the shared document.** A Shortcut
cannot run the app's own merge logic, so it cannot safely read the main JSON
file, add an entry and write it back — a sync running at the same moment
would either collide with it or get silently overwritten by it. Instead
every voice entry is its own new file under `voice-queue/`, created with a
single write and no read first, since a freshly made, uniquely named file
can never conflict with anything already there. Sync lists the directory,
turns each file into a real event, and deletes it.

**Everything needed is in the filename, not the file's contents.** A queue
file is named `voice-queue/feed__<id>__<time>.json` — type, a fresh id and
the time all sit in the name itself, so sync never has to fetch and parse a
file's body: the one directory listing GitHub already returns is the whole
payload. What is actually written inside the file does not matter and is
never read.

**Idempotent by id, on purpose.** A Shortcut has no way to resolve a write
conflict itself, so the design instead makes replay harmless: applying the
same filename twice produces the same event once, keyed by the id already
inside it. A queue file that fails to delete, or a sync that runs twice
before it does, costs nothing — it is simply looked at again and does
nothing new the second time.

**Not built: parsing a spoken time.** "Log a feed at half three" would need
real speech parsing; every Shortcut instead logs the moment it runs, which
is exactly how the buttons on the main screen already behave. Structured
measurements — weight, temperature — by voice are not attempted either:
turning free speech into a number worth trusting is a different, harder
problem than turning a fixed phrase into a fixed type.

**Tried for real, and set aside: Shortcuts on iPhone, and IFTTT.** Both are
sound in theory — that is what the design above is for — but neither was
actually confirmed working, and both attempts are done for now:

- *Shortcuts on iPhone*, built by hand, action by action, over a real phone,
  screenshot by screenshot. The pieces went together correctly — the UTC
  conversion, the dedup-safe id, the request itself — but the final step
  reported success ("Logged") without the file actually landing in the
  repository, and finding out which part was silently failing meant reading
  Shortcuts' own error output action by action. That is where it stopped:
  workable in principle, too much back-and-forth over screenshots to see
  through to a working state.

  Since read back rather than re-tried: the "Logged" meant nothing either
  way. "Get Contents of URL" does not treat an HTTP error as a failure — it
  hands back the error body as an ordinary result and the Shortcut carries
  on speaking — and the recipe never looked at the answer. So the attempt
  had no way to tell a rejected request from an accepted one, and the thing
  to do first is make GitHub's reply visible rather than rebuild anything.
  README's voice section now carries that step and what each likely reply
  means; whether the underlying cause was the token, the path or the body
  is still unknown, and still needs a phone to find out.
- *IFTTT*, as the Google Assistant route, was never built at all. It needs
  something that changes on every run to keep queue filenames unique, and
  free IFTTT has no confirmed way to produce that — would have meant either
  asking the person to say a different word each time, or hoping a suitable
  ingredient exists once the applet is actually open, neither tested.

None of this touches the sync side above, which is built and has its own
tests regardless of what eventually drives it — a working Shortcut, applet,
or something else entirely can be dropped in later without another line of
app.js. The search for a voice route continues on the phone's own terms
rather than through either of these.

Naming the phones is worth doing alongside whichever comes first, and is
written up on its own above — see *Who logged it, with three tokens on one
account*, which also covers why the token cannot supply the name itself.
