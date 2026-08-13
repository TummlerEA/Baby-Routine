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

## A handover for whoever takes over

Not charts — the thing that gets used at the door. Somebody arriving at nine
wants the last few hours in sentences: when the last feed was and how long it
took, how many nappies and of what kind, whether the baby has slept and for how
long, what is due next on the plan, and anything out of the ordinary such as a
temperature. Today that means scrolling the log and doing the arithmetic in
your head.

Most of this is already written. The Ask an AI screen builds exactly this text
already — part-day handling, gaps, projections, the lot — and then hands it to
somebody else. A handover screen is that same builder rendered on the phone
instead of packed into a URL, with the assistant framing dropped and the window
shortened from days to hours. It is the cheapest of the ideas here by a wide
margin, and it should be built before the charts.

Two decisions to make. **What the window is**: since the last handover, or a
fixed number of hours, or since the carer arrived — the third needs the app to
know who is holding the phone, which it does not, so start with hours. **Where
it lives**: its own screen reached from the top bar, never the main screen,
which stays four buttons.

## Charts, at two scales

Two views, and they are not the same drawing at different zoom levels.

**The last 24 hours, in detail.** A strip with time running across it and the
feeds, nappies and sleep marked on it where they fell. This is the one that
shows what a column of numbers cannot: the night gap, the evening cluster of
feeds, the long stretch that made up for it. Read it as a rolling 24 hours from
now rather than as "today" — a day that started six hours ago is a part day, and
comparing it against anything is the mistake the AI summary already had to be
taught not to make.

It also belongs at the top of the handover screen. That screen describes a
window in sentences; this is the same window as a picture, and somebody
arriving takes it in faster than they read.

**The last seven days, as movement.** Feeds a day, total sleep a day, the
longest overnight stretch, the gap between feeds — one bar or line per day, so
the eye catches a change faster than it would in a table. Seven days is the
right span: long enough to show a direction, short enough that a newborn's
pattern has not changed underneath it.

Both drawn by hand as inline SVG. That is not a hardship — a week of bars is a
loop and a few dozen elements — and a charting library would be an external
dependency, which is the one thing this project does not do. Watch the dark
theme: thin lines and mid greys disappear on a phone at night, and colour must
not be the only thing carrying meaning.

Be strict about what earns a place. A newborn has no weekly rhythm, so
day-of-week breakdowns say nothing, and a pie chart of nappy types answers a
question nobody asks. Everything beyond the four figures above is decoration on
a screen meant to be read one-handed.

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
handover. The handover screen above has to guess its window; with a rota it
does not have to guess at all, because "since the shift started" is a real
moment rather than an arbitrary number of hours back.

**Deliberately not a timesheet.** No clocking in, no recording who actually
turned up when, no pay. That is a different product, it changes what the app is
between people who see each other every day, and it is not what was asked for.

One trap, already met once: work out when today's shift ends from calendar
local time rather than by adding milliseconds. Adding hours across a clock
change is how the immunisation dates came out a day early.

**Order.** The handover first — it reuses what already exists and would be used
daily, and the 24-hour strip goes on the top of it. Then the shopping list,
which is a copy of the diary. Then the rota, which is small and makes the
handover better. The seven-day charts last: the most enjoyable to build and the
least likely to change what anybody does.

Naming the phones — one setting, "whose phone is this" — is worth doing
alongside whichever comes first. With three people logging, knowing who
recorded the three o'clock feed is useful on its own, and it costs a text box.
It is legibility, not permission: every phone holds the whole file and a token
that can write it, so nothing here restricts anybody, and it should never be
described as though it does.
