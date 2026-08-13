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
