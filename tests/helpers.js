"use strict";

// Shared plumbing for the checks. Nothing here is shipped: the app is still
// four files of plain HTML, CSS and JavaScript with no dependencies, and
// nothing under tests/ is served by GitHub Pages or reachable from index.html.

var fs = require("fs");
var path = require("path");
var url = require("url");

var ROOT = path.join(__dirname, "..");

// The app is opened as file://, which is one of the two ways it has to work.
// It also means no server to start and no port to collide with.
var APP = url.pathToFileURL(path.join(ROOT, "index.html")).href;

// Playwright is a development dependency of these checks alone. It may sit in
// tests/node_modules, in a global install, or wherever this machine keeps
// such things — so try, in order, rather than insisting on one layout.
function playwright() {
  var tried = [];
  var candidates = [];
  if (process.env.PLAYWRIGHT_PATH) candidates.push(process.env.PLAYWRIGHT_PATH);
  candidates.push("playwright");
  candidates.push("/opt/node22/lib/node_modules/playwright");
  candidates.push("/usr/lib/node_modules/playwright");
  candidates.push("/usr/local/lib/node_modules/playwright");
  for (var i = 0; i < candidates.length; i++) {
    try {
      return require(candidates[i]);
    } catch (e) {
      tried.push(candidates[i]);
    }
  }
  console.error("Playwright was not found. Install it with:\n" +
    "  cd tests && npm install\n" +
    "or point PLAYWRIGHT_PATH at an existing copy.\nLooked in:\n  " +
    tried.join("\n  "));
  process.exit(2);
}

// A browser this machine already has, when there is one. Left unset otherwise,
// so Playwright falls back to the copy it downloaded for itself.
function browserPath() {
  var candidates = [];
  if (process.env.CHROMIUM_PATH) candidates.push(process.env.CHROMIUM_PATH);
  candidates.push("/opt/pw-browsers/chromium");
  for (var i = 0; i < candidates.length; i++) {
    try {
      if (fs.statSync(candidates[i])) return candidates[i];
    } catch (e) { /* not there; try the next */ }
  }
  return null;
}

function launch() {
  var exe = browserPath();
  return playwright().chromium.launch(exe ? { executablePath: exe } : {});
}

// A file of the app, read as text. Used by the checks that do not need a
// browser at all.
function source(name) {
  return fs.readFileSync(path.join(ROOT, name), "utf8");
}

// The tally. Every check prints only when it fails, so a passing run is one
// line and a failing one is exactly as long as the list of problems.
function tally() {
  var pass = 0;
  var fail = 0;
  return {
    ok: function (name, cond, extra) {
      if (cond) {
        pass++;
        return true;
      }
      fail++;
      console.log(" FAIL " + name +
        (extra === undefined ? "" : "  →  " + JSON.stringify(extra)));
      return false;
    },
    done: function () {
      console.log((fail ? "" : "all ") + pass + " checks passed" +
        (fail ? ", " + fail + " FAILED" : ""));
      process.exit(fail ? 1 : 0);
    }
  };
}

module.exports = { ROOT: ROOT, APP: APP, launch: launch, source: source, tally: tally };
