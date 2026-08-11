/* Baby Tracker. Free and open source under the MIT licence — see LICENSE.
   SPDX-License-Identifier: MIT */
(function () {
  "use strict";

  var EVENTS_KEY = "baby-tracker-events";
  var NAME_KEY = "baby-tracker-name";
  var INTERVALS_KEY = "baby-tracker-intervals";
  var DOB_KEY = "baby-tracker-dob";
  var META_STAMP_KEY = "baby-tracker-meta-updated";
  var SYNC_KEY = "baby-tracker-sync";
  var FEEDING_KEY = "baby-tracker-feeding";
  var PLANS_KEY = "baby-tracker-plans";
  var NAME_FONT_KEY = "baby-tracker-name-font";
  var SYNC_PATH = "baby-tracker-log.json";
  var SYNC_DEBOUNCE = 8000;
  var SYNC_POLL = 60000;
  var SYNC_RETRIES = 3;
  // One source of truth for the version on screen. It is read from this
  // script's own ?v= cache-busting query, so bumping the URL in index.html is
  // the only edit needed and the number shown can never disagree with the file
  // the browser actually loaded. Opened straight from disk there is no query,
  // which is what the fallback is for — a test keeps it level with the HTML.
  var APP_VERSION = (function () {
    var fallback = "30";
    var src = document.currentScript ? document.currentScript.src : "";
    var m = /[?&]v=([^&#]+)/.exec(src);
    return m ? decodeURIComponent(m[1]) : fallback;
  })();

  var MS_MIN = 60 * 1000;
  var VERSION_URL = "version.json";
  // Often enough that a phone left open all day learns about a release, rare
  // enough that returning to the app twenty times a night costs one request.
  var VERSION_CHECK_GAP = 15 * 60 * 1000;

  var MS_HOUR = 60 * MS_MIN;
  var MS_DAY = 24 * MS_HOUR;

  // How long a tombstone has to convince every device that an entry is gone.
  // Long enough that a phone left alone for weeks still learns about it,
  // short enough that the stored file does not carry deletions forever.
  // Must stay below MS_DAY: declared earlier it would quietly evaluate to NaN,
  // and every comparison against NaN is false, so nothing would ever expire.
  var TOMBSTONE_TTL = 30 * MS_DAY;

  // Gaps shorter than this come from an accidental double tap, not from a
  // real second event. Averaging them in drags the forecast hours off.
  var MIN_VALID_INTERVAL = 10 * MS_MIN;
  // An "active" sleep longer than this is almost certainly a wake-up that
  // nobody remembered to log.
  var SUSPICIOUS_SLEEP = 12 * MS_HOUR;
  var UNDO_TIMEOUT = 7000;
  var DEFAULT_EXPANDED_DAYS = 2;
  var FORECAST_SAMPLE = 5;

  // Predictions run off a plan the parent sets, not off whatever the last
  // few gaps happened to be. Stored in minutes.
  var DEFAULT_INTERVALS = { feed: 180, diaper: 180, sleep: 180 };
  var INTERVAL_CHOICES = [60, 90, 120, 150, 180, 210, 240, 300, 360, 480, 600, 720];
  var CHIP_CHOICES = [120, 180, 240, 360, 480];
  var KINDS = ["feed", "diaper", "sleep"];
  var KIND_META = {
    feed: { label: "Feed", icon: "🍼", logged: "Feed logged" },
    diaper: { label: "Nappy", icon: "🧷", logged: "Nappy logged" },
    sleep: { label: "Sleep", icon: "🌙", logged: "Sleep logged" }
  };
  // Optional detail on a nappy change. Absent means nobody recorded it.
  var NAPPY_TYPES = {
    wet:   { label: "Wee",       chip: "💧 Wee",  detail: "💧 Wee" },
    dirty: { label: "Poo",       chip: "💩 Poo",  detail: "💩 Poo" },
    both:  { label: "Wee & poo", chip: "Both",    detail: "💧💩 Wee & poo" },
    dry:   { label: "Dry",       chip: "Dry",     detail: "Dry" }
  };
  var NAPPY_ORDER = ["wet", "dirty", "both", "dry"];

  // How long a feed took, offered as one tap after the feed is already saved.
  // Denser at the short end because that is where feeds actually land; a
  // parent who needs 35 minutes exactly has the manual form. Absent means
  // nobody answered, the same as the nappy detail, and never means zero.
  var FEED_MINUTES = [10, 15, 20, 30, 45, 60];
  // Only until the log can suggest the parent's own figure instead.
  var FEED_MINUTES_DEFAULT = 20;
  // Index 0 is "not recorded", so a share link that predates this column
  // reads as absent rather than as breast.
  var FEED_SOURCE_IDS = ["", "breast", "formula", "expressed"];

  // What is coming up. Kept in its own list rather than among the entries: the
  // log is a record of what happened, and teaching the forecast, the day
  // summaries, the history and every export to filter out the future would
  // touch far more than it is worth.
  var PLAN_TITLES = [
    "Midwife", "Health visitor", "GP", "Immunisations", "Weigh-in", "Scan", "Nursery"
  ];
  var MAX_PLAN_TITLE = 60;
  var MAX_PLAN_PLACE = 60;
  var MAX_PLAN_NOTE = 200;
  // A past appointment stops being useful long before it stops being true.
  var PLAN_PAST_SHOWN = 30 * MS_DAY;

  // The routine NHS schedule for a baby's first year, in weeks from birth.
  // Offered as a starting point to edit, never as a substitute for the letter
  // that actually arrives — the app says so on the button.
  var IMMUNISATION_WEEKS = [
    { weeks: 8,  label: "Immunisations — 8 weeks" },
    { weeks: 12, label: "Immunisations — 12 weeks" },
    { weeks: 16, label: "Immunisations — 16 weeks" },
    { weeks: 52, label: "Immunisations — 1 year" }
  ];

  // How the baby is fed. A standing fact about the baby rather than something
  // to answer at every feed, so it lives in Settings — but the first thing any
  // adviser asks, which is why it is worth carrying at all.
  // `fallsBackTo` is what a new feed is stamped with unless the parent says
  // otherwise on the card. Mixed has no single answer, so it asks and stamps
  // nothing; "prefer not to say" switches the whole question off.
  var FEEDING_OPTIONS = [
    { id: "",          label: "Prefer not to say", summary: "",                                       fallsBackTo: "", asks: false },
    { id: "breast",    label: "Breastfed",         summary: "breastfed",                              fallsBackTo: "breast",    asks: true },
    { id: "formula",   label: "Formula fed",       summary: "formula fed",                            fallsBackTo: "formula",   asks: true },
    { id: "mixed",     label: "Mixed — both",      summary: "mixed feeding, breast and formula",      fallsBackTo: "",          asks: true },
    { id: "expressed", label: "Expressed milk",    summary: "expressed breast milk, from a bottle",   fallsBackTo: "expressed", asks: true }
  ];

  // What one feed was. Stamped when the feed is logged rather than read back
  // through the setting, so changing the regime later cannot rewrite what
  // already happened.
  var FEED_SOURCES = [
    { id: "breast",    label: "Breast",    detail: "🤱 Breast" },
    { id: "formula",   label: "Formula",   detail: "🍼 Formula" },
    { id: "expressed", label: "Expressed", detail: "🥛 Expressed" }
  ];

  // How the baby's name is set on the main screen. Only system typefaces: a
  // web font would mean an external request, which this app does not make.
  // `probe` names the faces worth having — an entry with none is always on
  // offer, because its stack ends in a generic every device can satisfy.
  var NAME_FONTS = [
    { id: "classic",   label: "Classic",   probe: [] },
    { id: "plain",     label: "Plain",     probe: [] },
    { id: "storybook", label: "Storybook", probe: [] },
    { id: "elegant",   label: "Elegant",   probe: ["Didot", "Bodoni 72", "Hoefler Text"] },
    { id: "script",    label: "Script",    probe: ["Snell Roundhand", "Apple Chancery", "Segoe Script"] },
    { id: "delicate",  label: "Delicate",  probe: ["Savoye LET", "Snell Roundhand"] },
    { id: "flourish",  label: "Flourish",  probe: ["Zapfino"] },
    { id: "hand",      label: "Handwritten", probe: ["Bradley Hand", "Noteworthy", "Segoe Script"] }
  ];
  var DEFAULT_NAME_FONT = "classic";

  // Handing the log to an assistant the parent already pays for, rather than
  // building one in. There is no key, no account and no bill attached to this
  // app, and nothing is sent until they have read the exact text and tapped a
  // service. `param` carries the question in the URL where it fits; anything
  // longer goes via the clipboard, which is why the preview box is not
  // decorative — it is the fallback when both of those fail.
  var AI_TARGETS = [
    { id: "claude",     label: "Claude",     url: "https://claude.ai/new",            param: "q" },
    { id: "chatgpt",    label: "ChatGPT",    url: "https://chatgpt.com/",             param: "q" },
    { id: "perplexity", label: "Perplexity", url: "https://www.perplexity.ai/search", param: "q" }
  ];
  // Browsers carry far longer URLs than this; the limit that matters is the
  // receiving service quietly truncating one, which would hand the model half
  // a summary and tell nobody. This sits well under anything they are known to
  // baulk at, and a fortnight of entries still fits inside it.
  var AI_URL_LIMIT = 4000;
  var AI_KEY = "baby-tracker-ai";
  var AI_DEFAULT_DAYS = 3;
  var AI_MAX_QUESTION = 500;
  var AI_MAX_FREEFORM = 8;
  // What counts as overnight, in local hours: from 19:00 to 05:00.
  var AI_NIGHT_FROM = 19;
  var AI_NIGHT_TO = 5;
  // Far enough ahead to plan a week around, near enough to stay relevant.
  var AI_PLAN_HORIZON = 28 * MS_DAY;
  var AI_MAX_PLANS = 6;
  // Three is enough to show the rhythm and where the night falls.
  var AI_EXPECTED_AHEAD = 3;
  var AI_FALLBACK_QUESTION = "What stands out in this, and is there anything I should keep an eye on?";
  // Openers worth a tap at 3am, when composing a question is the hard part.
  var AI_SUGGESTIONS = [
    "Is this normal for this age?",
    "Is the baby feeding enough?",
    "Why so many night wakings?",
    "What changed this week?"
  ];
  var NEXTUP_TIMEOUT = 20000;
  // Only flag the gap between plan and reality once it is worth mentioning.
  var DRIFT_TOLERANCE = 0.25;

  // Measurements are ordinary events with a numeric value. They deliberately
  // stay out of KINDS: predicting "next weight in 3h" would be nonsense.
  var MEASURES = {
    weight: { label: "Weight", icon: "⚖️", unit: "g",  step: "10",  max: 30000, decimals: 0 },
    height: { label: "Length", icon: "📏", unit: "cm", step: "0.5", max: 150,   decimals: 1 },
    temp:   { label: "Temperature", icon: "🌡", unit: "°C", step: "0.1", max: 45, decimals: 1 },
    head:   { label: "Head circumference", icon: "🧢", unit: "cm", step: "0.1", max: 70, decimals: 1 },
    // Anything a clinic hands you a number for. The parent supplies the name
    // and the unit; the app records and shows it and interprets nothing.
    other:  { label: "Something else", icon: "🔬", unit: "", step: "any", max: 1000000, decimals: 2, freeform: true }
  };
  var MEASURE_ORDER = ["weight", "height", "head", "temp", "other"];
  var MAX_LABEL = 40;
  var MAX_UNIT = 12;

  // Mirrors the guidance already in the app, which follows NHS advice.
  var FEVER_UNDER_3M = 38;
  var FEVER_OVER_3M = 39;
  var LOW_TEMP = 36;
  var FEVER_BANNER_MAX_AGE = 6 * 60 * 60 * 1000;

  var TYPE_META = {
    feed: { label: "Feed", icon: "🍼" },
    diaper: { label: "Nappy", icon: "🧷" },
    sleep_start: { label: "Fell asleep", icon: "🌙" },
    sleep_end: { label: "Woke up", icon: "☀️" },
    weight: { label: "Weight", icon: "⚖️" },
    height: { label: "Length", icon: "📏" },
    temp: { label: "Temperature", icon: "🌡" },
    head: { label: "Head circumference", icon: "🧢" },
    other: { label: "Measurement", icon: "🔬" }
  };

  var WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  // ---------- storage ----------

  function loadEvents() {
    try {
      var raw = localStorage.getItem(EVENTS_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveEvents(list) {
    try {
      localStorage.setItem(EVENTS_KEY, JSON.stringify(list));
      hideError();
      scheduleSync();
      return true;
    } catch (e) {
      showError("Couldn't save your data");
      return false;
    }
  }

  function loadName() {
    try {
      return localStorage.getItem(NAME_KEY) || "";
    } catch (e) {
      return "";
    }
  }

  function saveName(name) {
    try {
      localStorage.setItem(NAME_KEY, name);
      touchMeta();
      hideError();
      scheduleSync();
    } catch (e) {
      showError("Couldn't save the name");
    }
  }

  function loadIntervals() {
    var stored = null;
    try {
      var raw = localStorage.getItem(INTERVALS_KEY);
      stored = raw ? JSON.parse(raw) : null;
    } catch (e) {
      stored = null;
    }
    var out = {};
    KINDS.forEach(function (kind) {
      var value = stored ? Number(stored[kind]) : NaN;
      out[kind] = (value > 0 && value <= 24 * 60) ? Math.round(value) : DEFAULT_INTERVALS[kind];
    });
    return out;
  }

  function saveIntervals() {
    try {
      localStorage.setItem(INTERVALS_KEY, JSON.stringify(intervals));
      touchMeta();
      hideError();
      scheduleSync();
      return true;
    } catch (e) {
      showError("Couldn't save your settings");
      return false;
    }
  }

  function loadDob() {
    try {
      return localStorage.getItem(DOB_KEY) || "";
    } catch (e) {
      return "";
    }
  }

  function loadPlans() {
    try {
      var raw = localStorage.getItem(PLANS_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      showError("Couldn't read your saved appointments");
      return [];
    }
  }

  function savePlans(list) {
    try {
      localStorage.setItem(PLANS_KEY, JSON.stringify(list));
      hideError();
      scheduleSync();
      return true;
    } catch (e) {
      showError("Couldn't save — this browser's storage is full");
      return false;
    }
  }

  function feedingOption(id) {
    for (var i = 0; i < FEEDING_OPTIONS.length; i++) {
      if (FEEDING_OPTIONS[i].id === id) return FEEDING_OPTIONS[i];
    }
    return null;
  }

  function loadFeeding() {
    var raw = localStorage.getItem(FEEDING_KEY) || "";
    return feedingOption(raw) ? raw : "";
  }

  function saveFeeding(value) {
    try {
      if (value) localStorage.setItem(FEEDING_KEY, value);
      else localStorage.removeItem(FEEDING_KEY);
      touchMeta();
      hideError();
      scheduleSync();
    } catch (e) {
      showError("Couldn't save how your baby is fed");
    }
  }

  function saveDob(value) {
    try {
      if (value) localStorage.setItem(DOB_KEY, value);
      else localStorage.removeItem(DOB_KEY);
      touchMeta();
      hideError();
      scheduleSync();
    } catch (e) {
      showError("Couldn't save the date of birth");
    }
  }

  // Midnight local on the day of birth, or null when it is not set.
  function dobDate() {
    var raw = loadDob();
    if (!raw) return null;
    var parts = raw.split("-");
    if (parts.length !== 3) return null;
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return isNaN(d.getTime()) ? null : d;
  }

  function ageDaysAt(time) {
    var dob = dobDate();
    if (!dob) return null;
    var at = new Date(time);
    var midnight = new Date(at.getFullYear(), at.getMonth(), at.getDate());
    return Math.floor((midnight - dob) / MS_DAY);
  }

  function formatAge(days) {
    if (days === null || days < 0) return "";
    if (days < 14) return "day " + days;
    var weeks = Math.floor(days / 7);
    var rest = days % 7;
    if (weeks < 9) {
      return weeks + (weeks === 1 ? " week" : " weeks") + (rest ? " " + rest + (rest === 1 ? " day" : " days") : "");
    }
    var months = Math.floor(days / 30.44);
    return months + (months === 1 ? " month" : " months");
  }

  // Name, date of birth and intervals travel together and change rarely, so a
  // single timestamp for the group decides which side wins.
  function metaStamp() {
    try {
      return localStorage.getItem(META_STAMP_KEY) || "1970-01-01T00:00:00.000Z";
    } catch (e) {
      return "1970-01-01T00:00:00.000Z";
    }
  }

  function setMetaStamp(iso) {
    try {
      localStorage.setItem(META_STAMP_KEY, iso);
    } catch (e) { /* nothing worth reporting */ }
  }

  function touchMeta() {
    try {
      localStorage.setItem(META_STAMP_KEY, new Date().toISOString());
    } catch (e) { /* the write that mattered has already reported failure */ }
  }

  // Deliberately not carried by sync, backup or a share link: whether this
  // phone is willing to send anything outwards is that phone's own business,
  // and it should never arrive switched on from somewhere else.
  function loadAiPrefs() {
    try {
      var raw = localStorage.getItem(AI_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || typeof parsed !== "object") return { on: false, name: false };
      return { on: parsed.on === true, name: parsed.name === true };
    } catch (e) {
      return { on: false, name: false };
    }
  }

  function saveAiPrefs(prefs) {
    try {
      localStorage.setItem(AI_KEY, JSON.stringify({ on: !!prefs.on, name: !!prefs.name }));
    } catch (e) {
      showError("Couldn't save that setting");
    }
  }

  function loadSyncConfig() {
    try {
      var raw = localStorage.getItem(SYNC_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || !parsed.repo || !parsed.token) return null;
      return { repo: String(parsed.repo), token: String(parsed.token), sha: parsed.sha || null };
    } catch (e) {
      return null;
    }
  }

  function saveSyncConfig(config) {
    try {
      if (config) localStorage.setItem(SYNC_KEY, JSON.stringify(config));
      else localStorage.removeItem(SYNC_KEY);
      return true;
    } catch (e) {
      showError("Couldn't save the sync settings");
      return false;
    }
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  var events = loadEvents();
  var prunedOnLoad = 0;

  // Two phones both writing means the log has to merge cleanly in any order.
  // Every record carries when it last changed, and deleting marks a record
  // rather than dropping it — a dropped row is indistinguishable from one the
  // other device has not seen yet, and would come back to life on the next
  // import.
  function touch(event) {
    event.updatedAt = new Date().toISOString();
    return event;
  }

  function isDeleted(event) {
    return !!(event && event.deleted);
  }

  // A tombstone only has to say "this id is gone". Keeping the reading, the
  // nappy detail or the one-off gap alongside it would store the contents of
  // something the parent deliberately deleted, and sync it to the repository
  // on top of that.
  function stripToTombstone(event) {
    var carried = { nappy: event.nappy, value: event.value, nextMin: event.nextMin,
      label: event.label, unit: event.unit, fedMin: event.fedMin, fedWith: event.fedWith };
    delete event.nappy;
    delete event.value;
    delete event.nextMin;
    delete event.label;
    delete event.unit;
    delete event.fedMin;
    delete event.fedWith;
    event.deleted = true;
    return carried;
  }

  function restoreFromTombstone(event, carried) {
    delete event.deleted;
    if (carried.nappy !== undefined) event.nappy = carried.nappy;
    if (carried.value !== undefined) event.value = carried.value;
    if (carried.nextMin !== undefined) event.nextMin = carried.nextMin;
    if (carried.label !== undefined) event.label = carried.label;
    if (carried.unit !== undefined) event.unit = carried.unit;
    if (carried.fedMin !== undefined) event.fedMin = carried.fedMin;
    if (carried.fedWith !== undefined) event.fedWith = carried.fedWith;
  }

  function tombstoneExpired(event) {
    return isDeleted(event) && (Date.now() - new Date(updatedAtOf(event)) > TOMBSTONE_TTL);
  }

  // Every device applies the same rule to the same timestamps, so they all
  // drop the same tombstones and nobody pushes them back at anyone.
  function pruneTombstones() {
    var before = events.length;
    events = events.filter(function (e) { return !tombstoneExpired(e); });
    return before - events.length;
  }

  function updatedAtOf(event) {
    // Records written before this existed fall back to their own timestamp.
    return event.updatedAt || event.time;
  }

  // Everything the app shows works from this; only sync and backup see the
  // tombstones.
  function liveEvents() {
    return events.filter(function (e) { return !isDeleted(e); });
  }

  function pruneOnStartup() {
    prunedOnLoad = pruneTombstones();
    if (prunedOnLoad) saveEvents(events);
  }
  var intervals = loadIntervals();

  // ---------- dom ----------

  var el = {
    topDate: document.getElementById("topDate"),
    topClock: document.getElementById("topClock"),
    babyName: document.getElementById("babyName"),
    errorBanner: document.getElementById("errorBanner"),
    errorText: document.getElementById("errorText"),
    errorClose: document.getElementById("errorClose"),
    sleepBanner: document.getElementById("sleepBanner"),
    sleepDuration: document.getElementById("sleepDuration"),
    sleepWarning: document.getElementById("sleepWarning"),
    tempBanner: document.getElementById("tempBanner"),
    tempBannerLine: document.getElementById("tempBannerLine"),
    tempBannerAdvice: document.getElementById("tempBannerAdvice"),
    measureToggle: document.getElementById("measureToggle"),
    measureToggleText: document.getElementById("measureToggleText"),
    measurePanel: document.getElementById("measurePanel"),
    measureCards: document.getElementById("measureCards"),
    manualValueField: document.getElementById("manualValueField"),
    manualValueLabel: document.getElementById("manualValueLabel"),
    manualValue: document.getElementById("manualValue"),
    manualValueEcho: document.getElementById("manualValueEcho"),
    manualLabelField: document.getElementById("manualLabelField"),
    manualMeasureLabel: document.getElementById("manualMeasureLabel"),
    manualLabelSuggest: document.getElementById("manualLabelSuggest"),
    manualUnitField: document.getElementById("manualUnitField"),
    manualMeasureUnit: document.getElementById("manualMeasureUnit"),
    babyDob: document.getElementById("babyDob"),
    babyFeeding: document.getElementById("babyFeeding"),
    babyDobEcho: document.getElementById("babyDobEcho"),
    btnFeed: document.getElementById("btnFeed"),
    btnDiaper: document.getElementById("btnDiaper"),
    btnSleep: document.getElementById("btnSleep"),
    sleepLabel: document.getElementById("sleepLabel"),
    forecastList: document.getElementById("forecastList"),
    nextUp: document.getElementById("nextUp"),
    nextUpTitle: document.getElementById("nextUpTitle"),
    nextUpLine: document.getElementById("nextUpLine"),
    nextUpChips: document.getElementById("nextUpChips"),
    sourceBlock: document.getElementById("sourceBlock"),
    sourceChips: document.getElementById("sourceChips"),
    feedBlock: document.getElementById("feedBlock"),
    feedChips: document.getElementById("feedChips"),
    nappyBlock: document.getElementById("nappyBlock"),
    nappyChips: document.getElementById("nappyChips"),
    manualSourceField: document.getElementById("manualSourceField"),
    manualSource: document.getElementById("manualSource"),
    manualFedField: document.getElementById("manualFedField"),
    manualFed: document.getElementById("manualFed"),
    manualNappyField: document.getElementById("manualNappyField"),
    manualNappy: document.getElementById("manualNappy"),
    nextUpClose: document.getElementById("nextUpClose"),
    logToggle: document.getElementById("logToggle"),
    logToggleText: document.getElementById("logToggleText"),
    logList: document.getElementById("logList"),
    manualToggle: document.getElementById("manualToggle"),
    manualToggleText: document.getElementById("manualToggleText"),
    manualPanel: document.getElementById("manualPanel"),
    manualTitle: document.getElementById("manualTitle"),
    manualType: document.getElementById("manualType"),
    manualDateTime: document.getElementById("manualDateTime"),
    manualError: document.getElementById("manualError"),
    manualSubmit: document.getElementById("manualSubmit"),
    manualCancel: document.getElementById("manualCancel"),
    screenInfo: document.getElementById("screenInfo"),
    syncStatus: document.getElementById("syncStatus"),
    syncRepo: document.getElementById("syncRepo"),
    syncToken: document.getElementById("syncToken"),
    syncConnect: document.getElementById("syncConnect"),
    syncNow: document.getElementById("syncNow"),
    syncDisconnect: document.getElementById("syncDisconnect"),
    infoOpenBtn: document.getElementById("infoOpen"),
    infoBack: document.getElementById("infoBack"),
    gettingStarted: document.getElementById("gettingStarted"),
    gsMore: document.getElementById("gsMore"),
    sharedIn: document.getElementById("sharedIn"),
    sharedLine: document.getElementById("sharedLine"),
    sharedMerge: document.getElementById("sharedMerge"),
    sharedDiscard: document.getElementById("sharedDiscard"),
    shareRange: document.getElementById("shareRange"),
    shareCreate: document.getElementById("shareCreate"),
    inviteCreate: document.getElementById("inviteCreate"),
    sharedTip: document.getElementById("sharedTip"),
    sharedCopy: document.getElementById("sharedCopy"),
    pasteBox: document.getElementById("pasteBox"),
    pasteMerge: document.getElementById("pasteMerge"),
    shareSend: document.getElementById("shareSend"),
    shareStatus: document.getElementById("shareStatus"),
    shareBox: document.getElementById("shareBox"),
    screenMain: document.getElementById("screenMain"),
    screenSettings: document.getElementById("screenSettings"),
    screenAi: document.getElementById("screenAi"),
    screenPlan: document.getElementById("screenPlan"),
    planOpenBtn: document.getElementById("planOpen"),
    planBack: document.getElementById("planBack"),
    planSoon: document.getElementById("planSoon"),
    planSoonBtn: document.getElementById("planSoonBtn"),
    planSoonText: document.getElementById("planSoonText"),
    planAddToggle: document.getElementById("planAddToggle"),
    planAddToggleText: document.getElementById("planAddToggleText"),
    planForm: document.getElementById("planForm"),
    planChips: document.getElementById("planChips"),
    planTitle: document.getElementById("planTitle"),
    planDate: document.getElementById("planDate"),
    planTime: document.getElementById("planTime"),
    planPlace: document.getElementById("planPlace"),
    planNote: document.getElementById("planNote"),
    planError: document.getElementById("planError"),
    planSubmit: document.getElementById("planSubmit"),
    planCancel: document.getElementById("planCancel"),
    planList: document.getElementById("planList"),
    planJabs: document.getElementById("planJabs"),
    aiRow: document.getElementById("aiRow"),
    aiOpen: document.getElementById("aiOpen"),
    aiBack: document.getElementById("aiBack"),
    aiQuestion: document.getElementById("aiQuestion"),
    aiChips: document.getElementById("aiChips"),
    aiRange: document.getElementById("aiRange"),
    aiPreview: document.getElementById("aiPreview"),
    aiSize: document.getElementById("aiSize"),
    aiTargets: document.getElementById("aiTargets"),
    aiCopy: document.getElementById("aiCopy"),
    aiEnabled: document.getElementById("aiEnabled"),
    aiUseName: document.getElementById("aiUseName"),
    settingsOpenBtn: document.getElementById("settingsOpen"),
    settingsBack: document.getElementById("settingsBack"),
    babyNameDisplay: document.getElementById("babyNameDisplay"),
    nameFonts: document.getElementById("nameFonts"),
    nameFontsToggle: document.getElementById("nameFontsToggle"),
    nameFontsPanel: document.getElementById("nameFontsPanel"),
    nameFontsCurrent: document.getElementById("nameFontsCurrent"),
    exportCsv: document.getElementById("exportCsv"),
    exportMd: document.getElementById("exportMd"),
    exportJson: document.getElementById("exportJson"),
    importBtn: document.getElementById("importBtn"),
    importFile: document.getElementById("importFile"),
    appVersion: document.getElementById("appVersion"),
    updateBanner: document.getElementById("updateBanner"),
    updateVersion: document.getElementById("updateVersion"),
    updateReload: document.getElementById("updateReload"),
    updateDismiss: document.getElementById("updateDismiss"),
    settingsVersion: document.getElementById("settingsVersion"),
    settingsZone: document.getElementById("settingsZone"),
    toast: document.getElementById("toast"),
    toastText: document.getElementById("toastText"),
    toastAction: document.getElementById("toastAction")
  };

  var logOpen = false;
  var manualOpen = false;
  var measureOpen = false;
  var editingId = null;
  var expandedDays = {};
  var lastLogDayKey = null;

  // ---------- helpers ----------

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function showError(msg) {
    el.errorText.textContent = msg;
    el.errorBanner.hidden = false;
  }

  function hideError() {
    el.errorBanner.hidden = true;
  }

  // It is fixed over the top bar, so it must be possible to get rid of.
  el.errorClose.addEventListener("click", hideError);

  function sortedByTimeAsc(list) {
    return list.slice().sort(function (a, b) {
      return new Date(a.time) - new Date(b.time);
    });
  }

  function sortedByTimeDesc(list) {
    return list.slice().sort(function (a, b) {
      return new Date(b.time) - new Date(a.time);
    });
  }

  function median(nums) {
    var s = nums.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  // One decimal, but no ".0" hanging off a whole number.
  function perDay(total, days) {
    var value = total / days;
    return String(Math.round(value * 10) / 10);
  }

  function formatDuration(ms) {
    if (ms < 0) ms = 0;
    var totalMin = Math.floor(ms / MS_MIN);
    var h = Math.floor(totalMin / 60);
    var m = totalMin % 60;
    if (h <= 0) return m + "m";
    if (m === 0) return h + "h";
    return h + "h " + m + "m";
  }

  function formatClockTime(date) {
    return pad2(date.getHours()) + ":" + pad2(date.getMinutes());
  }

  function toDateTimeLocalValue(date) {
    return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate()) +
      "T" + pad2(date.getHours()) + ":" + pad2(date.getMinutes());
  }

  function formatDateTimeLocal(date) {
    return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate()) +
      " " + pad2(date.getHours()) + ":" + pad2(date.getMinutes());
  }

  function dayKeyOf(date) {
    return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate());
  }

  function formatDateHeader(date) {
    return WEEKDAYS[date.getDay()] + ", " + date.getDate() + " " + MONTHS[date.getMonth()];
  }

  // Same clock time, but says which day it lands on when that is not today.
  function formatWhen(date) {
    var now = new Date();
    var key = dayKeyOf(date);
    var time = formatClockTime(date);
    if (key === dayKeyOf(now)) return time;
    if (key === dayKeyOf(new Date(now.getTime() + MS_DAY))) return "tomorrow " + time;
    if (key === dayKeyOf(new Date(now.getTime() - MS_DAY))) return "yesterday " + time;
    return date.getDate() + " " + MONTHS[date.getMonth()] + " " + time;
  }

  function dayLabel(date) {
    var now = new Date();
    var key = dayKeyOf(date);
    if (key === dayKeyOf(now)) return "Today";
    if (key === dayKeyOf(new Date(now.getTime() - MS_DAY))) return "Yesterday";
    return formatDateHeader(date);
  }

  function formatMeasure(type, value, unit) {
    if (type === "other") {
      var shown = Number(value.toFixed(2));
      return unit ? shown + " " + unit : String(shown);
    }
    if (type === "weight") {
      // 3470 -> "3.47 kg", 3200 -> "3.2 kg", 3000 -> "3 kg"
      return String(Math.round(value) / 1000) + " kg";
    }
    var meta = MEASURES[type];
    if (!meta) return String(value);
    return value.toFixed(meta.decimals) + " " + meta.unit;
  }

  // Birth weights get quoted in pounds and ounces constantly in the UK.
  function formatImperial(grams) {
    var totalOunces = grams / 28.349523125;
    var pounds = Math.floor(totalOunces / 16);
    var ounces = Math.round(totalOunces - pounds * 16);
    if (ounces === 16) {
      pounds += 1;
      ounces = 0;
    }
    return pounds + " lb " + ounces + " oz";
  }

  function cleanText(value, limit) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, limit);
  }

  function measureLabelOf(event) {
    return (event && MEASURES[event.type] && MEASURES[event.type].freeform)
      ? cleanText(event.label, MAX_LABEL) : "";
  }

  function measureUnitOf(event) {
    return (event && MEASURES[event.type] && MEASURES[event.type].freeform)
      ? cleanText(event.unit, MAX_UNIT) : "";
  }

  // Labels the parent has already used, most recent first, offered back so a
  // repeat reading takes one tap instead of retyping.
  function knownMeasureLabels() {
    var seen = {};
    var out = [];
    sortedByTimeDesc(liveEvents()).forEach(function (e) {
      var label = measureLabelOf(e);
      if (!label) return;
      var key = label.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      out.push({ label: label, unit: measureUnitOf(e) });
    });
    return out;
  }

  function measureValueOf(event) {
    if (!event || !MEASURES[event.type]) return null;
    var value = Number(event.value);
    return (isFinite(value) && value > 0) ? value : null;
  }

  function measurementsOf(type, label) {
    return sortedByTimeAsc(liveEvents().filter(function (e) {
      if (e.type !== type || measureValueOf(e) === null) return false;
      if (label === undefined) return true;
      return measureLabelOf(e).toLowerCase() === label.toLowerCase();
    }));
  }

  function feverThresholdAt(time) {
    var days = ageDaysAt(time);
    // Without a date of birth, assume the youngest and therefore lowest bar.
    if (days === null) return FEVER_UNDER_3M;
    return days < 92 ? FEVER_UNDER_3M : FEVER_OVER_3M;
  }

  function temperatureConcern(event) {
    var value = measureValueOf(event);
    if (value === null || event.type !== "temp") return null;
    var threshold = feverThresholdAt(event.time);
    if (value >= threshold) {
      return {
        level: "high",
        headline: formatMeasure("temp", value) + " is a high temperature",
        advice: ageDaysAt(event.time) === null
          ? "At 38°C or above in a baby under 3 months, call 999. Set the date of birth in Settings and this will use the right threshold for your baby's age."
          : "Call 999 straight away for a baby this age. For anything less urgent, call NHS 111."
      };
    }
    if (value < LOW_TEMP) {
      return {
        level: "low",
        headline: formatMeasure("temp", value) + " is low",
        advice: "A temperature below 36°C in a baby needs checking — call NHS 111, or 999 if they are also floppy, pale or hard to wake."
      };
    }
    return null;
  }

  function eventTypeLabel(type) {
    return TYPE_META[type] ? TYPE_META[type].label : type;
  }

  function eventTypeIcon(type) {
    return TYPE_META[type] ? TYPE_META[type].icon : "•";
  }

  // ---------- sleep pairing ----------

  // Walks sleep events in order and pairs each "fell asleep" with the
  // "woke up" that follows it. Unpaired records are flagged so they can be spotted and
  // fixed in the log instead of silently skewing everything.
  function analyzeSleep() {
    var asc = sortedByTimeAsc(liveEvents().filter(function (e) {
      return e.type === "sleep_start" || e.type === "sleep_end";
    }));
    var sessions = [];
    var durationById = {};
    var warningById = {};
    var open = null;

    asc.forEach(function (e) {
      if (e.type === "sleep_start") {
        if (open) warningById[open.id] = "No matching \u2018Woke up\u2019 entry";
        open = e;
      } else {
        if (!open) {
          warningById[e.id] = "No matching \u2018Fell asleep\u2019 entry";
        } else {
          var startMs = +new Date(open.time);
          var endMs = +new Date(e.time);
          sessions.push({ startMs: startMs, endMs: endMs });
          durationById[open.id] = endMs - startMs;
          durationById[e.id] = endMs - startMs;
          open = null;
        }
      }
    });

    return { sessions: sessions, active: open, durationById: durationById, warningById: warningById };
  }

  function isSleepingNow() {
    return !!analyzeSleep().active;
  }

  function sleepMsInRange(analysis, fromMs, toMs, nowMs) {
    var total = 0;
    analysis.sessions.forEach(function (s) {
      total += Math.max(0, Math.min(s.endMs, toMs) - Math.max(s.startMs, fromMs));
    });
    if (analysis.active) {
      var aStart = +new Date(analysis.active.time);
      total += Math.max(0, Math.min(nowMs, toMs) - Math.max(aStart, fromMs));
    }
    return total;
  }

  // ---------- forecast ----------

  function eventsOfKind(kind) {
    return kind === "sleep"
      ? liveEvents().filter(function (e) { return e.type === "sleep_start"; })
      : liveEvents().filter(function (e) { return e.type === kind; });
  }

  // What actually happened, kept only so the plan can be checked against
  // reality. Median, not mean, so one long night does not dominate.
  function observedIntervalMs(kind) {
    var asc = sortedByTimeAsc(eventsOfKind(kind));
    var gaps = [];
    for (var i = 1; i < asc.length; i++) {
      var gap = new Date(asc[i].time) - new Date(asc[i - 1].time);
      if (gap >= MIN_VALID_INTERVAL) gaps.push(gap);
    }
    var lastN = gaps.slice(-FORECAST_SAMPLE);
    return lastN.length ? median(lastN) : null;
  }

  function nappyOf(event) {
    return (event && NAPPY_TYPES[event.nappy]) ? event.nappy : null;
  }

  function feedSource(id) {
    for (var i = 0; i < FEED_SOURCES.length; i++) {
      if (FEED_SOURCES[i].id === id) return FEED_SOURCES[i];
    }
    return null;
  }

  function fedWithOf(event) {
    if (!event || event.type !== "feed") return "";
    return feedSource(event.fedWith) ? event.fedWith : "";
  }

  function defaultFedWith() {
    var regime = feedingOption(loadFeeding());
    return regime ? regime.fallsBackTo : "";
  }

  function asksFedWith() {
    var regime = feedingOption(loadFeeding());
    return !!(regime && regime.asks);
  }

  function fedMinutesOf(event) {
    if (!event || event.type !== "feed") return null;
    var value = Number(event.fedMin);
    return (value > 0 && value <= 24 * 60) ? Math.round(value) : null;
  }

  // The chip to suggest: the parent's own recent middle, once there is one.
  // Rounded to whichever chip is nearest, so the suggestion is always a chip
  // that exists rather than a seventh option nobody can tap.
  function suggestedFeedMinutes() {
    var recorded = [];
    sortedByTimeDesc(liveEvents()).forEach(function (e) {
      var mins = fedMinutesOf(e);
      if (mins !== null && recorded.length < FORECAST_SAMPLE) recorded.push(mins);
    });
    if (!recorded.length) return FEED_MINUTES_DEFAULT;
    var middle = median(recorded);
    var best = FEED_MINUTES[0];
    FEED_MINUTES.forEach(function (mins) {
      if (Math.abs(mins - middle) < Math.abs(best - middle)) best = mins;
    });
    return best;
  }

  function customMinutesOf(event) {
    var value = event && Number(event.nextMin);
    return (value > 0 && value <= 24 * 60) ? Math.round(value) : null;
  }

  function plannedMinutesFor(kind, lastEvent) {
    return customMinutesOf(lastEvent) || intervals[kind];
  }

  function computeForecast(kind) {
    var ofKind = eventsOfKind(kind);
    var lastEvent = ofKind.length ? sortedByTimeDesc(ofKind)[0] : null;
    var plannedMin = plannedMinutesFor(kind, lastEvent);
    var baseTime = lastEvent ? new Date(lastEvent.time) : new Date();

    return {
      hasData: !!lastEvent,
      plannedMin: plannedMin,
      isCustom: !!customMinutesOf(lastEvent),
      observedMs: observedIntervalMs(kind),
      nextTime: new Date(baseTime.getTime() + plannedMin * MS_MIN)
    };
  }

  function renderForecast() {
    var now = new Date();
    var items = [
      { kind: "feed", icon: "🍼", label: "Feed" },
      { kind: "diaper", icon: "🧷", label: "Nappy" },
      { kind: "sleep", icon: "🌙", label: "Sleep" }
    ];
    var sleeping = isSleepingNow();

    el.forecastList.innerHTML = "";
    items.forEach(function (item) {
      var div = document.createElement("div");
      div.className = "forecast-item";

      if (item.kind === "sleep" && sleeping) {
        div.innerHTML =
          '<span class="f-icon">' + item.icon + '</span>' +
          '<div class="f-body">' +
            '<div class="f-type">' + item.label + '</div>' +
            '<div class="f-time">asleep right now</div>' +
          '</div>';
        el.forecastList.appendChild(div);
        return;
      }

      var f = computeForecast(item.kind);
      var diff = f.nextTime - now;

      var timeHtml = diff < 0
        ? '<span class="f-time overdue">overdue by ' + formatDuration(-diff) + '</span>'
        : '<span class="f-time">in ' + formatDuration(diff) + '</span>';
      if (!f.hasData) timeHtml += ' <span class="f-estimate-tag">(nothing logged yet)</span>';

      var note = f.isCustom
        ? '<span class="f-custom">one-off ' + formatDuration(f.plannedMin * MS_MIN) + '</span>'
        : 'planned every ' + formatDuration(intervals[item.kind] * MS_MIN);
      // Say so when the routine has drifted away from the plan.
      if (f.observedMs) {
        var plannedMs = f.plannedMin * MS_MIN;
        if (Math.abs(f.observedMs - plannedMs) / plannedMs > DRIFT_TOLERANCE) {
          note += ' · actually averaging ' + formatDuration(f.observedMs);
        }
      }

      div.innerHTML =
        '<span class="f-icon">' + item.icon + '</span>' +
        '<div class="f-body">' +
          '<div class="f-type">' + item.label + ' · expected ' + formatWhen(f.nextTime) + '</div>' +
          '<div>' + timeHtml + '</div>' +
          '<div class="f-note">' + note + '</div>' +
        '</div>';
      el.forecastList.appendChild(div);
    });
  }

  // ---------- sleep banner ----------

  function renderSleepBanner() {
    var analysis = analyzeSleep();
    if (!analysis.active) {
      el.sleepBanner.hidden = true;
      return;
    }
    var dur = Date.now() - new Date(analysis.active.time);
    el.sleepDuration.textContent = formatDuration(dur);
    el.sleepWarning.hidden = dur <= SUSPICIOUS_SLEEP;
    el.sleepBanner.hidden = false;
  }

  function renderSleepButton() {
    var sleeping = isSleepingNow();
    el.sleepLabel.textContent = sleeping ? "Wake up" : "Sleep";
    el.btnSleep.classList.toggle("sleeping", sleeping);
  }

  // ---------- measurements ----------

  function measureLine(event) {
    var value = measureValueOf(event);
    if (value === null) return "";
    var text = formatMeasure(event.type, value, measureUnitOf(event));
    if (event.type === "weight") text += " · " + formatImperial(value);
    var label = measureLabelOf(event);
    return label ? label + " " + text : text;
  }

  function signed(delta, digits, unit) {
    // Round to the precision that suits the measurement, then drop the
    // padding: "+1.3 cm", not "+1.30 cm".
    var rounded = Number(delta.toFixed(digits));
    var sign = rounded > 0 ? "+" : "";
    return sign + String(rounded) + unit;
  }

  function renderMeasureCards() {
    el.measureCards.innerHTML = "";
    MEASURE_ORDER.forEach(function (type) {
      if (MEASURES[type].freeform) {
        // One card per thing the parent has named, rather than one for all.
        knownMeasureLabels().forEach(function (known) {
          renderMeasureCard(type, measurementsOf(type, known.label), known.label);
        });
        return;
      }
      renderMeasureCard(type, measurementsOf(type), "");
    });
  }

  function renderMeasureCard(type, list, freeLabel) {
    var meta = MEASURES[type];
    var heading = freeLabel || meta.label;
    var card = document.createElement("div");
    card.className = "measure-card" + (list.length ? "" : " is-empty");

    if (!list.length) {
      card.innerHTML =
        '<span class="m-icon">' + meta.icon + '</span>' +
        '<div class="m-body">' +
          '<div class="m-label">' + escapeHtml(heading) + '</div>' +
          '<div class="m-value">Nothing recorded yet</div>' +
        '</div>';
      el.measureCards.appendChild(card);
      return;
    }

    var latest = list[list.length - 1];
    var value = measureValueOf(latest);
    var when = new Date(latest.time);
    var subParts = [];

    var age = ageDaysAt(latest.time);
    subParts.push(formatDateHeader(when) + (age !== null ? " · " + formatAge(age) : ""));

    if (list.length > 1) {
      var previous = measureValueOf(list[list.length - 2]);
      var delta = value - previous;
      var digits = type === "weight" ? 0 : (meta.freeform ? 2 : 1);
      var freeUnit = measureUnitOf(latest);
      var unit = type === "weight" ? " g" : (freeUnit ? " " + freeUnit : (meta.unit ? " " + meta.unit : ""));
      var cls = delta >= 0 ? "m-up" : "m-down";
      subParts.push('<span class="' + cls + '">' + escapeHtml(signed(delta, digits, unit)) + '</span> since last');
    }

    // Weight against birth weight is what gets watched in the first weeks.
    if (type === "weight") {
      var birth = measureValueOf(list[0]);
      if (list.length > 1 && birth) {
        var pct = ((value - birth) / birth) * 100;
        subParts.push(signed(pct, 1, "%") + " of birth weight");
      }
    }

    card.innerHTML =
      '<span class="m-icon">' + meta.icon + '</span>' +
      '<div class="m-body">' +
        '<div class="m-label">' + escapeHtml(heading) + '</div>' +
        '<div class="m-value">' + escapeHtml(
            freeLabel ? formatMeasure(type, value, measureUnitOf(latest)) : measureLine(latest)
          ) + '</div>' +
        '<div class="m-sub">' + subParts.join(" · ") + '</div>' +
      '</div>';
    el.measureCards.appendChild(card);
  }

  function renderMeasurements() {
    el.measureToggleText.textContent = measureOpen ? "Hide measurements" : "Measurements";
    el.measurePanel.hidden = !measureOpen;
    if (measureOpen) renderMeasureCards();
  }

  function renderGettingStarted() {
    el.gettingStarted.hidden = liveEvents().length > 0;
  }

  function renderTempBanner() {
    var temps = measurementsOf("temp");
    var latest = temps.length ? temps[temps.length - 1] : null;
    var concern = latest ? temperatureConcern(latest) : null;
    // Only while it is recent — an old reading is history, not a live worry.
    if (!concern || Date.now() - new Date(latest.time) > FEVER_BANNER_MAX_AGE) {
      el.tempBanner.hidden = true;
      return;
    }
    el.tempBannerLine.textContent = concern.headline + " (" + formatClockTime(new Date(latest.time)) + ")";
    el.tempBannerAdvice.textContent = concern.advice;
    el.tempBanner.hidden = false;
  }

  el.measureToggle.addEventListener("click", function () {
    measureOpen = !measureOpen;
    renderMeasurements();
  });

  document.querySelectorAll(".measure-add").forEach(function (btn) {
    btn.addEventListener("click", function () {
      startMeasurement(btn.getAttribute("data-measure"));
    });
  });

  // ---------- log ----------

  function groupByDay(descEvents) {
    var groups = [];
    var index = {};
    descEvents.forEach(function (e) {
      var d = new Date(e.time);
      var key = dayKeyOf(d);
      if (!index[key]) {
        index[key] = { key: key, date: d, events: [] };
        groups.push(index[key]);
      }
      index[key].events.push(e);
    });
    return groups;
  }

  function daySummary(group, analysis) {
    var feeds = 0;
    var fedMs = 0;
    var diapers = 0;
    var wet = 0;
    var dirty = 0;
    group.events.forEach(function (e) {
      if (e.type === "feed") {
        feeds++;
        fedMs += (fedMinutesOf(e) || 0) * MS_MIN;
      }
      if (e.type !== "diaper") return;
      diapers++;
      var kind = nappyOf(e);
      if (kind === "wet" || kind === "both") wet++;
      if (kind === "dirty" || kind === "both") dirty++;
    });
    var dayStart = new Date(group.date);
    dayStart.setHours(0, 0, 0, 0);
    var sleepMs = sleepMsInRange(analysis, +dayStart, +dayStart + MS_DAY, Date.now());
    // Wet-nappy counts are what a health visitor asks about, so surface them
    // once there is anything to show.
    var nappies = "🧷 " + diapers;
    if (wet || dirty) nappies += " (💧" + wet + " 💩" + dirty + ")";
    var feedLabel = "🍼 " + feeds;
    if (fedMs) feedLabel += " (" + formatDuration(fedMs) + ")";
    return feedLabel + " · " + nappies + " · 🌙 " + (sleepMs ? formatDuration(sleepMs) : "0m");
  }

  function isDayExpanded(key, index) {
    return Object.prototype.hasOwnProperty.call(expandedDays, key)
      ? expandedDays[key]
      : index < DEFAULT_EXPANDED_DAYS;
  }

  function renderLog() {
    var visible = liveEvents();
    el.logToggleText.textContent =
      (logOpen ? "Hide history" : "Show history") + " (" + visible.length + ")";
    el.logList.hidden = !logOpen;
    if (!logOpen) return;

    lastLogDayKey = dayKeyOf(new Date());
    el.logList.innerHTML = "";

    if (!visible.length) {
      var empty = document.createElement("div");
      empty.className = "log-empty";
      empty.textContent = "No entries yet";
      el.logList.appendChild(empty);
      return;
    }

    var analysis = analyzeSleep();
    var groups = groupByDay(sortedByTimeDesc(visible));

    groups.forEach(function (group, i) {
      var expanded = isDayExpanded(group.key, i);
      var section = document.createElement("div");
      section.className = "log-day";

      var header = document.createElement("button");
      header.className = "log-day-header" + (expanded ? " expanded" : "");
      header.setAttribute("data-day", group.key);
      header.setAttribute("data-index", i);
      header.innerHTML =
        '<span class="log-day-chevron">▶</span>' +
        '<span class="log-day-titles">' +
          '<span class="log-day-name">' + escapeHtml(dayLabel(group.date)) + '</span>' +
          '<div class="log-day-summary">' + daySummary(group, analysis) + '</div>' +
        '</span>';
      section.appendChild(header);

      if (expanded) {
        group.events.forEach(function (e) {
          var d = new Date(e.time);
          var duration = analysis.durationById[e.id];
          var warning = analysis.warningById[e.id];
          var row = document.createElement("div");
          row.className = "log-item";
          row.setAttribute("data-id", e.id);
          row.innerHTML =
            '<span class="l-icon">' + eventTypeIcon(e.type) + '</span>' +
            '<div class="l-body">' +
              '<div class="l-type">' + escapeHtml(eventTypeLabel(e.type)) + '</div>' +
              '<div class="l-time">' + formatClockTime(d) + '</div>' +
              (duration ? '<div class="l-duration">slept ' + formatDuration(duration) + '</div>' : '') +
              (fedMinutesOf(e) ? '<div class="l-duration">took ' +
                formatDuration(fedMinutesOf(e) * MS_MIN) + '</div>' : '') +
              (nappyOf(e) ? '<div class="l-detail">' + NAPPY_TYPES[e.nappy].detail + '</div>' : '') +
              (fedWithOf(e) ? '<div class="l-detail">' + feedSource(e.fedWith).detail + '</div>' : '') +
              (measureValueOf(e) !== null
                ? '<div class="l-measure">' + escapeHtml(measureLine(e)) + '</div>' : '') +
              (warning ? '<div class="l-warn">⚠ ' + escapeHtml(warning) + '</div>' : '') +
            '</div>' +
            '<button class="l-delete" data-id="' + escapeHtml(e.id) + '" aria-label="Delete entry">✕</button>';
          section.appendChild(row);
        });
      }

      el.logList.appendChild(section);
    });
  }

  el.logList.addEventListener("click", function (ev) {
    var delBtn = ev.target.closest(".l-delete");
    if (delBtn) {
      deleteEvent(delBtn.getAttribute("data-id"));
      return;
    }

    var header = ev.target.closest(".log-day-header");
    if (header) {
      var key = header.getAttribute("data-day");
      var idx = parseInt(header.getAttribute("data-index"), 10);
      expandedDays[key] = !isDayExpanded(key, idx);
      renderLog();
      return;
    }

    var row = ev.target.closest(".log-item");
    if (row) startEdit(row.getAttribute("data-id"));
  });

  el.logToggle.addEventListener("click", function () {
    logOpen = !logOpen;
    renderLog();
  });

  function deleteEvent(id) {
    var target = events.filter(function (e) { return e.id === id; })[0];
    if (!target || isDeleted(target)) return;
    var carried = stripToTombstone(target);
    touch(target);
    if (!saveEvents(events)) return;
    if (editingId === id) resetManualForm();
    renderAll();
    showToast("Entry deleted", function () {
      restoreFromTombstone(target, carried);
      touch(target);
      saveEvents(events);
      renderAll();
    });
  }

  // ---------- toast ----------

  var toastTimer = null;
  var pendingUndo = null;

  function showToast(text, undoFn) {
    el.toastText.textContent = text;
    pendingUndo = undoFn || null;
    el.toastAction.hidden = !undoFn;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, UNDO_TIMEOUT);
  }

  function hideToast() {
    el.toast.hidden = true;
    pendingUndo = null;
  }

  el.toastAction.addEventListener("click", function () {
    if (!pendingUndo) return;
    var fn = pendingUndo;
    hideToast();
    fn();
  });

  // ---------- manual entry / editing ----------

  function showManualNotice(msg, isWarning) {
    el.manualError.textContent = msg;
    el.manualError.classList.toggle("is-warning", !!isWarning);
    el.manualError.hidden = false;
  }

  function hideManualNotice() {
    el.manualError.hidden = true;
    el.manualError.classList.remove("is-warning");
  }

  function openManualPanel() {
    manualOpen = true;
    el.manualPanel.hidden = false;
    el.manualToggleText.textContent = "Hide form";
  }

  function syncManualNappyField() {
    var isNappy = el.manualType.value === "diaper";
    el.manualNappyField.hidden = !isNappy;
    if (!isNappy) el.manualNappy.value = "";
  }

  function renderLabelSuggestions() {
    el.manualLabelSuggest.innerHTML = "";
    knownMeasureLabels().slice(0, 6).forEach(function (known) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "label-chip";
      chip.textContent = known.label;
      chip.addEventListener("click", function () {
        el.manualMeasureLabel.value = known.label;
        if (known.unit) el.manualMeasureUnit.value = known.unit;
      });
      el.manualLabelSuggest.appendChild(chip);
    });
  }

  function syncManualValueField() {
    var meta = MEASURES[el.manualType.value];
    var freeform = !!(meta && meta.freeform);
    el.manualLabelField.hidden = !freeform;
    el.manualUnitField.hidden = !freeform;
    if (freeform) renderLabelSuggestions();
    else {
      el.manualMeasureLabel.value = "";
      el.manualMeasureUnit.value = "";
    }
    el.manualValueField.hidden = !meta;
    if (!meta) {
      el.manualValue.value = "";
      el.manualValueEcho.textContent = "";
      return;
    }
    el.manualValueLabel.textContent = freeform
      ? "Reading"
      : meta.label + " in " + meta.unit;
    el.manualValue.setAttribute("step", meta.step);
    el.manualValue.setAttribute("max", String(meta.max));
    renderValueEcho();
  }

  function renderValueEcho() {
    var type = el.manualType.value;
    var meta = MEASURES[type];
    var value = Number(el.manualValue.value);
    if (!meta || !el.manualValue.value || !isFinite(value) || value <= 0) {
      el.manualValueEcho.textContent = "";
      return;
    }
    if (type === "weight") {
      el.manualValueEcho.textContent = formatMeasure(type, value) + " · " + formatImperial(value);
      return;
    }
    if (type === "temp") {
      var concern = temperatureConcern({ type: "temp", value: value, time: el.manualDateTime.value || new Date().toISOString() });
      el.manualValueEcho.textContent = concern ? concern.headline : "";
      return;
    }
    el.manualValueEcho.textContent = "";
  }

  el.manualValue.addEventListener("input", renderValueEcho);

  function syncManualFedField() {
    var isFeed = el.manualType.value === "feed";
    el.manualFedField.hidden = !isFeed;
    if (!isFeed) el.manualFed.value = "";
    el.manualSourceField.hidden = !(isFeed && asksFedWith());
    if (!isFeed) el.manualSource.value = "";
  }

  function syncManualFields() {
    syncManualFedField();
    syncManualNappyField();
    syncManualValueField();
  }

  el.manualType.addEventListener("change", syncManualFields);

  function resetManualForm() {
    editingId = null;
    el.manualFed.value = "";
    el.manualSource.value = defaultFedWith();
    el.manualNappy.value = "";
    el.manualValue.value = "";
    el.manualMeasureLabel.value = "";
    el.manualMeasureUnit.value = "";
    syncManualFields();
    el.manualTitle.textContent = "New entry";
    el.manualSubmit.textContent = "Add entry";
    el.manualCancel.hidden = true;
    el.manualDateTime.value = toDateTimeLocalValue(new Date());
    hideManualNotice();
  }

  function startEdit(id) {
    var found = events.filter(function (e) { return e.id === id; })[0];
    if (!found) return;
    editingId = id;
    openManualPanel();
    el.manualTitle.textContent = "Edit entry";
    el.manualType.value = found.type;
    el.manualFed.value = fedMinutesOf(found) === null ? "" : String(fedMinutesOf(found));
    el.manualSource.value = fedWithOf(found);
    el.manualNappy.value = nappyOf(found) || "";
    el.manualValue.value = measureValueOf(found) === null ? "" : String(found.value);
    el.manualMeasureLabel.value = measureLabelOf(found);
    el.manualMeasureUnit.value = measureUnitOf(found);
    syncManualFields();
    el.manualDateTime.value = toDateTimeLocalValue(new Date(found.time));
    el.manualSubmit.textContent = "Save";
    el.manualCancel.hidden = false;
    hideManualNotice();
    el.manualPanel.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function startMeasurement(type) {
    if (!MEASURES[type]) return;
    resetManualForm();
    openManualPanel();
    el.manualTitle.textContent = "New " + MEASURES[type].label.toLowerCase();
    el.manualType.value = type;
    syncManualFields();
    el.manualDateTime.value = toDateTimeLocalValue(new Date());
    el.manualPanel.scrollIntoView({ behavior: "smooth", block: "center" });
    el.manualValue.focus();
  }

  el.manualDateTime.value = toDateTimeLocalValue(new Date());

  el.manualToggle.addEventListener("click", function () {
    manualOpen = !manualOpen;
    el.manualPanel.hidden = !manualOpen;
    el.manualToggleText.textContent = manualOpen ? "Hide form" : "Add a past entry";
    if (!manualOpen) resetManualForm();
    else hideManualNotice();
  });

  el.manualCancel.addEventListener("click", function () {
    resetManualForm();
  });

  el.manualSubmit.addEventListener("click", function () {
    var type = el.manualType.value;
    var raw = el.manualDateTime.value;

    if (!raw) {
      showManualNotice("Enter a date and time");
      return;
    }
    var picked = new Date(raw);
    if (isNaN(picked.getTime())) {
      showManualNotice("That date and time isn't valid");
      return;
    }
    if (picked.getTime() > Date.now() + MS_MIN) {
      showManualNotice("You can't add an entry in the future");
      return;
    }

    var measureMeta = MEASURES[type];
    var measureValue = null;
    var measureLabel = "";
    var measureUnit = "";
    if (measureMeta && measureMeta.freeform) {
      measureLabel = cleanText(el.manualMeasureLabel.value, MAX_LABEL);
      measureUnit = cleanText(el.manualMeasureUnit.value, MAX_UNIT);
      if (!measureLabel) {
        showManualNotice("Give it a name, so you can tell it apart later");
        return;
      }
    }
    if (measureMeta) {
      measureValue = Number(el.manualValue.value);
      if (!el.manualValue.value || !isFinite(measureValue) || measureValue <= 0) {
        showManualNotice("Enter a " + measureMeta.label.toLowerCase() + " in " + measureMeta.unit);
        return;
      }
      if (measureValue > measureMeta.max) {
        showManualNotice(measureMeta.freeform
          ? "That number is larger than this app will store"
          : "That looks too high for a " + measureMeta.label.toLowerCase() + " in " + measureMeta.unit);
        return;
      }
    }

    var fedMinutes = parseInt(el.manualFed.value, 10);
    if (!isFinite(fedMinutes) || fedMinutes <= 0) fedMinutes = 0;

    hideManualNotice();
    var savedId;

    if (editingId) {
      var target = events.filter(function (e) { return e.id === editingId; })[0];
      if (!target) {
        resetManualForm();
        return;
      }
      // datetime-local carries minutes only, so re-saving an untouched time
      // would drop the seconds and could reorder two entries logged in the
      // same minute. Keep the original instant when the minute is unchanged.
      var previous = new Date(target.time);
      if (toDateTimeLocalValue(previous) === raw) picked = previous;
      target.type = type;
      target.time = picked.toISOString();
      if (type === "diaper" && NAPPY_TYPES[el.manualNappy.value]) target.nappy = el.manualNappy.value;
      else delete target.nappy;
      if (type === "feed" && fedMinutes) target.fedMin = fedMinutes;
      else delete target.fedMin;
      if (type === "feed" && feedSource(el.manualSource.value)) target.fedWith = el.manualSource.value;
      else delete target.fedWith;
      if (measureMeta) target.value = measureValue;
      else delete target.value;
      if (measureLabel) target.label = measureLabel;
      else delete target.label;
      if (measureUnit) target.unit = measureUnit;
      else delete target.unit;
      touch(target);
      savedId = editingId;
      if (!saveEvents(events)) return;
      resetManualForm();
      renderAll();
      showToast("Entry updated");
    } else {
      savedId = addEvent(type, picked.toISOString(),
        type === "diaper" ? el.manualNappy.value : "", measureValue,
        measureLabel, measureUnit, type === "feed" ? fedMinutes : 0,
        type === "feed" ? el.manualSource.value : "");
      if (!savedId) return;
      el.manualDateTime.value = toDateTimeLocalValue(new Date());
      var original = el.manualSubmit.textContent;
      el.manualSubmit.textContent = "Added ✓";
      setTimeout(function () {
        if (!editingId) el.manualSubmit.textContent = original;
      }, 900);
    }

    // Backfilling history one record at a time easily produces a "fell
    // asleep" with no matching "woke up" - say so instead of silently
    // flipping the app into sleep mode.
    var saved = events.filter(function (e) { return e.id === savedId; })[0];
    var concern = saved ? temperatureConcern(saved) : null;
    if (concern) {
      showManualNotice(concern.headline + ". " + concern.advice);
      return;
    }

    var warning = analyzeSleep().warningById[savedId];
    if (warning) showManualNotice(warning + ". Add it so the sleep is counted correctly.", true);
  });

  // ---------- "next up" prompt ----------

  var nextUpTimer = null;
  var nextUpKind = null;
  var nextUpEventId = null;

  function hideNextUp() {
    clearTimeout(nextUpTimer);
    el.nextUp.hidden = true;
    nextUpKind = null;
    nextUpEventId = null;
  }

  function chipChoices(currentMin) {
    var list = CHIP_CHOICES.slice();
    if (list.indexOf(currentMin) === -1) list.push(currentMin);
    return list.sort(function (a, b) { return a - b; });
  }

  function renderNextUp() {
    if (!nextUpKind) return;
    var event = events.filter(function (e) { return e.id === nextUpEventId; })[0];
    if (!event) {
      hideNextUp();
      return;
    }
    var planned = plannedMinutesFor(nextUpKind, event);
    var when = new Date(new Date(event.time).getTime() + planned * MS_MIN);

    el.nextUpTitle.textContent =
      KIND_META[nextUpKind].logged + " at " + formatClockTime(new Date(event.time));
    el.nextUpLine.innerHTML = "Next " + KIND_META[nextUpKind].label.toLowerCase() +
      ' <span class="nextup-when">' + escapeHtml(formatWhen(when)) + '</span>';

    var isFeed = nextUpKind === "feed";
    var asksSource = isFeed && asksFedWith();
    el.sourceBlock.hidden = !asksSource;
    if (asksSource) {
      var chosen = fedWithOf(event);
      el.sourceChips.innerHTML = "";
      FEED_SOURCES.forEach(function (source) {
        var chip = document.createElement("button");
        chip.className = "nextup-chip source-chip" + (source.id === chosen ? " selected" : "");
        chip.setAttribute("data-source", source.id);
        chip.textContent = source.label;
        el.sourceChips.appendChild(chip);
      });
    }

    el.feedBlock.hidden = !isFeed;
    if (isFeed) {
      var recorded = fedMinutesOf(event);
      var suggestion = recorded === null ? suggestedFeedMinutes() : recorded;
      el.feedChips.innerHTML = "";
      FEED_MINUTES.forEach(function (mins) {
        var chip = document.createElement("button");
        // Nothing is selected until the parent answers — the suggestion is
        // only marked out, so the card never looks as though it recorded a
        // length on their behalf.
        chip.className = "nextup-chip feed-chip" +
          (mins === recorded ? " selected" : "") +
          (recorded === null && mins === suggestion ? " suggested" : "");
        chip.setAttribute("data-fed", String(mins));
        chip.textContent = formatDuration(mins * MS_MIN);
        el.feedChips.appendChild(chip);
      });
    }

    var isNappy = nextUpKind === "diaper";
    el.nappyBlock.hidden = !isNappy;
    if (isNappy) {
      var current = nappyOf(event);
      el.nappyChips.innerHTML = "";
      NAPPY_ORDER.forEach(function (key) {
        var chip = document.createElement("button");
        chip.className = "nextup-chip nappy-chip" + (key === current ? " selected" : "");
        chip.setAttribute("data-nappy", key);
        chip.textContent = NAPPY_TYPES[key].chip;
        el.nappyChips.appendChild(chip);
      });
    }

    el.nextUpChips.innerHTML = "";
    chipChoices(planned).forEach(function (mins) {
      var chip = document.createElement("button");
      chip.className = "nextup-chip" + (mins === planned ? " selected" : "");
      chip.setAttribute("data-min", String(mins));
      chip.textContent = formatDuration(mins * MS_MIN);
      el.nextUpChips.appendChild(chip);
    });
  }

  function showNextUp(kind, eventId) {
    nextUpKind = kind;
    nextUpEventId = eventId;
    el.nextUp.hidden = false;
    renderNextUp();
    clearTimeout(nextUpTimer);
    nextUpTimer = setTimeout(hideNextUp, NEXTUP_TIMEOUT);
  }

  el.nextUpClose.addEventListener("click", hideNextUp);

  el.sourceChips.addEventListener("click", function (ev) {
    var chip = ev.target.closest(".source-chip");
    if (!chip) return;
    var event = events.filter(function (e) { return e.id === nextUpEventId; })[0];
    if (!event) return;

    var id = chip.getAttribute("data-source");
    // Tapping the same answer again clears it, so a mis-tap is undoable — and
    // clearing means "not recorded", not "back to the setting", or a later
    // change of regime would rewrite this feed.
    if (fedWithOf(event) === id) delete event.fedWith;
    else event.fedWith = id;
    touch(event);

    if (!saveEvents(events)) return;
    renderAll();
    renderNextUp();
    clearTimeout(nextUpTimer);
    nextUpTimer = setTimeout(hideNextUp, NEXTUP_TIMEOUT);
  });

  el.feedChips.addEventListener("click", function (ev) {
    var chip = ev.target.closest(".feed-chip");
    if (!chip) return;
    var event = events.filter(function (e) { return e.id === nextUpEventId; })[0];
    if (!event) return;

    var mins = parseInt(chip.getAttribute("data-fed"), 10);
    // Tapping the same answer again clears it, so a mis-tap is undoable.
    if (fedMinutesOf(event) === mins) delete event.fedMin;
    else event.fedMin = mins;
    touch(event);

    if (!saveEvents(events)) return;
    renderAll();
    renderNextUp();
    clearTimeout(nextUpTimer);
    nextUpTimer = setTimeout(hideNextUp, NEXTUP_TIMEOUT);
  });

  el.nappyChips.addEventListener("click", function (ev) {
    var chip = ev.target.closest(".nappy-chip");
    if (!chip) return;
    var event = events.filter(function (e) { return e.id === nextUpEventId; })[0];
    if (!event) return;

    var key = chip.getAttribute("data-nappy");
    // Tapping the same answer again clears it, so a mis-tap is undoable.
    if (nappyOf(event) === key) delete event.nappy;
    else event.nappy = key;
    touch(event);

    if (!saveEvents(events)) return;
    renderAll();
    renderNextUp();
    clearTimeout(nextUpTimer);
    nextUpTimer = setTimeout(hideNextUp, NEXTUP_TIMEOUT);
  });

  el.nextUpChips.addEventListener("click", function (ev) {
    var chip = ev.target.closest(".nextup-chip");
    if (!chip || !nextUpKind) return;
    var event = events.filter(function (e) { return e.id === nextUpEventId; })[0];
    if (!event) return;

    var mins = parseInt(chip.getAttribute("data-min"), 10);
    // Picking the everyday plan means there is no exception to remember.
    if (mins === intervals[nextUpKind]) delete event.nextMin;
    else event.nextMin = mins;
    touch(event);

    if (!saveEvents(events)) return;
    renderAll();
    renderNextUp();
    clearTimeout(nextUpTimer);
    nextUpTimer = setTimeout(hideNextUp, NEXTUP_TIMEOUT);
  });

  // ---------- planned interval settings ----------

  var settingsSelects = {
    feed: document.getElementById("intervalFeed"),
    diaper: document.getElementById("intervalDiaper"),
    sleep: document.getElementById("intervalSleep")
  };

  function buildIntervalOptions() {
    KINDS.forEach(function (kind) {
      var select = settingsSelects[kind];
      var choices = INTERVAL_CHOICES.slice();
      if (choices.indexOf(intervals[kind]) === -1) choices.push(intervals[kind]);
      choices.sort(function (a, b) { return a - b; });
      select.innerHTML = "";
      choices.forEach(function (mins) {
        var option = document.createElement("option");
        option.value = String(mins);
        option.textContent = formatDuration(mins * MS_MIN);
        select.appendChild(option);
      });
      select.value = String(intervals[kind]);
    });
  }

  KINDS.forEach(function (kind) {
    settingsSelects[kind].addEventListener("change", function () {
      var value = parseInt(settingsSelects[kind].value, 10);
      if (!(value > 0)) return;
      intervals[kind] = value;
      if (!saveIntervals()) return;
      renderAll();
      renderNextUp();
      showToast(KIND_META[kind].label + " planned every " + formatDuration(value * MS_MIN));
    });
  });

  // ---------- actions ----------

  function addEvent(type, isoTime, nappy, value, label, unit, fedMin, fedWith) {
    var event = { id: uuid(), type: type, time: isoTime || new Date().toISOString() };
    if (NAPPY_TYPES[nappy]) event.nappy = nappy;
    if (type === "feed" && fedMin > 0) event.fedMin = Math.round(fedMin);
    // Stamped now rather than looked up later: the setting is a default for
    // feeds as they happen, not a verdict on ones already logged.
    if (type === "feed") {
      var source = feedSource(fedWith === undefined ? defaultFedWith() : fedWith);
      if (source) event.fedWith = source.id;
    }
    if (MEASURES[type] && isFinite(value) && value > 0) event.value = value;
    if (label) event.label = label;
    if (unit) event.unit = unit;
    touch(event);
    events.push(event);
    if (!saveEvents(events)) return null;
    renderAll();
    return event.id;
  }

  function flashButton(btn) {
    btn.classList.add("active-flash");
    setTimeout(function () {
      btn.classList.remove("active-flash");
    }, 250);
  }

  el.btnFeed.addEventListener("click", function () {
    flashButton(el.btnFeed);
    var id = addEvent("feed");
    if (id) showNextUp("feed", id);
  });

  el.btnDiaper.addEventListener("click", function () {
    flashButton(el.btnDiaper);
    var id = addEvent("diaper");
    if (id) showNextUp("diaper", id);
  });

  el.btnSleep.addEventListener("click", function () {
    flashButton(el.btnSleep);
    // Waking up does not start a new gap, so there is nothing to plan there.
    var sleeping = isSleepingNow();
    var id = addEvent(sleeping ? "sleep_end" : "sleep_start");
    if (id && !sleeping) showNextUp("sleep", id);
  });

  // ---------- export ----------

  function downloadFile(filename, content, mime) {
    try {
      var blob = new Blob([content], { type: mime });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      return true;
    } catch (e) {
      showError("Couldn't save the file");
      return false;
    }
  }

  function exportBaseName() {
    return "baby-tracker-" + dayKeyOf(new Date());
  }

  function csvEscape(value) {
    var s = value == null ? "" : String(value);
    if (/[";,\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function buildCsv() {
    var analysis = analyzeSleep();
    var rows = [["id", "type", "label", "time_local", "time_iso", "duration_min", "next_interval_min", "fed_with", "nappy", "value", "label", "unit", "updated_iso"]];
    sortedByTimeDesc(liveEvents()).forEach(function (e) {
      var duration = analysis.durationById[e.id];
      rows.push([
        e.id,
        e.type,
        eventTypeLabel(e.type),
        formatDateTimeLocal(new Date(e.time)),
        e.time,
        duration ? Math.round(duration / MS_MIN) : (fedMinutesOf(e) || ""),
        customMinutesOf(e) || "",
        fedWithOf(e),
        nappyOf(e) || "",
        measureValueOf(e) === null ? "" : e.value,
        measureLabelOf(e),
        measureUnitOf(e),
        updatedAtOf(e)
      ]);
    });
    return rows.map(function (r) { return r.map(csvEscape).join(","); }).join("\r\n");
  }

  function buildMarkdown() {
    var analysis = analyzeSleep();
    var name = loadName().trim() || "Baby";
    var groups = groupByDay(sortedByTimeDesc(liveEvents()));
    var out = [];

    out.push("# " + name + " — log");
    out.push("");
    out.push("Exported: " + formatDateTimeLocal(new Date()) + "  ");
    out.push("Entries: " + liveEvents().length);
    out.push("");

    groups.forEach(function (group) {
      out.push("## " + formatDateHeader(group.date));
      out.push("");
      out.push(daySummary(group, analysis));
      out.push("");
      out.push("| Time | Event | Duration |");
      out.push("| --- | --- | --- |");
      sortedByTimeAsc(group.events).forEach(function (e) {
        var duration = analysis.durationById[e.id] ||
          (fedMinutesOf(e) ? fedMinutesOf(e) * MS_MIN : 0);
        out.push("| " + formatClockTime(new Date(e.time)) +
          " | " + eventTypeIcon(e.type) + " " + eventTypeLabel(e.type) +
          (nappyOf(e) ? " (" + NAPPY_TYPES[e.nappy].label.toLowerCase() + ")" : "") +
          (fedWithOf(e) ? " (" + feedSource(e.fedWith).label.toLowerCase() + ")" : "") +
          (measureValueOf(e) !== null ? " — " + measureLine(e) : "") +
          " | " + (duration ? formatDuration(duration) : "—") + " |");
      });
      out.push("");
    });

    return out.join("\n");
  }

  function guardEmpty() {
    if (liveEvents().length) return false;
    showToast("Nothing to export yet");
    return true;
  }

  el.exportCsv.addEventListener("click", function () {
    if (guardEmpty()) return;
    // BOM so Excel detects UTF-8 and Cyrillic labels survive.
    if (downloadFile(exportBaseName() + ".csv", "﻿" + buildCsv(), "text/csv;charset=utf-8")) {
      showToast("CSV saved");
    }
  });

  el.exportMd.addEventListener("click", function () {
    if (guardEmpty()) return;
    if (downloadFile(exportBaseName() + ".md", buildMarkdown(), "text/markdown;charset=utf-8")) {
      showToast("Markdown saved");
    }
  });

  el.exportJson.addEventListener("click", function () {
    if (guardEmpty()) return;
    var payload = JSON.stringify({
      name: loadName(),
      dob: loadDob(),
      feeding: loadFeeding(),
      intervals: intervals,
      plans: plans,
      events: sortedByTimeDesc(events)   // tombstones included on purpose
    }, null, 2);
    if (downloadFile(exportBaseName() + ".json", payload, "application/json;charset=utf-8")) {
      showToast("Backup saved");
    }
  });

  // ---------- share links ----------

  // The payload rides in the URL fragment, which browsers never send to the
  // server — so GitHub Pages sees none of it. Order here is part of the wire
  // format: appending is safe, reordering is not.
  // Append only — the index is the wire format, so reordering breaks old links.
  var SHARE_TYPES = ["feed", "diaper", "sleep_start", "sleep_end", "weight", "height", "temp", "head", "other"];
  var SHARE_NAPPIES = ["", "wet", "dirty", "both", "dry"];
  var SHARE_VERSION = 1;
  // Past this, messaging apps start mangling links.
  var SHARE_COMFORTABLE_CHARS = 8000;

  function bytesToBase64Url(bytes) {
    var binary = "";
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function base64UrlToBytes(text) {
    var b64 = text.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    var binary = atob(b64);
    var out = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  function deflate(text) {
    var bytes = new TextEncoder().encode(text);
    if (typeof CompressionStream !== "function") return Promise.resolve({ bytes: bytes, packed: false });
    return new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw")))
      .arrayBuffer()
      .then(function (buf) { return { bytes: new Uint8Array(buf), packed: true }; })
      .catch(function () { return { bytes: bytes, packed: false }; });
  }

  function inflate(bytes, packed) {
    if (!packed) return Promise.resolve(new TextDecoder().decode(bytes));
    return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw")))
      .arrayBuffer()
      .then(function (buf) { return new TextDecoder().decode(buf); });
  }

  function secondsOf(iso) {
    return Math.round(new Date(iso).getTime() / 1000);
  }

  function eventsToShare(days) {
    if (!days) return events.slice();
    var cutoff = Date.now() - days * MS_DAY;
    // An old entry deleted this morning has a recent updatedAt, and that
    // deletion is exactly what the other phone needs.
    return events.filter(function (e) {
      return new Date(e.time) >= cutoff || new Date(updatedAtOf(e)) >= cutoff;
    });
  }

  function buildSharePayload(days) {
    var chosen = eventsToShare(days);
    return {
      v: SHARE_VERSION,
      n: loadName(),
      b: loadDob(),
      f: loadFeeding(),
      i: [intervals.feed, intervals.diaper, intervals.sleep],
      e: chosen.map(function (e) {
        return [
          e.id,
          SHARE_TYPES.indexOf(e.type),
          secondsOf(e.time),
          secondsOf(updatedAtOf(e)),
          SHARE_NAPPIES.indexOf(nappyOf(e) || ""),
          measureValueOf(e) === null ? 0 : e.value,
          customMinutesOf(e) || 0,
          isDeleted(e) ? 1 : 0,
          measureLabelOf(e),
          measureUnitOf(e),
          fedMinutesOf(e) || 0,
          FEED_SOURCE_IDS.indexOf(fedWithOf(e))
        ];
      })
    };
  }

  function readSharePayload(payload) {
    if (!payload || payload.v !== SHARE_VERSION || !Array.isArray(payload.e)) return null;
    var out = { name: payload.n || "", dob: payload.b || "", feeding: payload.f || "", intervals: null, events: [] };
    if (Array.isArray(payload.i) && payload.i.length === 3) {
      out.intervals = { feed: payload.i[0], diaper: payload.i[1], sleep: payload.i[2] };
    }
    payload.e.forEach(function (row) {
      if (!Array.isArray(row) || row.length < 8) return;
      var type = SHARE_TYPES[row[1]];
      if (!type) return;
      var entry = {
        id: row[0],
        type: type,
        time: new Date(row[2] * 1000).toISOString(),
        updatedAt: new Date(row[3] * 1000).toISOString()
      };
      if (SHARE_NAPPIES[row[4]]) entry.nappy = SHARE_NAPPIES[row[4]];
      if (row[5]) entry.value = row[5];
      if (row[6]) entry.nextMin = row[6];
      if (row[7]) entry.deleted = true;
      if (row[8]) entry.label = cleanText(row[8], MAX_LABEL);
      if (row[9]) entry.unit = cleanText(row[9], MAX_UNIT);
      // Appended after the fact: an older link simply has no tenth column.
      if (row[10] && type === "feed") entry.fedMin = row[10];
      if (row[11] > 0 && type === "feed") entry.fedWith = FEED_SOURCE_IDS[row[11]];
      out.events.push(entry);
    });
    return out;
  }

  function encodeShare(days) {
    var payload = buildSharePayload(days);
    return deflate(JSON.stringify(payload)).then(function (result) {
      return {
        count: payload.e.length,
        text: (result.packed ? "1" : "0") + bytesToBase64Url(result.bytes)
      };
    });
  }

  function decodeShare(text) {
    if (!text || text.length < 2) return Promise.resolve(null);
    var packed = text.charAt(0) === "1";
    var bytes;
    try {
      bytes = base64UrlToBytes(text.slice(1));
    } catch (e) {
      return Promise.resolve(null);
    }
    return inflate(bytes, packed)
      .then(function (json) { return readSharePayload(JSON.parse(json)); })
      .catch(function () { return null; });
  }

  function shareUrlFor(text) {
    return location.origin + location.pathname + "#s=" + text;
  }

  // ---------- import ----------

  function parseCsvLine(line, delim) {
    var out = [];
    var cur = "";
    var inQuotes = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line.charAt(i);
      if (inQuotes) {
        if (ch === '"') {
          if (line.charAt(i + 1) === '"') {
            cur += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === delim) {
        out.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  }

  function parseCsvImport(text) {
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim() !== ""; });
    if (lines.length < 2) return null;
    var delim = lines[0].split(";").length >= lines[0].split(",").length ? ";" : ",";
    var header = parseCsvLine(lines[0], delim).map(function (h) { return h.trim().toLowerCase(); });

    var iType = header.indexOf("type");
    var iId = header.indexOf("id");
    var iIso = header.indexOf("time_iso");
    var iTime = header.indexOf("time");
    var iLocal = header.indexOf("time_local");
    var iNext = header.indexOf("next_interval_min");
    var iNappy = header.indexOf("nappy");
    var iValue = header.indexOf("value");
    var iUpdated = header.indexOf("updated_iso");
    var iLabel = header.indexOf("label");
    var iUnit = header.indexOf("unit");
    var timeCol = iIso >= 0 ? iIso : (iTime >= 0 ? iTime : iLocal);
    if (iType < 0 || timeCol < 0) return null;

    var out = [];
    for (var i = 1; i < lines.length; i++) {
      var cells = parseCsvLine(lines[i], delim);
      out.push({
        id: iId >= 0 ? cells[iId] : "",
        type: (cells[iType] || "").trim(),
        time: (cells[timeCol] || "").trim(),
        nextMin: iNext >= 0 ? cells[iNext] : "",
        nappy: iNappy >= 0 ? (cells[iNappy] || "").trim() : "",
        value: iValue >= 0 ? (cells[iValue] || "").trim() : "",
        updatedAt: iUpdated >= 0 ? (cells[iUpdated] || "").trim() : "",
        label: iLabel >= 0 ? cells[iLabel] : "",
        unit: iUnit >= 0 ? cells[iUnit] : ""
      });
    }
    return out;
  }

  function parseJsonImport(text) {
    try {
      var parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && Array.isArray(parsed.events)) return parsed.events;
      return null;
    } catch (e) {
      return null;
    }
  }

  // Two independent decisions: overwrite is for settings that are genuinely
  // newer than ours, takeIntervals for cases where the incoming numbers should
  // be adopted at all. Intervals always hold a value, so they can never be
  // "filled in when missing" the way a blank name can.
  function applyIncomingSettings(parsed) {
    if (!parsed) return;
    if (parsed.intervals && parsed.takeIntervals) {
      var changed = false;
      KINDS.forEach(function (kind) {
        var value = Number(parsed.intervals[kind]);
        if (value > 0 && value <= 24 * 60) {
          intervals[kind] = Math.round(value);
          changed = true;
        }
      });
      if (changed) {
        saveIntervals();
        buildIntervalOptions();
      }
    }
    // Only fill in a name when there isn't one, so an incoming file or link
    // never quietly renames a baby that already has one.
    if (parsed.dob && (parsed.overwrite || !loadDob())) {
      saveDob(String(parsed.dob));
      el.babyDob.value = loadDob();
      renderDobEcho();
    }
    if (parsed.name && (parsed.overwrite || !loadName().trim())) {
      saveName(String(parsed.name));
      el.babyName.value = String(parsed.name);
      renderName();
      renderNameFonts();
    }
    if (parsed.feeding && feedingOption(String(parsed.feeding)) &&
        (parsed.overwrite || !loadFeeding())) {
      saveFeeding(String(parsed.feeding));
      el.babyFeeding.value = loadFeeding();
    }
  }

  function applyBackupSettings(text) {
    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return;
    }
    if (!parsed || Array.isArray(parsed)) return;
    // A restore is deliberate, so take the intervals it carries; the name and
    // date of birth still only fill blanks, so a file never renames a baby.
    applyIncomingSettings({
      name: parsed.name, dob: parsed.dob, feeding: parsed.feeding, intervals: parsed.intervals,
      takeIntervals: true, overwrite: false
    });
    if (Array.isArray(parsed.plans) && mergePlans(parsed.plans)) {
      savePlans(plans);
      renderPlans();
    }
  }

  // Anything arriving from another phone or a file, made safe to store.
  function normalisePlan(raw) {
    if (!raw || typeof raw !== "object") return null;
    var id = String(raw.id || "").trim().replace(/[^A-Za-z0-9_-]/g, "");
    if (!id) return null;
    var date = String(raw.date || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    var plan = { id: id, title: cleanText(raw.title, MAX_PLAN_TITLE), date: date };
    if (/^\d{2}:\d{2}$/.test(String(raw.time || ""))) plan.time = String(raw.time);
    var place = cleanText(raw.place, MAX_PLAN_PLACE);
    if (place) plan.place = place;
    var note = cleanText(raw.note, MAX_PLAN_NOTE);
    if (note) plan.note = note;
    if (raw.deleted) plan.deleted = true;
    // A live appointment with no name is junk; a tombstone has none by design.
    if (!plan.title && !plan.deleted) return null;
    var stamped = new Date(String(raw.updatedAt || "").trim().replace(" ", "T"));
    plan.updatedAt = isNaN(stamped.getTime()) ? new Date().toISOString() : stamped.toISOString();
    return plan;
  }

  // Turns one incoming record into the shape we store, or null if it is junk.
  function normaliseImported(raw) {
    if (!raw || !TYPE_META[raw.type]) return null;
    var parsedTime = new Date(String(raw.time || "").trim().replace(" ", "T"));
    if (isNaN(parsedTime.getTime())) return null;

    var entry = { id: "", type: raw.type, time: parsedTime.toISOString() };

    var nextMin = Number(raw.nextMin);
    if (nextMin > 0 && nextMin <= 24 * 60) entry.nextMin = Math.round(nextMin);
    if (raw.type === "diaper" && NAPPY_TYPES[raw.nappy]) entry.nappy = raw.nappy;
    if (raw.type === "feed") {
      var fedMin = Number(raw.fedMin);
      if (fedMin > 0 && fedMin <= 24 * 60) entry.fedMin = Math.round(fedMin);
      if (feedSource(raw.fedWith)) entry.fedWith = raw.fedWith;
    }
    if (MEASURES[raw.type]) {
      var measured = Number(raw.value);
      if (!isFinite(measured) || measured <= 0) return null;
      entry.value = measured;
      if (MEASURES[raw.type].freeform) {
        var label = cleanText(raw.label, MAX_LABEL);
        if (!label) return null;
        entry.label = label;
        var unit = cleanText(raw.unit, MAX_UNIT);
        if (unit) entry.unit = unit;
      }
    }
    if (raw.deleted) entry.deleted = true;

    var stamped = new Date(String(raw.updatedAt || "").trim().replace(" ", "T"));
    entry.updatedAt = isNaN(stamped.getTime()) ? entry.time : stamped.toISOString();

    // Ids arrive from a file, so keep only characters safe to put in markup.
    entry.id = String(raw.id || "").trim().replace(/[^A-Za-z0-9_-]/g, "");
    return entry;
  }

  function mergeImported(list) {
    var byId = {};
    var seenKeys = {};
    events.forEach(function (e) {
      byId[e.id] = e;
      seenKeys[e.type + "|" + e.time] = true;
    });

    var added = 0;
    var updated = 0;
    var skipped = 0;
    var invalid = 0;

    list.forEach(function (raw) {
      var entry = normaliseImported(raw);
      if (!entry) {
        invalid++;
        return;
      }

      // Without an id there is nothing to match on but the content itself.
      if (!entry.id) {
        var contentKey = entry.type + "|" + entry.time;
        if (seenKeys[contentKey]) {
          skipped++;
          return;
        }
        entry.id = uuid();
        seenKeys[contentKey] = true;
        byId[entry.id] = entry;
        events.push(entry);
        added++;
        return;
      }

      var existing = byId[entry.id];
      if (!existing) {
        byId[entry.id] = entry;
        seenKeys[entry.type + "|" + entry.time] = true;
        events.push(entry);
        added++;
        return;
      }

      // Same record on both sides: the newer edit wins, whichever device made
      // it. A tie keeps what is here, so re-importing the same file is quiet.
      if (entry.updatedAt > updatedAtOf(existing)) {
        events[events.indexOf(existing)] = entry;
        byId[entry.id] = entry;
        updated++;
      } else {
        skipped++;
      }
    });

    if ((added || updated) && !saveEvents(events)) return;

    renderAll();
    var msg = "Added " + added + (added === 1 ? " entry" : " entries");
    if (updated) msg += ", " + updated + " updated";
    if (skipped) msg += ", " + skipped + " unchanged";
    if (invalid) msg += ", " + invalid + " not recognised";
    showToast(msg);
  }

  function importFromText(text) {
    var clean = text.replace(/^﻿/, "").trim();
    if (!clean) {
      showToast("That file is empty");
      return;
    }
    var first = clean.charAt(0);
    var isJson = first === "[" || first === "{";
    var list = isJson ? parseJsonImport(clean) : parseCsvImport(clean);
    if (!list) {
      showToast("Couldn't read that file");
      return;
    }
    if (isJson) applyBackupSettings(clean);
    mergeImported(list);
  }

  el.importBtn.addEventListener("click", function () {
    el.importFile.click();
  });

  el.importFile.addEventListener("change", function () {
    var file = el.importFile.files && el.importFile.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      importFromText(String(reader.result || ""));
      // Reset so picking the same file again still fires a change event.
      el.importFile.value = "";
    };
    reader.onerror = function () {
      showToast("Couldn't open that file");
      el.importFile.value = "";
    };
    reader.readAsText(file);
  });

  // ---------- screens ----------

  function showScreen(name) {
    el.screenMain.hidden = name !== "main";
    el.screenSettings.hidden = name !== "settings";
    el.screenInfo.hidden = name !== "info";
    el.screenAi.hidden = name !== "ai";
    el.screenPlan.hidden = name !== "plan";
    window.scrollTo(0, 0);
  }

  function showSettings(focusName) {
    showScreen("settings");
    if (focusName) el.babyName.focus();
  }

  function showMain() {
    showScreen("main");
  }

  el.settingsOpenBtn.addEventListener("click", function () { showSettings(false); });
  el.settingsBack.addEventListener("click", showMain);
  el.babyNameDisplay.addEventListener("click", function () { showSettings(true); });
  el.infoOpenBtn.addEventListener("click", function () { showScreen("info"); });
  el.infoBack.addEventListener("click", showMain);
  el.gsMore.addEventListener("click", function () { showScreen("info"); });

  // ---------- sharing: sending ----------

  function describeSize(chars) {
    return (chars / 1024).toFixed(1) + " KB";
  }

  function legacyCopy(text) {
    try {
      var box = document.createElement("textarea");
      box.value = text;
      box.setAttribute("readonly", "");
      box.style.position = "fixed";
      box.style.top = "-1000px";
      document.body.appendChild(box);
      box.select();
      box.setSelectionRange(0, text.length);
      var ok = document.execCommand("copy");
      document.body.removeChild(box);
      return ok;
    } catch (e) {
      return false;
    }
  }

  // The Clipboard API needs a secure context, which an in-app browser may not
  // give us, so fall back to the old selection trick.
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text)
        .then(function () { return true; })
        .catch(function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }

  function appUrl() {
    return location.origin + location.pathname;
  }

  // Installed to the home screen, rather than sitting in a browser tab.
  function isStandalone() {
    if (window.navigator.standalone === true) return true;
    return !!(window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
  }

  function inviteText() {
    var who = loadName().trim();
    return "Baby Tracker — a simple log for " + (who ? who + "'s" : "our baby's") +
      " feeds, nappies and sleep.\n\n" +
      "Open this on your phone:\n" + appUrl() + "\n\n" +
      "You can use it straight from Safari, or add it to your Home Screen so it behaves like " +
      "an app. Worth knowing: on an iPhone those two keep separate copies of the data, so pick " +
      "one and stick to it.\n\n" +
      "Then I'll send you links with the entries I have logged. If you use Safari, just tap " +
      "one. If you added it to your Home Screen, don't tap the link — hold it, copy it, open " +
      "the app and paste it into Settings under Share. Either way it asks before merging, and " +
      "you can send one back the same way, so whatever either of us records ends up in both.";
  }

  var pendingSharePayload = null;

  // The share sheet takes the payload; the box is the fallback for copying by
  // hand, so it holds whatever is useful to paste.
  function offerToShare(payload, note, boxValue) {
    pendingSharePayload = payload;
    el.shareBox.value = boxValue;
    el.shareBox.hidden = false;
    el.shareStatus.textContent = note;
    el.shareStatus.hidden = false;
    el.shareSend.hidden = typeof navigator.share !== "function";
  }

  el.inviteCreate.addEventListener("click", function () {
    var text = inviteText();
    offerToShare(
      { title: "Baby Tracker", text: text, url: appUrl() },
      "Invitation ready — send it, then share entries once they have opened it.",
      text
    );
  });

  el.shareCreate.addEventListener("click", function () {
    var days = parseInt(el.shareRange.value, 10) || 0;
    el.shareCreate.disabled = true;
    encodeShare(days).then(function (result) {
      el.shareCreate.disabled = false;
      if (!result.count) {
        el.shareStatus.textContent = "Nothing to share in that period.";
        el.shareStatus.hidden = false;
        el.shareBox.hidden = true;
        el.shareSend.hidden = true;
        return;
      }
      var url = shareUrlFor(result.text);
      var note = result.count + (result.count === 1 ? " entry" : " entries") +
        " · " + describeSize(url.length);
      if (url.length > SHARE_COMFORTABLE_CHARS) {
        note += " — long enough that some messaging apps may break it. Try a shorter period, or send the JSON backup instead.";
      }
      offerToShare({
        title: "Baby Tracker",
        text: "Recent entries from " + (loadName().trim() || "the baby") + "'s log",
        url: url
      }, note, url);
    }).catch(function () {
      el.shareCreate.disabled = false;
      showError("Couldn't build the share link");
    });
  });

  el.shareSend.addEventListener("click", function () {
    if (typeof navigator.share !== "function" || !pendingSharePayload) return;
    navigator.share(pendingSharePayload).catch(function () { /* dismissed by the user */ });
  });

  // ---------- sharing: receiving ----------

  var pendingShare = null;
  var pendingShareLink = "";

  function clearShareHash() {
    try {
      history.replaceState(null, "", location.pathname + location.search);
    } catch (e) {
      location.hash = "";
    }
  }

  function hideSharedIn() {
    pendingShare = null;
    pendingShareLink = "";
    el.sharedIn.hidden = true;
  }

  function offerSharedLog(incoming) {
    pendingShare = incoming;
    var live = incoming.events.filter(function (e) { return !e.deleted; }).length;
    var removed = incoming.events.length - live;
    var line = "This link carries " + live + (live === 1 ? " entry" : " entries");
    if (removed) line += " and " + removed + " deletion" + (removed === 1 ? "" : "s");
    line += ". Merging keeps everything you already have — only newer versions of the same entry replace yours.";
    el.sharedLine.textContent = line;
    // On iOS a Home Screen app and Safari keep entirely separate storage, and
    // a tapped link always lands in Safari. Offer a way to carry it across.
    var browserTab = !isStandalone();
    el.sharedTip.hidden = !browserTab;
    el.sharedCopy.hidden = !browserTab || !pendingShareLink;
    el.sharedIn.hidden = false;
  }

  el.sharedMerge.addEventListener("click", function () {
    if (!pendingShare) return;
    var incoming = pendingShare;
    hideSharedIn();
    applyIncomingSettings({
      name: incoming.name, dob: incoming.dob, feeding: incoming.feeding, intervals: incoming.intervals,
      takeIntervals: true, overwrite: false
    });
    mergeImported(incoming.events);
  });

  el.sharedCopy.addEventListener("click", function () {
    if (!pendingShareLink) return;
    copyText(shareUrlFor(pendingShareLink)).then(function (ok) {
      showToast(ok
        ? "Copied. Open the app from your Home Screen, then Settings → paste it under Share."
        : "Couldn't copy — select the link in the address bar instead.");
    });
  });

  el.sharedDiscard.addEventListener("click", function () {
    hideSharedIn();
    showToast("Shared log discarded");
  });

  // Opening a share link while the app is already on screen only changes the
  // fragment, which does not reload anything — so listen for that too.
  window.addEventListener("hashchange", function () { handleShareHash(); });

  // Accepts a whole link or just the payload, however it survived being
  // copied out of a chat.
  function payloadFromText(text) {
    var trimmed = String(text || "").trim();
    if (!trimmed) return "";
    var marker = trimmed.indexOf("#s=");
    if (marker >= 0) trimmed = trimmed.slice(marker + 3);
    return trimmed.replace(/\s+/g, "");
  }

  function receiveShareText(payload, onFailure) {
    return decodeShare(payload).then(function (incoming) {
      if (!incoming || !incoming.events.length) {
        onFailure();
        return false;
      }
      pendingShareLink = payload;
      showScreen("main");
      offerSharedLog(incoming);
      return true;
    });
  }

  el.pasteMerge.addEventListener("click", function () {
    var payload = payloadFromText(el.pasteBox.value);
    if (!payload) {
      showToast("Paste a share link first");
      return;
    }
    receiveShareText(payload, function () {
      showToast("That does not look like a share link");
    }).then(function (ok) {
      if (ok) el.pasteBox.value = "";
    });
  });

  function handleShareHash() {
    var match = /^#s=(.+)$/.exec(location.hash || "");
    if (!match) return;
    clearShareHash();
    receiveShareText(match[1], function () {
      showToast("That share link could not be read");
    });
  }

  // ---------- sync through a private repository ----------

  var syncConfig = loadSyncConfig();
  var syncTimer = null;
  var syncPoller = null;
  var syncInFlight = false;
  var applyingRemote = false;
  var syncQueued = false;
  var syncState = { kind: "idle", text: "", at: null };

  function bytesToBase64(bytes) {
    var binary = "";
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function textToBase64(text) {
    return bytesToBase64(new TextEncoder().encode(text));
  }

  function base64ToText(text) {
    var binary = atob(String(text).replace(/\s+/g, ""));
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function githubUrl(repo) {
    return "https://api.github.com/repos/" + repo + "/contents/" + SYNC_PATH;
  }

  function githubHeaders(token) {
    return {
      "Authorization": "Bearer " + token,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    };
  }

  function describeHttp(status) {
    if (status === 401) return "Token rejected — check it, or make a new one.";
    if (status === 403) return "GitHub refused. The token may lack Contents write access, or you have hit a rate limit.";
    if (status === 404) return "Repository or path not found. Check the owner/repo, and that the token can see it.";
    if (status === 409) return "Someone else wrote at the same moment.";
    return "GitHub returned " + status + ".";
  }

  // Reads the stored document. A 404 simply means nothing has been written yet.
  function fetchRemote(config) {
    return fetch(githubUrl(config.repo) + "?ref=HEAD&t=" + Date.now(), {
      headers: githubHeaders(config.token),
      cache: "no-store"
    }).then(function (response) {
      if (response.status === 404) return { doc: null, sha: null };
      if (!response.ok) throw { http: response.status };
      return response.json().then(function (body) {
        var doc = null;
        try {
          doc = JSON.parse(base64ToText(body.content || ""));
        } catch (e) {
          doc = null;
        }
        return { doc: doc, sha: body.sha || null };
      });
    });
  }

  function putRemote(config, doc, sha) {
    var payload = {
      message: "Update baby log (" + new Date().toISOString() + ")",
      content: textToBase64(JSON.stringify(doc, null, 1))
    };
    if (sha) payload.sha = sha;
    return fetch(githubUrl(config.repo), {
      method: "PUT",
      headers: githubHeaders(config.token),
      body: JSON.stringify(payload)
    }).then(function (response) {
      if (!response.ok) throw { http: response.status };
      return response.json().then(function (body) {
        return (body.content && body.content.sha) || null;
      });
    });
  }

  function localDocument() {
    return {
      app: "baby-tracker",
      version: 1,
      meta: {
        name: loadName(),
        dob: loadDob(),
        feeding: loadFeeding(),
        intervals: { feed: intervals.feed, diaper: intervals.diaper, sleep: intervals.sleep },
        updatedAt: metaStamp()
      },
      events: events,
      plans: plans
    };
  }

  function mergePlans(remotePlans) {
    var byId = {};
    plans.forEach(function (p) { byId[p.id] = p; });
    var changed = 0;
    (remotePlans || []).forEach(function (raw) {
      var plan = normalisePlan(raw);
      if (!plan || !plan.id) return;
      if (tombstoneExpired(plan)) return;
      var existing = byId[plan.id];
      if (!existing) {
        plans.push(plan);
        byId[plan.id] = plan;
        changed++;
      } else if (plan.updatedAt > updatedAtOf(existing)) {
        plans[plans.indexOf(existing)] = plan;
        byId[plan.id] = plan;
        changed++;
      }
    });
    return changed;
  }

  // Same rule as an imported file: newer wins per entry, ties keep what is here.
  function mergeIntoLocal(remoteEvents) {
    var byId = {};
    events.forEach(function (e) { byId[e.id] = e; });
    var changed = 0;
    (remoteEvents || []).forEach(function (raw) {
      var entry = normaliseImported(raw);
      if (!entry || !entry.id) return;
      if (tombstoneExpired(entry)) return;
      var existing = byId[entry.id];
      if (!existing) {
        events.push(entry);
        byId[entry.id] = entry;
        changed++;
      } else if (entry.updatedAt > updatedAtOf(existing)) {
        events[events.indexOf(existing)] = entry;
        byId[entry.id] = entry;
        changed++;
      }
    });
    return changed;
  }

  function remoteHasNothingOfOurs(remoteEvents) {
    var remoteById = {};
    (remoteEvents || []).forEach(function (e) { if (e && e.id) remoteById[e.id] = e; });
    return events.some(function (e) {
      var mirror = remoteById[e.id];
      return !mirror || updatedAtOf(e) > (mirror.updatedAt || mirror.time);
    });
  }

  function remoteMissesOurPlans(remotePlans) {
    var remoteById = {};
    (remotePlans || []).forEach(function (p) { if (p && p.id) remoteById[p.id] = p; });
    return plans.some(function (p) {
      var mirror = remoteById[p.id];
      return !mirror || updatedAtOf(p) > (mirror.updatedAt || "");
    });
  }

  function setSyncState(kind, text) {
    syncState = { kind: kind, text: text, at: kind === "ok" ? new Date() : syncState.at };
    renderSyncState();
  }

  function renderSyncState() {
    var node = el.syncStatus;
    node.classList.remove("is-ok", "is-busy", "is-bad");
    if (!syncConfig) {
      node.textContent = "Not connected. This phone keeps its entries to itself.";
      el.syncNow.hidden = true;
      el.syncDisconnect.hidden = true;
      el.syncConnect.textContent = "Connect and sync";
      return;
    }
    el.syncNow.hidden = false;
    el.syncDisconnect.hidden = false;
    el.syncConnect.textContent = "Save changes";
    if (syncState.kind === "busy") node.classList.add("is-busy");
    if (syncState.kind === "ok") node.classList.add("is-ok");
    if (syncState.kind === "bad") node.classList.add("is-bad");
    var when = syncState.at ? " · last synced " + formatClockTime(syncState.at) : "";
    node.textContent = (syncState.text || "Connected to " + syncConfig.repo) + when;
  }

  function syncNow(reason) {
    if (!syncConfig) return Promise.resolve(false);
    if (syncInFlight) {
      syncQueued = true;
      return Promise.resolve(false);
    }
    syncInFlight = true;
    setSyncState("busy", "Syncing…");

    var attempt = function (remaining) {
      var config = syncConfig;
      return fetchRemote(config).then(function (found) {
        var remoteDoc = found.doc || {};
        var remoteEvents = Array.isArray(remoteDoc.events) ? remoteDoc.events : [];
        var pulled = mergeIntoLocal(remoteEvents);
        var remotePlans = Array.isArray(remoteDoc.plans) ? remoteDoc.plans : [];
        var pulledPlans = mergePlans(remotePlans);
        if (pulledPlans) savePlans(plans);

        var remoteMeta = remoteDoc.meta;
        applyingRemote = true;
        try {
          if (remoteMeta) {
            var stampBefore = metaStamp();
            // Genuinely newer settings replace ours. Otherwise we still take
            // what we are missing, which is how a phone joining an existing
            // log gets set up — and how logs written before settings carried
            // a timestamp still fill in a blank phone.
            var remoteNewer = (remoteMeta.updatedAt || "") > metaStamp();
            applyIncomingSettings({
              name: remoteMeta.name,
              dob: remoteMeta.dob,
              feeding: remoteMeta.feeding,
              intervals: remoteMeta.intervals,
              takeIntervals: remoteNewer,
              overwrite: remoteNewer
            });
            // Adopt their stamp rather than stamping ourselves, or each pull
            // would look like a local edit and push straight back.
            // Filling in blanks is not a local edit, so keep our own stamp
            // where it was rather than claiming to be the newer side.
            setMetaStamp(remoteNewer ? remoteMeta.updatedAt : stampBefore);
          }
          if (pulled) saveEvents(events);
        } finally {
          applyingRemote = false;
        }
        if (pulledPlans) renderPlans();
        if (pulled || remoteMeta) renderAll();

        // Drop what has aged out before comparing, so the cleaned-up log is
        // what gets compared and sent.
        var pruned = pruneTombstones();
        if (pruned) saveEvents(events);
        if (prunePlanTombstones()) savePlans(plans);

        var remoteCarriesExpired = remoteEvents.some(tombstoneExpired) ||
          remotePlans.some(tombstoneExpired);
        var mustPush = !found.sha || remoteCarriesExpired || remoteHasNothingOfOurs(remoteEvents) ||
          remoteMissesOurPlans(remotePlans) ||
          metaStamp() > ((remoteMeta && remoteMeta.updatedAt) || "");
        if (!mustPush) return { pulled: pulled, pushed: 0 };

        return putRemote(config, localDocument(), found.sha).then(function (sha) {
          syncConfig.sha = sha;
          saveSyncConfig(syncConfig);
          return { pulled: pulled, pushed: 1 };
        }).catch(function (err) {
          // Another phone committed between our read and our write.
          if (err && err.http === 409 && remaining > 0) return attempt(remaining - 1);
          throw err;
        });
      });
    };

    return attempt(SYNC_RETRIES).then(function (result) {
      syncInFlight = false;
      setSyncState("ok", "Connected to " + syncConfig.repo);
      if (result.pulled) {
        showToast("Synced — " + result.pulled + (result.pulled === 1 ? " entry" : " entries") + " from the other phone");
      }
      if (syncQueued) {
        syncQueued = false;
        scheduleSync(1000);
      }
      return true;
    }).catch(function (err) {
      syncInFlight = false;
      syncQueued = false;
      var message = (err && err.http) ? describeHttp(err.http) : "No connection to GitHub.";
      setSyncState("bad", message);
      if (reason === "manual") showToast("Sync failed. " + message);
      return false;
    });
  }

  // A burst of taps should become one commit, not one each.
  function scheduleSync(delay) {
    if (!syncConfig || applyingRemote) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(function () { syncNow("auto"); }, delay || SYNC_DEBOUNCE);
  }

  function startSyncPolling() {
    clearInterval(syncPoller);
    if (!syncConfig) return;
    syncPoller = setInterval(function () {
      if (!document.hidden) syncNow("poll");
    }, SYNC_POLL);
  }

  el.syncConnect.addEventListener("click", function () {
    var repo = el.syncRepo.value.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/\/+$/, "");
    var token = el.syncToken.value.trim();
    if (!/^[^\/\s]+\/[^\/\s]+$/.test(repo)) {
      setSyncState("bad", "Give the repository as owner/name, for example jane/baby-log.");
      return;
    }
    if (!token) {
      setSyncState("bad", "Paste the access token as well.");
      return;
    }
    syncConfig = { repo: repo, token: token, sha: null };
    if (!saveSyncConfig(syncConfig)) return;
    renderSyncState();
    startSyncPolling();
    syncNow("manual").then(function (ok) {
      if (ok) showToast("Connected. Both phones will keep themselves in step.");
    });
  });

  el.syncNow.addEventListener("click", function () { syncNow("manual"); });

  el.syncDisconnect.addEventListener("click", function () {
    syncConfig = null;
    saveSyncConfig(null);
    clearTimeout(syncTimer);
    clearInterval(syncPoller);
    el.syncToken.value = "";
    renderSyncState();
    showToast("Disconnected. Your entries stay on this phone.");
  });

  // ---------- name ----------

  // A font the phone does not have fails silently: the browser drops to the
  // next in the stack and two options end up looking identical. Measuring a
  // string in the candidate against each generic says whether it is really
  // there, so only styles that will actually look different get offered.
  var fontProbeCtx = null;
  function fontAvailable(family) {
    if (!fontProbeCtx) {
      var canvas = document.createElement("canvas");
      fontProbeCtx = canvas.getContext && canvas.getContext("2d");
    }
    if (!fontProbeCtx) return false;
    var sample = "WMmiiil1Laetitia";
    var generics = ["monospace", "sans-serif", "serif"];
    for (var i = 0; i < generics.length; i++) {
      fontProbeCtx.font = "48px " + generics[i];
      var plain = fontProbeCtx.measureText(sample).width;
      fontProbeCtx.font = '48px "' + family + '", ' + generics[i];
      if (fontProbeCtx.measureText(sample).width !== plain) return true;
    }
    return false;
  }

  function availableNameFonts() {
    return NAME_FONTS.filter(function (font) {
      if (!font.probe.length) return true;
      return font.probe.some(fontAvailable);
    });
  }

  function loadNameFont() {
    var saved = localStorage.getItem(NAME_FONT_KEY);
    var known = availableNameFonts().some(function (f) { return f.id === saved; });
    return known ? saved : DEFAULT_NAME_FONT;
  }

  function saveNameFont(id) {
    localStorage.setItem(NAME_FONT_KEY, id);
  }

  function applyNameFont(node, id) {
    NAME_FONTS.forEach(function (font) {
      node.classList.toggle("nf-" + font.id, font.id === id);
    });
  }

  function renderName() {
    var name = loadName().trim();
    el.babyNameDisplay.textContent = name || "Baby's name";
    el.babyNameDisplay.classList.toggle("is-empty", !name);
    applyNameFont(el.babyNameDisplay, loadNameFont());
  }

  var nameFontsOpen = false;

  function toggleNameFonts(open) {
    nameFontsOpen = open;
    el.nameFontsPanel.hidden = !open;
    el.nameFontsToggle.classList.toggle("expanded", open);
    el.nameFontsToggle.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function renderNameFonts() {
    var current = loadNameFont();
    // Folded away by default: eight big previews is the tallest thing on the
    // screen, and it is a choice made once. The name of the current style
    // sits on the closed row so it still answers what is set.
    var currentFont = null;
    availableNameFonts().forEach(function (font) {
      if (font.id === current) currentFont = font;
    });
    el.nameFontsCurrent.textContent = currentFont ? currentFont.label : "";
    // The chip shows the real name, since that is the only preview that
    // answers the question being asked.
    var sample = loadName().trim() || "Baby";
    el.nameFonts.innerHTML = "";
    availableNameFonts().forEach(function (font) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "name-chip nf-" + font.id + (font.id === current ? " is-selected" : "");
      chip.textContent = sample;
      chip.title = font.label;
      chip.setAttribute("aria-label", font.label);
      chip.setAttribute("aria-pressed", font.id === current ? "true" : "false");
      chip.addEventListener("click", function () {
        saveNameFont(font.id);
        renderNameFonts();
        renderName();
      });
      el.nameFonts.appendChild(chip);
    });
  }

  // Every time in the app is stored in UTC and shown through the browser's own
  // local methods, so the zone is whatever the phone is set to. Printing it
  // makes that checkable: a log an hour out is a phone an hour out, and this
  // is where you find that.
  function localZoneName() {
    try {
      var zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (zone) return zone;
    } catch (e) { /* older browsers simply have no name to give */ }
    return "";
  }

  function localZoneOffset() {
    var mins = -new Date().getTimezoneOffset();
    var sign = mins < 0 ? "-" : "+";
    var abs = Math.abs(mins);
    return "UTC" + sign + pad2(Math.floor(abs / 60)) + ":" + pad2(abs % 60);
  }

  function describeZone() {
    var name = localZoneName();
    return name ? name + " (" + localZoneOffset() + ")" : localZoneOffset();
  }

  function renderZone() {
    el.settingsZone.textContent = "Times shown in " + describeZone() +
      ", taken from this phone. Change it in the phone's own settings.";
  }

  function renderDobEcho() {
    var days = ageDaysAt(new Date());
    el.babyDobEcho.textContent = days === null
      ? "Not set — the app will assume the strictest temperature threshold."
      : "Today: " + formatAge(days) + " old";
  }

  // The same six the card offers, so the two never disagree about what a
  // recordable feed length is.
  function buildFedOptions() {
    FEED_MINUTES.forEach(function (mins) {
      var node = document.createElement("option");
      node.value = String(mins);
      node.textContent = formatDuration(mins * MS_MIN);
      el.manualFed.appendChild(node);
    });
  }

  function buildFeedingOptions() {
    el.babyFeeding.innerHTML = "";
    FEEDING_OPTIONS.forEach(function (option) {
      var node = document.createElement("option");
      node.value = option.id;
      node.textContent = option.label;
      el.babyFeeding.appendChild(node);
    });
    el.babyFeeding.value = loadFeeding();
  }

  el.babyFeeding.addEventListener("change", function () {
    saveFeeding(el.babyFeeding.value);
    // The form's default and whether the question is asked at all both hang
    // off this, and neither should wait for a reload.
    if (!editingId) el.manualSource.value = defaultFedWith();
    syncManualFields();
    renderNextUp();
  });

  el.babyDob.value = loadDob();
  el.babyDob.addEventListener("change", function () {
    saveDob(el.babyDob.value);
    renderDobEcho();
    renderAll();
  });

  el.babyName.value = loadName();
  el.babyName.addEventListener("input", function () {
    saveName(el.babyName.value);
    renderName();
    renderNameFonts();
  });

  // ---------- what's coming up ----------

  var plans = loadPlans();
  var planFormOpen = false;
  var editingPlanId = null;

  function livePlans() {
    return plans.filter(function (p) { return !isDeleted(p); });
  }

  function prunePlanTombstones() {
    var before = plans.length;
    plans = plans.filter(function (p) { return !tombstoneExpired(p); });
    return before - plans.length;
  }

  // Local midnight, so an appointment belongs to the day it is written on
  // rather than to whatever UTC makes of it.
  function planStart(plan) {
    var parts = String(plan.date || "").split("-");
    if (parts.length !== 3) return NaN;
    var hours = 0;
    var minutes = 0;
    var time = String(plan.time || "").split(":");
    if (time.length === 2) {
      hours = parseInt(time[0], 10) || 0;
      minutes = parseInt(time[1], 10) || 0;
    }
    return +new Date(+parts[0], parts[1] - 1, +parts[2], hours, minutes, 0, 0);
  }

  function sortedPlans() {
    return livePlans().slice().sort(function (a, b) { return planStart(a) - planStart(b); });
  }

  function planWhen(plan) {
    var at = new Date(planStart(plan));
    var midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    var days = Math.round((+new Date(at.getFullYear(), at.getMonth(), at.getDate()) - +midnight) / MS_DAY);
    var day = days === 0 ? "Today" : days === 1 ? "Tomorrow" : days === -1 ? "Yesterday"
      : formatDateHeader(at);
    return plan.time ? day + " at " + formatClockTime(at) : day;
  }

  // Three headings, because a parent asks "is it today", "is it this week" or
  // "is it later" and never anything finer than that.
  function planBucket(plan, nowMs) {
    var start = planStart(plan);
    var midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    if (start < +midnight) return "past";
    if (start < +midnight + MS_DAY) return "today";
    if (start < +midnight + 7 * MS_DAY) return "week";
    return "later";
  }

  // The one that earns a line on the main screen: the next thing today or
  // tomorrow, and nothing else. Anything further off is not urgent enough to
  // put in front of somebody holding a baby.
  function nextPlanSoon() {
    var nowMidnight = new Date();
    nowMidnight.setHours(0, 0, 0, 0);
    var cutoff = +nowMidnight + 2 * MS_DAY;
    var found = null;
    sortedPlans().forEach(function (plan) {
      var start = planStart(plan);
      if (!isFinite(start) || start < +nowMidnight || start >= cutoff) return;
      if (!found) found = plan;
    });
    return found;
  }

  function renderPlanSoon() {
    var plan = nextPlanSoon();
    el.planSoon.hidden = !plan;
    if (plan) el.planSoonText.textContent = planWhen(plan) + " — " + plan.title;
  }

  function planRow(plan) {
    var row = document.createElement("div");
    row.className = "plan-item";
    row.innerHTML =
      '<div class="plan-body">' +
        '<div class="plan-when">' + escapeHtml(planWhen(plan)) + '</div>' +
        '<div class="plan-title">' + escapeHtml(plan.title) + '</div>' +
        (plan.place ? '<div class="plan-detail">' + escapeHtml(plan.place) + '</div>' : '') +
        (plan.note ? '<div class="plan-note">' + escapeHtml(plan.note) + '</div>' : '') +
      '</div>' +
      '<div class="plan-actions">' +
        '<button class="plan-ics" data-ics="' + escapeHtml(plan.id) + '">Add to phone calendar</button>' +
        '<button class="plan-edit" data-edit="' + escapeHtml(plan.id) + '">Edit</button>' +
        '<button class="plan-delete" data-plan="' + escapeHtml(plan.id) + '" aria-label="Delete">✕</button>' +
      '</div>';
    return row;
  }

  function renderPlanList() {
    el.planList.innerHTML = "";
    var all = sortedPlans();
    if (!all.length) {
      var empty = document.createElement("div");
      empty.className = "log-empty";
      empty.textContent = "Nothing in the diary yet";
      el.planList.appendChild(empty);
      return;
    }

    var now = Date.now();
    var buckets = { today: [], week: [], later: [], past: [] };
    all.forEach(function (plan) { buckets[planBucket(plan, now)].push(plan); });
    // Most recent first among the ones already gone, and only the recent past:
    // last spring's midwife appointment is not something anybody scrolls to.
    buckets.past = buckets.past.filter(function (plan) {
      return now - planStart(plan) < PLAN_PAST_SHOWN;
    }).reverse();

    [["today", "Today"], ["week", "This week"], ["later", "Later"], ["past", "Just gone"]]
      .forEach(function (pair) {
        var list = buckets[pair[0]];
        if (!list.length) return;
        var heading = document.createElement("div");
        heading.className = "plan-heading";
        heading.textContent = pair[1];
        el.planList.appendChild(heading);
        list.forEach(function (plan) { el.planList.appendChild(planRow(plan)); });
      });
  }

  function renderPlans() {
    renderPlanList();
    renderPlanSoon();
  }

  function renderPlanChips() {
    el.planChips.innerHTML = "";
    PLAN_TITLES.forEach(function (title) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "plan-chip";
      chip.textContent = title;
      chip.addEventListener("click", function () {
        el.planTitle.value = title;
        el.planDate.focus();
      });
      el.planChips.appendChild(chip);
    });
  }

  function showPlanError(msg) {
    el.planError.textContent = msg;
    el.planError.hidden = false;
  }

  function resetPlanForm() {
    editingPlanId = null;
    el.planTitle.value = "";
    el.planDate.value = "";
    el.planTime.value = "";
    el.planPlace.value = "";
    el.planNote.value = "";
    el.planError.hidden = true;
    el.planSubmit.textContent = "Add it";
    el.planCancel.hidden = true;
  }

  function openPlanForm(open) {
    planFormOpen = open;
    el.planForm.hidden = !open;
    el.planAddToggleText.textContent = open ? "Hide the form" : "Add an appointment";
    if (!open) resetPlanForm();
  }

  function startPlanEdit(id) {
    var found = livePlans().filter(function (p) { return p.id === id; })[0];
    if (!found) return;
    editingPlanId = id;
    openPlanForm(true);
    el.planTitle.value = found.title;
    el.planDate.value = found.date;
    el.planTime.value = found.time || "";
    el.planPlace.value = found.place || "";
    el.planNote.value = found.note || "";
    el.planError.hidden = true;
    el.planSubmit.textContent = "Save";
    el.planCancel.hidden = false;
    el.planForm.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function addPlan(fields) {
    var plan = {
      id: uuid(),
      title: fields.title,
      date: fields.date
    };
    if (fields.time) plan.time = fields.time;
    if (fields.place) plan.place = fields.place;
    if (fields.note) plan.note = fields.note;
    touch(plan);
    plans.push(plan);
    return plan;
  }

  el.planAddToggle.addEventListener("click", function () { openPlanForm(!planFormOpen); });
  el.planCancel.addEventListener("click", function () { openPlanForm(false); });

  el.planSubmit.addEventListener("click", function () {
    var title = cleanText(el.planTitle.value, MAX_PLAN_TITLE);
    var date = el.planDate.value;
    if (!title) {
      showPlanError("Give it a name, so you know what it is");
      return;
    }
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      showPlanError("Pick a date");
      return;
    }
    var fields = {
      title: title,
      date: date,
      time: /^\d{2}:\d{2}$/.test(el.planTime.value) ? el.planTime.value : "",
      place: cleanText(el.planPlace.value, MAX_PLAN_PLACE),
      note: cleanText(el.planNote.value, MAX_PLAN_NOTE)
    };

    if (editingPlanId) {
      var target = plans.filter(function (p) { return p.id === editingPlanId; })[0];
      if (!target) {
        openPlanForm(false);
        return;
      }
      target.title = fields.title;
      target.date = fields.date;
      if (fields.time) target.time = fields.time; else delete target.time;
      if (fields.place) target.place = fields.place; else delete target.place;
      if (fields.note) target.note = fields.note; else delete target.note;
      touch(target);
      if (!savePlans(plans)) return;
      openPlanForm(false);
      renderPlans();
      showToast("Appointment updated");
      return;
    }

    addPlan(fields);
    if (!savePlans(plans)) return;
    openPlanForm(false);
    renderPlans();
    showToast("Added to the diary");
  });

  el.planList.addEventListener("click", function (ev) {
    var remove = ev.target.closest("[data-plan]");
    if (remove) {
      deletePlan(remove.getAttribute("data-plan"));
      return;
    }
    var edit = ev.target.closest("[data-edit]");
    if (edit) {
      startPlanEdit(edit.getAttribute("data-edit"));
      return;
    }
    var ics = ev.target.closest("[data-ics]");
    if (ics) downloadIcs(ics.getAttribute("data-ics"));
  });

  function deletePlan(id) {
    var target = plans.filter(function (p) { return p.id === id; })[0];
    if (!target) return;
    // A tombstone, for the same reason entries get one: the other phone has
    // to be told it went, and carrying the detail would defeat deleting it.
    var carried = { title: target.title, date: target.date, time: target.time,
      place: target.place, note: target.note };
    delete target.time;
    delete target.place;
    delete target.note;
    target.title = "";
    target.deleted = true;
    touch(target);
    if (!savePlans(plans)) return;
    renderPlans();
    showToast("Appointment deleted", function () {
      delete target.deleted;
      target.title = carried.title;
      target.date = carried.date;
      if (carried.time) target.time = carried.time;
      if (carried.place) target.place = carried.place;
      if (carried.note) target.note = carried.note;
      touch(target);
      if (!savePlans(plans)) return;
      renderPlans();
    });
  }

  // ---------- handing an appointment to the phone's own calendar ----------

  function icsStamp(ms) {
    var d = new Date(ms);
    function pad(n) { return String(n).padStart ? String(n).padStart(2, "0") : pad2(n); }
    return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + "T" +
      pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + "00Z";
  }

  function icsDate(date) {
    return String(date).replace(/-/g, "");
  }

  // Long lines have to be folded and commas escaped, or half the calendar
  // apps on earth quietly drop the event.
  function icsEscape(text) {
    return String(text || "").replace(/\\/g, "\\\\").replace(/[,;]/g, function (m) {
      return "\\" + m;
    }).replace(/\r?\n/g, "\\n");
  }

  function buildIcs(plan) {
    var lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Baby Tracker//EN",
      "BEGIN:VEVENT",
      "UID:" + plan.id + "@baby-tracker",
      "DTSTAMP:" + icsStamp(Date.now())
    ];
    if (plan.time) {
      var start = planStart(plan);
      lines.push("DTSTART:" + icsStamp(start));
      lines.push("DTEND:" + icsStamp(start + MS_HOUR));
    } else {
      // No time given means the whole day, which is what a date-only VEVENT
      // is for — better than inventing 9am and reminding them at the wrong
      // moment.
      var next = new Date(planStart(plan) + MS_DAY);
      lines.push("DTSTART;VALUE=DATE:" + icsDate(plan.date));
      lines.push("DTEND;VALUE=DATE:" + icsDate(
        next.getFullYear() + "-" + pad2(next.getMonth() + 1) + "-" + pad2(next.getDate())));
    }
    lines.push("SUMMARY:" + icsEscape(plan.title));
    if (plan.place) lines.push("LOCATION:" + icsEscape(plan.place));
    if (plan.note) lines.push("DESCRIPTION:" + icsEscape(plan.note));
    lines.push("END:VEVENT");
    lines.push("END:VCALENDAR");
    return lines.join("\r\n");
  }

  function downloadIcs(id) {
    var plan = livePlans().filter(function (p) { return p.id === id; })[0];
    if (!plan) return;
    var safe = plan.title.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
    if (downloadFile((safe || "appointment") + ".ics", buildIcs(plan), "text/calendar;charset=utf-8")) {
      showToast("Open it to add it to your calendar");
    }
  }

  // ---------- the routine schedule ----------

  el.planJabs.addEventListener("click", function () {
    var dob = dobDate();
    if (!dob) {
      showToast("Set the date of birth in Settings first");
      return;
    }
    var existing = {};
    livePlans().forEach(function (plan) { existing[plan.title + "|" + plan.date] = true; });
    var added = 0;
    IMMUNISATION_WEEKS.forEach(function (jab) {
      // Counted in calendar days, not in milliseconds: adding 112 days' worth
      // of ms across the October clock change lands an hour short and reports
      // the day before.
      var at = new Date(dob.getFullYear(), dob.getMonth(), dob.getDate() + jab.weeks * 7);
      var date = at.getFullYear() + "-" + pad2(at.getMonth() + 1) + "-" + pad2(at.getDate());
      if (existing[jab.label + "|" + date]) return;
      addPlan({ title: jab.label, date: date, time: "", place: "",
        note: "Routine date — your letter decides it" });
      added++;
    });
    if (!added) {
      showToast("They are already in the diary");
      return;
    }
    if (!savePlans(plans)) return;
    renderPlans();
    showToast(added + (added === 1 ? " date added" : " dates added") + " — edit them when the letter comes");
  });

  el.planOpenBtn.addEventListener("click", function () {
    renderPlans();
    showScreen("plan");
  });
  el.planBack.addEventListener("click", showMain);
  el.planSoonBtn.addEventListener("click", function () {
    renderPlans();
    showScreen("plan");
  });

  // ---------- ask an AI ----------

  // Counts for one calendar day, in the same shape the day headings already
  // use, so the summary agrees with what the parent can see in the log.
  function aiDayStats(dayStart, analysis) {
    var dayEnd = dayStart + MS_DAY;
    var out = { feeds: 0, fedMs: 0, fedCount: 0, bySource: {}, nappies: 0, wet: 0, dirty: 0, sleepMs: 0 };
    liveEvents().forEach(function (e) {
      var t = +new Date(e.time);
      if (t < dayStart || t >= dayEnd) return;
      if (e.type === "feed") {
        out.feeds++;
        var mins = fedMinutesOf(e);
        if (mins !== null) {
          out.fedMs += mins * MS_MIN;
          out.fedCount++;
        }
        var source = fedWithOf(e);
        if (source) out.bySource[source] = (out.bySource[source] || 0) + 1;
      }
      if (e.type !== "diaper") return;
      out.nappies++;
      var kind = nappyOf(e);
      if (kind === "wet" || kind === "both") out.wet++;
      if (kind === "dirty" || kind === "both") out.dirty++;
    });
    out.sleepMs = sleepMsInRange(analysis, dayStart, dayEnd, Date.now());
    return out;
  }

  // The latest reading of each kind, with the one before it for direction.
  // Growth belongs on a centile chart, so this states the numbers and leaves
  // the reading of them alone.
  function aiMeasureLines() {
    var lines = [];
    MEASURE_ORDER.forEach(function (type) {
      if (MEASURES[type].freeform) return;
      var list = measurementsOf(type);
      if (!list.length) return;
      var last = list[list.length - 1];
      var line = MEASURES[type].label + ": " +
        formatMeasure(type, measureValueOf(last)) + " on " + formatDateHeader(new Date(last.time));
      if (list.length > 1) {
        var prev = list[list.length - 2];
        line += " (was " + formatMeasure(type, measureValueOf(prev)) +
          " on " + formatDateHeader(new Date(prev.time)) + ")";
      }
      lines.push(line);
    });
    // Freeform readings are unbounded — a parent could name fifty of them —
    // and a prompt is not the place to discover that.
    knownMeasureLabels().slice(0, AI_MAX_FREEFORM).forEach(function (known) {
      var list = measurementsOf("other", known.label);
      if (!list.length) return;
      var last = list[list.length - 1];
      lines.push(known.label + ": " + formatMeasure("other", measureValueOf(last), known.unit) +
        " on " + formatDateHeader(new Date(last.time)));
    });
    return lines;
  }

  // Gaps inside the chosen window only. The forecast's own figure is the median
  // of the last five across all of history, which answers a different question
  // — what to expect next — and would quietly contradict the days listed above
  // it. Anything under ten minutes is a double tap, not a feed.
  function aiGaps(kind, sinceMs) {
    var asc = sortedByTimeAsc(eventsOfKind(kind).filter(function (e) {
      return +new Date(e.time) >= sinceMs;
    }));
    var gaps = [];
    for (var i = 1; i < asc.length; i++) {
      var ms = +new Date(asc[i].time) - +new Date(asc[i - 1].time);
      if (ms >= MIN_VALID_INTERVAL) gaps.push({ ms: ms, startedAt: new Date(asc[i - 1].time) });
    }
    return gaps;
  }

  function aiGapLine(label, gaps) {
    if (!gaps.length) return "";
    var lengths = gaps.map(function (g) { return g.ms; });
    var shortest = Math.min.apply(null, lengths);
    var longest = Math.max.apply(null, lengths);
    var line = label + ": typically " + formatDuration(median(lengths));
    // One number is a summary; three are a picture, and the spread is what
    // tells a stranger whether the routine is settled or all over the place.
    if (longest > shortest) {
      line += " (shortest " + formatDuration(shortest) + ", longest " + formatDuration(longest) + ")";
    }
    return line;
  }

  // The number every parent actually wants: the longest stretch they got at
  // night. Defined by when the gap began so a 3am feed cannot be counted as
  // the start of a daytime one.
  function aiNightGap(gaps) {
    var best = 0;
    gaps.forEach(function (g) {
      var hour = g.startedAt.getHours();
      if (hour >= AI_NIGHT_FROM || hour < AI_NIGHT_TO) best = Math.max(best, g.ms);
    });
    return best;
  }

  function aiLongestSleep(analysis, sinceMs) {
    var best = 0;
    analysis.sessions.forEach(function (session) {
      if (session.endMs < sinceMs) return;
      best = Math.max(best, session.endMs - Math.max(session.startMs, sinceMs));
    });
    return best;
  }

  // Where the plan says the next few will fall, and what that would make of
  // today. Without this an assistant reads six feeds at teatime as a finished
  // day; with it, the same six plus three still to come is plainly a normal
  // day in progress. Clearly labelled as the plan rather than as data — it is
  // arithmetic on an interval the parent set, not a prediction of the baby.
  function aiExpectedLine(kind, label) {
    var forecast = computeForecast(kind);
    if (!forecast.hasData) return null;
    var gapMs = forecast.plannedMin * MS_MIN;
    if (gapMs <= 0) return null;

    var now = Date.now();
    var midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    var endOfDay = +midnight + MS_DAY;

    // A plan left far behind — nothing logged since yesterday — would otherwise
    // print times in the past. Stepped forward by arithmetic rather than by a
    // loop: a 10-minute interval and a log a year stale is half a million
    // iterations on somebody's phone.
    var at = +forecast.nextTime;
    if (at < now) at += Math.ceil((now - at) / gapMs) * gapMs;

    var times = [];
    for (var i = 0; i < AI_EXPECTED_AHEAD; i++) {
      var cursor = at + i * gapMs;
      times.push(formatClockTime(new Date(cursor)) + (cursor >= endOfDay ? " tomorrow" : ""));
    }
    // Counted, not listed: three shown is enough to read the rhythm, but a
    // long evening holds more than three and the total has to say so.
    var beforeMidnight = at >= endOfDay ? 0 : Math.ceil((endOfDay - at) / gapMs);

    return { label: label, times: times, stillToCome: beforeMidnight, everyMs: gapMs };
  }

  // A digest, not the log itself: a fortnight of raw entries would neither fit
  // in a link nor read any better once it got there.
  function aiSummary(days) {
    var prefs = loadAiPrefs();
    var analysis = analyzeSleep();
    var typed = loadName().trim();
    var who = (prefs.name && typed) ? typed : "the baby";
    var out = [];

    out.push(who === "the baby" ? "Baby log" : who + " — log");
    var ageDays = ageDaysAt(Date.now());
    if (ageDays !== null) out.push("Age: " + formatAge(ageDays));
    out.push("");

    var feedingOn = feedingOption(loadFeeding());
    if (feedingOn && feedingOn.summary) out.push("Fed: " + feedingOn.summary);
    out.push("");

    var now = new Date();
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var elapsedMs = +now - +today;
    var since = +today - (days - 1) * MS_DAY;

    // The mistake this exists to prevent: an assistant reads "6 feeds" against
    // a 24-hour guide and tells a frightened parent their newborn is
    // underfed, when the day is half over. Said before the numbers, in the
    // plainest words available.
    out.push("It is now " + formatClockTime(now) + " on " + formatDateHeader(now) +
      " (" + describeZone() + "), so today " +
      "is " + formatDuration(elapsedMs) + " old out of 24h and today's line below is a part " +
      "day, not a whole one. Do not measure it against a whole-day figure and do not call it " +
      "low because the day has not finished — compare it with the same stretch of an earlier " +
      "day, or read the complete days instead.");
    out.push("");

    var counted = 0;
    // Two tallies, because they answer different questions. `totals` is only
    // ever complete days, since a rate per day computed over a part day is
    // simply wrong. `everything` is every day shown, for the figures that are
    // per feed or a proportion, which a part day does not distort.
    var totals = { feeds: 0, nappies: 0, wet: 0, dirty: 0, sleepMs: 0, fedMs: 0 };
    var everything = { feeds: 0, fedMs: 0, fedCount: 0, bySource: {} };
    var shown = 0;
    var todayStats = { feeds: 0, nappies: 0 };
    for (var i = 0; i < days; i++) {
      var dayStart = +today - i * MS_DAY;
      var stats = aiDayStats(dayStart, analysis);
      if (!stats.feeds && !stats.nappies && !stats.sleepMs) continue;
      shown++;
      if (i === 0) todayStats = stats;
      everything.feeds += stats.feeds;
      everything.fedMs += stats.fedMs;
      everything.fedCount += stats.fedCount;
      FEED_SOURCES.forEach(function (source) {
        if (stats.bySource[source.id]) {
          everything.bySource[source.id] =
            (everything.bySource[source.id] || 0) + stats.bySource[source.id];
        }
      });
      // Today is reported but never averaged. A part day in the mean drags
      // every figure below what the parent is actually doing.
      if (i > 0) {
        counted++;
        totals.feeds += stats.feeds;
        totals.fedMs += stats.fedMs;
        totals.nappies += stats.nappies;
        totals.wet += stats.wet;
        totals.dirty += stats.dirty;
        totals.sleepMs += stats.sleepMs;
      }
      var feedPart = stats.feeds + (stats.feeds === 1 ? " feed" : " feeds");
      if (stats.fedMs) feedPart += " (" + formatDuration(stats.fedMs) + " feeding)";
      var parts = [feedPart];
      var nappies = stats.nappies + (stats.nappies === 1 ? " nappy" : " nappies");
      if (stats.wet || stats.dirty) nappies += " (" + stats.wet + " wet, " + stats.dirty + " dirty)";
      parts.push(nappies);
      parts.push(formatDuration(stats.sleepMs) + " sleep");
      out.push((i === 0
        ? "PART DAY — today, " + formatDuration(elapsedMs) + " in of 24h"
        : formatDateHeader(new Date(dayStart)) + " (complete day)") +
        ": " + parts.join(", "));
    }
    if (!shown) {
      out.push("Nothing logged in this period.");
      return out.join("\n");
    }
    // Said straight after the day lines, where the part-day number is still in
    // view and the wrong conclusion is still available to draw.
    var expected = [];
    [["feed", "feeds", todayStats.feeds], ["diaper", "nappies", todayStats.nappies]]
      .forEach(function (pair) {
        var line = aiExpectedLine(pair[0], pair[1]);
        if (!line) return;
        var text = "Next " + pair[1] + " due on the plan (every " +
          formatDuration(line.everyMs) + "): " + line.times.join(", ") + ".";
        if (line.stillToCome) {
          text += " That is " + line.stillToCome + " more before midnight, which would make " +
            "about " + (pair[2] + line.stillToCome) + " " + pair[1] + " for the whole of today.";
        } else {
          text += " None before midnight.";
        }
        expected.push(text);
      });
    if (expected.length) {
      out.push("");
      expected.forEach(function (line) { out.push(line); });
    }

    out.push("");
    if (!counted) {
      out.push("No complete day to average yet — everything above is today, and today is not " +
        "over. Nothing here can be read as a daily rate.");
    } else {
      // Averaged over the complete days that have anything in them, not over
      // the period asked for: three days inside a fortnight is three days.
      out.push("Across the " + counted + " complete " + (counted === 1 ? "day" : "days") +
        " above, today excluded:");
      out.push("Feeds: " + totals.feeds + " in total, " + perDay(totals.feeds, counted) + " a day");
      out.push("Nappies: " + totals.nappies + " in total, " + perDay(totals.nappies, counted) +
        " a day — " + totals.wet + " wet, " + totals.dirty + " dirty");
      out.push("Sleep: " + formatDuration(Math.round(totals.sleepMs / counted)) + " a day on average");
    }

    var feedGaps = aiGaps("feed", since);
    var nappyGaps = aiGaps("diaper", since);
    var feedLine = aiGapLine("Gap between feeds", feedGaps);
    var nappyLine = aiGapLine("Gap between nappies", nappyGaps);
    if (feedLine) out.push(feedLine);
    if (nappyLine) out.push(nappyLine);

    var night = aiNightGap(feedGaps);
    if (night) {
      out.push("Longest gap between feeds overnight (one beginning between " +
        AI_NIGHT_FROM + ":00 and 0" + AI_NIGHT_TO + ":00): " + formatDuration(night));
    }
    var longestSleep = aiLongestSleep(analysis, since);
    if (longestSleep) out.push("Longest single sleep: " + formatDuration(longestSleep));

    // Only worth a line when the log actually distinguishes them: a purely
    // breastfed baby has already said so on the "Fed:" line above.
    var sourceParts = [];
    FEED_SOURCES.forEach(function (source) {
      if (everything.bySource[source.id]) {
        sourceParts.push(everything.bySource[source.id] + " " + source.label.toLowerCase());
      }
    });
    if (sourceParts.length > 1) out.push("Feeds by source: " + sourceParts.join(", "));

    out.push("");
    if (everything.fedCount) {
      var feedingLine = "Time feeding: " +
        formatDuration(Math.round(everything.fedMs / everything.fedCount)) + " a feed";
      if (counted) {
        feedingLine += ", " + formatDuration(Math.round(totals.fedMs / counted)) +
          " a day over the complete days";
      }
      if (everything.fedCount < everything.feeds) {
        feedingLine += " — recorded for " + everything.fedCount + " of the " +
          everything.feeds + " feeds";
      }
      out.push(feedingLine);
    } else {
      // Said plainly, because a model asked how long a feed lasts will
      // otherwise assume the log simply forgot to mention it.
      out.push("How long each feed took was not recorded.");
    }
    out.push("How much was taken is never recorded: this app counts feeds, not millilitres.");

    var measures = aiMeasureLines();
    if (measures.length) {
      out.push("");
      measures.forEach(function (line) { out.push(line); });
    }

    // What is coming, so "what should I ask on Thursday" has something to
    // work with. Only the near future: a jab due in eight months is not what
    // the question is about.
    var upcoming = [];
    var horizon = Date.now() + AI_PLAN_HORIZON;
    sortedPlans().forEach(function (plan) {
      var start = planStart(plan);
      if (start < Date.now() - MS_DAY || start > horizon) return;
      if (upcoming.length >= AI_MAX_PLANS) return;
      upcoming.push(planWhen(plan) + " — " + plan.title +
        (plan.place ? ", " + plan.place : "") +
        (plan.note ? " (" + plan.note + ")" : ""));
    });
    if (upcoming.length) {
      out.push("");
      out.push("Coming up:");
      upcoming.forEach(function (line) { out.push(line); });
    }

    return out.join("\n");
  }

  // The question goes last so it is the freshest thing the model reads, and
  // the framing goes first so it knows what the numbers are before it sees
  // them. The line about not being a doctor is not decoration: this is a log
  // of a newborn, and the questions asked of it will be medical-shaped.
  function aiPrompt(days, question) {
    var asked = cleanText(question, AI_MAX_QUESTION) || AI_FALLBACK_QUESTION;
    return "I keep a log of my baby's feeds, nappies and sleep — here is a summary of it. " +
      "Answer briefly and in plain language. You cannot examine my baby and you are not my " +
      "doctor: if something here looks worth a professional's eye, say so and tell me to ring " +
      "my health visitor, GP or NHS 111 rather than guessing at it.\n\n" +
      "--- summary ---\n" + aiSummary(days) + "\n--- end of summary ---\n\n" +
      "My question: " + asked;
  }

  function aiDays() {
    var days = parseInt(el.aiRange.value, 10);
    return isFinite(days) && days > 0 ? days : AI_DEFAULT_DAYS;
  }

  function aiCurrentPrompt() {
    return aiPrompt(aiDays(), el.aiQuestion.value);
  }

  function aiUrlFor(target, text) {
    var joiner = target.url.indexOf("?") >= 0 ? "&" : "?";
    var full = target.url + joiner + target.param + "=" + encodeURIComponent(text);
    return full.length <= AI_URL_LIMIT ? full : target.url;
  }

  function aiFitsInLink(text) {
    for (var i = 0; i < AI_TARGETS.length; i++) {
      if (aiUrlFor(AI_TARGETS[i], text) === AI_TARGETS[i].url) return false;
    }
    return true;
  }

  function renderAiPreview() {
    var text = aiCurrentPrompt();
    el.aiPreview.value = text;
    el.aiSize.textContent = describeSize(text.length) + " · " + (aiFitsInLink(text)
      ? "short enough to travel in the link itself"
      : "too long for a link — it gets copied instead, and you paste it into the chat");
  }

  function renderAiChips() {
    el.aiChips.innerHTML = "";
    AI_SUGGESTIONS.forEach(function (question) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "ai-chip";
      chip.textContent = question;
      chip.addEventListener("click", function () {
        el.aiQuestion.value = question;
        renderAiPreview();
      });
      el.aiChips.appendChild(chip);
    });
  }

  // Opened straight from the tap, before anything asynchronous: a window
  // asked for later is a pop-up as far as Safari is concerned.
  function askAi(target) {
    var text = aiCurrentPrompt();
    var url = aiUrlFor(target, text);
    var prefilled = url !== target.url;
    var opened = window.open(url, "_blank", "noopener");
    if (!prefilled) {
      copyText(text).then(function (ok) {
        showToast(ok
          ? "Too long for a link — it is copied, so paste it into " + target.label
          : "Too long for a link — copy it from the box above");
      });
    }
    if (!opened) {
      showToast("Your browser blocked the new tab — open " + target.label + " yourself");
    }
  }

  function renderAiTargets() {
    el.aiTargets.innerHTML = "";
    AI_TARGETS.forEach(function (target) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "data-btn ai-target";
      btn.textContent = "Ask " + target.label + " →";
      btn.addEventListener("click", function () { askAi(target); });
      el.aiTargets.appendChild(btn);
    });
  }

  function renderAiPrefs() {
    var prefs = loadAiPrefs();
    el.aiEnabled.checked = prefs.on;
    el.aiUseName.checked = prefs.name;
    el.aiRow.hidden = !prefs.on;
  }

  function openAi() {
    // Nothing to summarise means nothing worth sending, and the same guard the
    // exports use says so without opening a screen full of blanks.
    if (guardEmpty()) return;
    renderAiChips();
    renderAiPreview();
    showScreen("ai");
  }

  el.aiEnabled.addEventListener("change", function () {
    var prefs = loadAiPrefs();
    prefs.on = el.aiEnabled.checked;
    saveAiPrefs(prefs);
    renderAiPrefs();
  });

  el.aiUseName.addEventListener("change", function () {
    var prefs = loadAiPrefs();
    prefs.name = el.aiUseName.checked;
    saveAiPrefs(prefs);
  });

  el.aiOpen.addEventListener("click", openAi);
  el.aiBack.addEventListener("click", showMain);
  el.aiQuestion.addEventListener("input", renderAiPreview);
  el.aiRange.addEventListener("change", renderAiPreview);

  el.aiCopy.addEventListener("click", function () {
    copyText(aiCurrentPrompt()).then(function (ok) {
      showToast(ok ? "Copied — paste it wherever you like" : "Couldn't copy — select it from the box above");
    });
  });

  // ---------- version ----------

  function renderVersion() {
    el.appVersion.textContent = "v" + APP_VERSION;
    el.settingsVersion.textContent = APP_VERSION;
  }

  // A phone can sit on an old copy for days: the browser has the page cached
  // and nothing on screen says so. Asking for the document under a URL it has
  // never seen is the one thing that reliably defeats the cache. The query is
  // not read by anything, and localStorage is scoped to the origin, so the log
  // is untouched.
  function reloadFresh() {
    var base = location.href.split("#")[0].split("?")[0];
    location.replace(base + "?r=" + Date.now());
  }

  el.appVersion.addEventListener("click", reloadFresh);

  // ---------- update check ----------

  // Waiting for someone to notice the number at the bottom of the screen is no
  // way to find out you are three versions behind. version.json is a couple of
  // dozen bytes and says what is deployed; the running copy says what it is.
  var lastVersionCheck = 0;
  var updateSeen = null;     // the version being offered, once one is found
  var updateDismissed = null; // ...and the one already waved away

  function renderUpdateBanner() {
    var show = !!updateSeen && updateSeen !== updateDismissed;
    if (show) el.updateVersion.textContent = "v" + updateSeen;
    el.updateBanner.hidden = !show;
  }

  function checkForUpdate() {
    // Nothing to fetch from disk — a file:// page cannot read its own folder,
    // and a copy opened that way is not one that updates.
    if (location.protocol === "file:") return;
    var now = Date.now();
    if (lastVersionCheck && now - lastVersionCheck < VERSION_CHECK_GAP) return;
    lastVersionCheck = now;
    // no-store asks the browser not to serve this from its cache; the query
    // defeats anything sitting in front of it. A cached answer to "is there a
    // newer version" is the one reply with no value at all.
    fetch(VERSION_URL + "?t=" + now, { cache: "no-store" })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (!data) return;
        var remote = parseInt(data.version, 10);
        var local = parseInt(APP_VERSION, 10);
        // Only ever offer to go forwards. A rollback, or a copy built from a
        // branch, leaves the running version ahead — not something to nag about.
        if (!isFinite(remote) || !isFinite(local) || remote <= local) return;
        updateSeen = String(remote);
        renderUpdateBanner();
      })
      .catch(function () {
        // Being offline is the ordinary case here, not a fault worth a banner.
      });
  }

  el.updateReload.addEventListener("click", reloadFresh);

  // Three in the morning is nobody's moment to update. It comes back on its
  // own if a later version turns up.
  el.updateDismiss.addEventListener("click", function () {
    updateDismissed = updateSeen;
    renderUpdateBanner();
  });

  // ---------- clock & render ----------

  function renderClock() {
    var now = new Date();
    el.topClock.textContent = formatClockTime(now);
    el.topDate.textContent = formatDateHeader(now);
  }

  function renderAll(opts) {
    var withLog = !opts || opts.log !== false;
    renderClock();
    renderName();
    renderSleepBanner();
    renderSleepButton();
    renderForecast();
    renderGettingStarted();
    renderTempBanner();
    renderMeasurements();
    renderPlanSoon();
    if (withLog) renderLog();
  }

  function tick() {
    // The log shows fixed clock times, so it only needs rebuilding when the
    // date rolls over or a running sleep keeps growing today's total.
    var needLog = logOpen && (dayKeyOf(new Date()) !== lastLogDayKey || isSleepingNow());
    renderAll({ log: needLog });
  }

  renderVersion();
  renderNameFonts();
  renderZone();
  toggleNameFonts(false);
  el.nameFontsToggle.addEventListener("click", function () { toggleNameFonts(!nameFontsOpen); });
  renderAiPrefs();
  renderAiTargets();
  renderPlanChips();
  renderPlans();
  checkForUpdate();
  pruneOnStartup();
  buildIntervalOptions();
  buildFeedingOptions();
  buildFedOptions();
  el.syncRepo.value = syncConfig ? syncConfig.repo : "";
  renderSyncState();
  startSyncPolling();
  if (syncConfig) syncNow("open");
  handleShareHash();
  syncManualFields();
  renderDobEcho();
  renderAll();
  setInterval(tick, 30 * 1000);

  // iOS freezes timers in the background, so refresh the moment the app
  // comes back instead of showing stale numbers for up to half a minute.
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) return;
    renderAll();
    if (syncConfig) syncNow("resume");
    checkForUpdate();
  });
  window.addEventListener("focus", function () { renderAll(); });
  window.addEventListener("pageshow", function () { renderAll(); });
})();
