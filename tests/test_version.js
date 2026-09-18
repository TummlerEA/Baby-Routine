"use strict";

// The release number lives in five places, and a release that moves four of
// them ships a phone that will never notice the fifth. No browser needed:
// this is a read of the files, and it runs in milliseconds.
//
//   index.html   style.css?v=N   the stylesheet a cached page asks for
//   index.html   app.js?v=N      the script a cached page asks for
//   version.json                 what a running copy polls to spot an update
//   app.js       var fallback    what it believes it is when that poll fails
//   sw.js        var VERSION     the cache name, and the shell it fetches
//
// Get these out of step and the failure is quiet: the app keeps working and
// stops updating, which is the worst shape a bug can take here.

var h = require("./helpers");
var t = h.tally();

var html = h.source("index.html");
var app = h.source("app.js");
var sw = h.source("sw.js");
var json = h.source("version.json");

function one(name, text, re) {
  var all = text.match(new RegExp(re.source, re.flags.replace("g", "") + "g")) || [];
  if (all.length !== 1) {
    t.ok(name + " appears exactly once", false, all);
    return null;
  }
  return text.match(re)[1];
}

var stylesheet = one("style.css?v= in index.html", html, /style\.css\?v=(\d+)/);
var script = one("app.js?v= in index.html", html, /app\.js\?v=(\d+)/);
var declared = one("version.json", json, /"version"\s*:\s*(\d+)/);
var fallback = one("var fallback in app.js", app, /var fallback = "(\d+)"/);
var worker = one("var VERSION in sw.js", sw, /var VERSION = "(\d+)"/);

var found = { stylesheet: stylesheet, script: script, declared: declared,
  fallback: fallback, worker: worker };

t.ok("every version number was found", Object.keys(found).every(function (k) {
  return found[k] !== null;
}), found);

var values = Object.keys(found).map(function (k) { return found[k]; })
  .filter(function (v) { return v !== null; });
var same = values.every(function (v) { return v === values[0]; });
t.ok("all five version numbers match", same, found);

t.ok("the version is a plain whole number", /^\d+$/.test(values[0] || ""), values[0]);

// The worker caches the shell by name, so the names it builds have to be the
// ones index.html actually asks for. A mismatch here means a phone offline
// gets a page whose script is not in the cache.
t.ok("the worker caches app.js at the version the page asks for",
  sw.indexOf('"./app.js?v=" + VERSION') !== -1, null);
t.ok("the worker caches style.css at the version the page asks for",
  sw.indexOf('"./style.css?v=" + VERSION') !== -1, null);

// version.json must never be cached, or the app can never learn it is behind.
t.ok("version.json is never served from the cache",
  /version\.json/.test(sw), null);

t.done();
