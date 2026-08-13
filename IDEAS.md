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

## Charts

Feeds, nappies and sleep per day, over a fortnight. No new data — everything
needed is already in the log, so this is presentation only.

Drawn by hand as inline SVG. That is not a hardship: a bar chart of fourteen
days is a loop and a few dozen elements, and a charting library would be an
external dependency, which is the one thing this project does not do. Watch the
dark theme — thin lines and mid greys vanish on a phone at night — and do not
let colour be the only thing carrying meaning.

Be strict about what earns a place. A newborn has no weekly rhythm, so
day-of-week breakdowns say nothing; a pie chart of nappy types answers a
question nobody asks. What is worth plotting is what a parent or a health
visitor actually looks for: feeds a day, total sleep a day, the longest
overnight stretch, and the gap between feeds — all of them trends, all of them
useful precisely because the eye catches a change in a line faster than in a
column of numbers. Everything else is decoration on a screen meant to be read
one-handed.

Lowest urgency of the ideas here. It is the most fun to build and the least
likely to change what anyone does.

## A shopping list, and jobs for each other

Two features, one shape. A shopping list — the carer adds nappies size 2, a
parent buys them and ticks them off — and a list of jobs to pass to each other,
such as ironing or a wash, are the same record with a different label. Building
one and labelling it twice costs very little more than building one.

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

**Two things to be honest about before starting.**

*Nobody is notified.* There is no server, so there is no push. A job added at
eight is seen when the other person next opens the app, which might be the
evening. That is a shared list, not a message — and if the expectation is "I
tell the carer to do something and they see it", the expectation is wrong and
the feature will disappoint. Say so in the interface: show when an item was
added and by whom, so a stale list reads as stale.

*Roles cannot be enforced.* Every phone holds a complete copy of one JSON file
in a repository it can write to. Anything called a role — the carer sees jobs
but not the medical notes, a parent can edit and a carer cannot — is a
convenience in the interface and nothing more; the data is all there on the
device, and the token grants write access to all of it. That is fine for a
family who trust each other, which is the case here, and it must not be
described as anything stronger. Real restriction needs a server and accounts,
which is the thing this whole app is built to avoid. If restriction ever
genuinely matters, the answer is a second repository, not a role field.

What roles do buy is legibility: "who is this phone" as a single setting, shown
next to entries and jobs, so three people can tell who logged the 3am feed and
who a job is meant for. That is worth having and costs one text box.

**Order.** The handover first — it reuses what exists and is used daily. Then
the shopping and jobs list, which is a copy of the diary. Charts last. Roles
only when the answer to "what would we actually restrict" is more than a
shrug — and by then the name-on-the-phone setting may be all that was wanted.
