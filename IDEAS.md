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

## A shopping list

The carer adds nappies size 2, a parent buys them and ticks them off.

Structurally this is the diary again: a list of items with an id, a title, an
`updatedAt` and a tombstone, merged by the same last-write-wins rule and
carried in the same synced document. The diary code is the template; copy its
shape rather than inventing another.

Ticking off is a state, not a deletion. A bought item wants a `done` flag and
the time it was set, so it can be un-ticked when somebody ticks the wrong line,
and it should fade out of the list after a day or so rather than vanishing on
the tap. Resist fields: no quantities, no categories, no due dates. "Nappies
size 2, two packs" typed into one box beats three inputs, and this is a
household list, not a project tracker.

**Nobody is notified.** There is no server, so there is no push. An item added
at eight is seen when the other person next opens the app, which might be the
evening. Show when each item was added, and by whom if the phone has a name, so
a list nobody has looked at reads as one nobody has looked at.

## When the carer is here

Which days the carer works and roughly how long — Monday to Thursday, six hours
or eight. The point is a parent knowing where the week stands at a glance. The
detail is settled between the carer and the other parent directly, so the app
should show the shape of the arrangement and stay out of the arrangement
itself.

Start with a weekly pattern: seven days, each either off or a number of hours,
with a start time if it is known. One record, synced with the settings, and a
two-week strip to show what that comes to. That is very likely the whole
feature — "Mon-Thu, 8h" is the answer to the question being asked.

**Do not build a recurrence engine.** Repeating events with exceptions is where
calendars stop being small: rules, end dates, and a list of the days the rule
does not apply to. If the pattern turns out to need exceptions — a Thursday
off, an extra Friday — add a sparse list of overrides keyed by date that the
strip reads on top of the pattern, and add it only once the pattern has proved
insufficient in use. Not before.

What it buys beyond the picture: a quiet line on the main screen saying the
carer is here until five, an honest total of hours in the week, and a better
handover. The handover screen offers a choice of 6, 12 or 24 hours because it
has nothing better to go on; with a rota it would not have to guess at all,
since "since the shift started" is a real moment rather than a round number of
hours back.

**Deliberately not a timesheet.** No clocking in, no recording who actually
turned up when, no pay. That is a different product, it changes what the app is
between people who see each other every day, and it is not what was asked for.

One trap, already met once: work out when today's shift ends from calendar
local time rather than by adding milliseconds. Adding hours across a clock
change is how the immunisation dates came out a day early.

**Order.** The handover and its 24-hour strip are built, in v34. Next the
shopping list, which is a copy of the diary. Then the rota, which is small and
makes the handover better by replacing the window it currently has to guess.
The seven-day charts last: the most enjoyable to build and the least likely to
change what anybody does.

Naming the phones — one setting, "whose phone is this" — is worth doing
alongside whichever comes first. With three people logging, knowing who
recorded the three o'clock feed is useful on its own, and it costs a text box.
It is legibility, not permission: every phone holds the whole file and a token
that can write it, so nothing here restricts anybody, and it should never be
described as though it does.
