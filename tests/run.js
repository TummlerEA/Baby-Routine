"use strict";

// Runs every check, in every timezone worth trying, and says one line per run.
//
//   node tests/run.js                     everything, UTC and Pacific/Auckland
//   node tests/run.js leaps               only the files whose name matches
//   node tests/run.js --tz UTC            one timezone
//   node tests/run.js --tz UTC,Asia/Tokyo several
//
// Two timezones because almost every bug this app has had was a date bug, and
// a date bug hides perfectly in the zone the author happens to be in.
// Pacific/Auckland is the useful opposite of UTC: far enough ahead that "today"
// there is usually tomorrow here, which is what breaks a naive day boundary.

var fs = require("fs");
var path = require("path");
var spawn = require("child_process").spawnSync;

var args = process.argv.slice(2);
var zones = ["UTC", "Pacific/Auckland"];
var filter = null;

for (var i = 0; i < args.length; i++) {
  if (args[i] === "--tz") {
    zones = String(args[++i] || "").split(",").filter(Boolean);
  } else if (args[i].indexOf("--") !== 0) {
    filter = args[i];
  }
}

var files = fs.readdirSync(__dirname)
  .filter(function (f) { return /^test_.*\.js$/.test(f); })
  .filter(function (f) { return !filter || f.indexOf(filter) !== -1; })
  .sort();

if (!files.length) {
  console.error("No checks matched" + (filter ? " “" + filter + "”" : "") + ".");
  process.exit(2);
}

// The file-reading checks say the same thing whatever the clock is, so they
// run once rather than once per zone.
function needsAZone(file) {
  return file !== "test_version.js";
}

var failed = 0;
var ran = 0;

function run(file, zone) {
  var env = {};
  Object.keys(process.env).forEach(function (k) { env[k] = process.env[k]; });
  if (zone) env.TZ = zone;
  var label = file + (zone ? "  [" + zone + "]" : "");
  process.stdout.write(pad(label, 44));
  var started = Date.now();
  var out = spawn(process.execPath, [path.join(__dirname, file)],
    { env: env, encoding: "utf8" });
  var text = String(out.stdout || "") + String(out.stderr || "");
  var summary = (text.match(/^.*checks passed.*$/m) || [""])[0].trim();
  var took = Math.round((Date.now() - started) / 100) / 10;
  ran++;
  if (out.status === 0) {
    console.log(summary + "   " + took + "s");
  } else {
    failed++;
    console.log((summary || "did not finish") + "   " + took + "s");
    text.split("\n").forEach(function (line) {
      if (/ FAIL |Error|not found/.test(line)) console.log("    " + line.trim());
    });
  }
}

function pad(s, n) {
  while (s.length < n) s += " ";
  return s;
}

files.forEach(function (file) {
  if (needsAZone(file)) zones.forEach(function (zone) { run(file, zone); });
  else run(file, null);
});

console.log("");
console.log(failed
  ? failed + " of " + ran + " runs FAILED"
  : "all " + ran + " runs passed");
process.exit(failed ? 1 : 0);
