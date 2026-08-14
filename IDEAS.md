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

## When the carer is here — the weekly pattern is built, in v41

Which days the carer works and roughly how long — Monday to Thursday, six hours
or eight. The point is a parent knowing where the week stands at a glance. The
detail is settled between the carer and the other parent directly, so the app
should show the shape of the arrangement and stay out of the arrangement
itself.

Behind ⏰ in the top bar: seven days, each either off or a number of hours,
with a start time if it is known. One record, synced the way the name and
date of birth are — a single stamp on the whole thing rather than per-item
tombstones, since a week is seven fixed slots, never a growing list. A start
time earns a quiet line on the main screen while that shift is on — **Carer
here until five** — plus a running total of hours in the week. A day marked
working with no start time gets neither, since there is no moment to count
down to; it still counts toward the total.

**Do not build a recurrence engine.** Repeating events with exceptions is where
calendars stop being small: rules, end dates, and a list of the days the rule
does not apply to. If the pattern turns out to need exceptions — a Thursday
off, an extra Friday — add a sparse list of overrides keyed by date that the
main-screen line reads on top of the pattern, and add it only once the pattern
has proved insufficient in use. Not before.

**Not built yet: feeding the rota into the handover screen.** It still offers
a choice of 6, 12 or 24 hours because it has nothing better to go on; with a
rota in place it would not have to guess, since "since the shift started" is a
real moment rather than a round number of hours back. Left for a follow-up
rather than folded into v41, so the base record could ship and be tested on
its own first.

**Deliberately not a timesheet.** No clocking in, no recording who actually
turned up when, no pay. That is a different product, it changes what the app is
between people who see each other every day, and it is not what was asked for.

One trap, already met once: work out when today's shift ends from calendar
local time rather than by adding milliseconds. Adding hours across a clock
change is how the immunisation dates came out a day early — the rota's own
range works out the shift's start and end from the calendar day, not from
epoch arithmetic, for the same reason.

**Order.** The handover and its 24-hour strip are built, in v34. The shopping
list is built, in v38. The carer rota's weekly pattern is built, in v41; next
is wiring it into the handover window. The seven-day charts last: the most
enjoyable to build and the least likely to change what anybody does.

Naming the phones — one setting, "whose phone is this" — is worth doing
alongside whichever comes first. With three people logging, knowing who
recorded the three o'clock feed is useful on its own, and it costs a text box.
It is legibility, not permission: every phone holds the whole file and a token
that can write it, so nothing here restricts anybody, and it should never be
described as though it does.
