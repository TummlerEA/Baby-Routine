/* Baby Tracker — the offline copy of the app itself.
   SPDX-License-Identifier: MIT */
"use strict";

// Bumped together with index.html, version.json and the fallback in app.js.
// A test fails if the four ever disagree.
var VERSION = "76";
var CACHE = "baby-tracker-" + VERSION;

// The page is always kept and looked up under this one name, whatever address
// the browser happened to ask for it by.
var PAGE = "./index.html";

// The whole application: the page and the two files it hangs off. Both of
// those carry ?v= in their URL, so a released version's copies never change
// under their own name and can be kept for as long as anything asks for them.
var SHELL = [PAGE, "./app.js?v=" + VERSION, "./style.css?v=" + VERSION];

// Never cached, and never even looked at: the one question a cache must not be
// allowed to answer is "is there a newer version?".
function isVersionCheck(url) {
  return /(^|\/)version\.json$/.test(url.pathname);
}

// Nor this file. Browsers already fetch a worker script outside its own fetch
// handler, but a cache-first rule that could serve a stale copy of the caching
// itself is not something to leave standing on a technicality.
function isSelf(url) {
  return /(^|\/)sw\.js$/.test(url.pathname);
}

function isPage(request, url) {
  return request.mode === "navigate" || /(^|\/)(index\.html)?$/.test(url.pathname);
}

self.addEventListener("install", function (event) {
  // Each file is added on its own and a failure is swallowed. One unreachable
  // file must not fail the install, because a failed install leaves no worker
  // at all — worse than a cache with a hole in it that the next fetch fills.
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return Promise.all(SHELL.map(function (href) {
        return cache.add(new Request(href, { cache: "reload" })).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.map(function (name) {
        return name === CACHE ? null : caches.delete(name);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET") return;

  var url;
  try { url = new URL(request.url); } catch (e) { return; }

  // Anything not ours is none of our business, and the GitHub API most of all:
  // routing the traffic that carries a sync token through this file would add
  // a place it could be kept, for no gain whatsoever.
  if (url.origin !== self.location.origin) return;
  if (isVersionCheck(url) || isSelf(url)) return;

  if (isPage(request, url)) {
    // ?r= is the way out of anything this cache has got wrong — the version
    // number at the foot of the screen asks for the page that way. So it is
    // answered from the network, and only a dead connection falls back to what
    // is kept here: throwing the offline copy away because somebody tapped
    // while out of signal would leave them nothing to open at all.
    var forced = /[?&]r=/.test(url.search);
    var store = caches.open(CACHE);
    // Fetched behind whatever is handed over. Without this second half a phone
    // could sit on one index.html for ever, which is the ordinary way an app
    // that works offline becomes an app that cannot be updated.
    var fresh = store.then(function (cache) {
      return fetch(request).then(function (response) {
        if (!response || !response.ok) return response;
        return adopt(cache, response);
      });
    }).catch(function () { return null; });
    // The answer usually comes out of the cache in a moment, and a worker with
    // nothing left to answer can be stopped where it stands. This says the
    // taking-on of the new page is still going, so it is not cut in half.
    event.waitUntil(fresh);
    event.respondWith((forced
      ? fresh.then(function (response) {
          return response || store.then(function (cache) { return cache.match(PAGE); });
        })
      : store.then(function (cache) { return cache.match(PAGE); }).then(function (hit) {
          return hit || fresh;
        })
    ).catch(function () { return fetch(request); }));
    return;
  }

  // Everything else of ours is named with the version that made it, so what is
  // in the cache is right by definition and only a miss needs the network.
  event.respondWith(caches.match(request).then(function (hit) {
    if (hit) return hit;
    return fetch(request).then(function (response) {
      if (!response || !response.ok) return response;
      // Kept before the answer goes out rather than behind it: a worker with
      // nothing left to answer can be stopped where it stands, and a file that
      // was fetched but not kept would be fetched again on the next opening —
      // which offline is no opening at all. It costs one cache write, and only
      // on the miss that fetched the file in the first place.
      var copy = response.clone();
      return caches.open(CACHE).then(function (cache) {
        return cache.put(request, copy);
      }).catch(function () {}).then(function () { return response; });
    });
  }).catch(function () { return fetch(request); }));
});

// A newer page is taken on only once the files it names are here as well.
// Otherwise an update arriving in the last seconds of a connection would leave
// a page in the cache whose script is not, and the next opening with no signal
// would find nothing to run.
function adopt(cache, response) {
  var forCache = response.clone();
  return response.clone().text().then(function (html) {
    var m = /app\.js\?v=(\d+)/.exec(html);
    var assets = m ? ["./app.js?v=" + m[1], "./style.css?v=" + m[1]] : [];
    // Fetched first, written afterwards. Adding them as they arrive would
    // leave the half that got through sitting in the store under a version
    // nothing references, every time an update was interrupted.
    return Promise.all(assets.map(function (href) {
      return cache.match(href).then(function (has) {
        if (has) return null;
        return fetch(new Request(href, { cache: "reload" })).then(function (res) {
          if (!res || !res.ok) throw new Error("incomplete");
          return { href: href, res: res };
        });
      });
    })).then(function (got) {
      return Promise.all(got.map(function (item) {
        return item ? cache.put(item.href, item.res) : null;
      }));
    });
  }).then(function () {
    return cache.put(PAGE, forCache);
  }).then(function () {
    return response;
  }).catch(function () {
    // The page is handed over either way; it is only the keeping of it that
    // waits for the rest of its files.
    return response;
  });
}
