/* Baby Tracker. Free and open source under the MIT licence — see LICENSE.
   SPDX-License-Identifier: MIT */
(function () {
  "use strict";

  var EVENTS_KEY = "baby-tracker-events";
  var NAME_KEY = "baby-tracker-name";
  var INTERVALS_KEY = "baby-tracker-intervals";
  var DOB_KEY = "baby-tracker-dob";
  // A shared default: where the photos behind a note (a rash, say) actually
  // live. Never a photo itself — this app stores no images — just a link to
  // a folder the parent already shares (Google Drive, iCloud), offered as a
  // starting point on each new note and editable per entry.
  var PHOTO_ALBUM_KEY = "baby-tracker-photo-album";
  var META_STAMP_KEY = "baby-tracker-meta-updated";
  var SYNC_KEY = "baby-tracker-sync";
  var FEEDING_KEY = "baby-tracker-feeding";
  var PLANS_KEY = "baby-tracker-plans";
  // Which dates the carer actually worked — sparse, one entry per date,
  // merged the same last-write-wins, tombstoned way as the diary and the
  // shopping list. See the comment above normaliseRotaShift for why this is
  // not a recurring weekly pattern.
  var ROTA_SHIFTS_KEY = "baby-tracker-rota-shifts";
  var NAME_FONT_KEY = "baby-tracker-name-font";
  // Which language the handover screen is read in. A property of the handset
  // and the person holding it, not of the baby, so unlike the name and its
  // style this one never travels between phones.
  var LANG_KEY = "baby-tracker-lang";
  var SYNC_PATH = "baby-tracker-log.json";
  // Where a voice shortcut (Siri, run entirely on-device) drops one small
  // file per logged moment, named "<type>__<id>__<time>.json" — everything
  // sync needs to turn it into a real event lives in the filename, so
  // picking the queue up again never requires reading a file's contents.
  // Each filename is unique, so the shortcut can always create without
  // reading a sha first, and sync can always delete without a write race.
  var VOICE_QUEUE_DIR = "voice-queue";
  var VOICE_LOG_TYPES = { feed: true, diaper: true, sleep_start: true, sleep_end: true };
  // The time segment is optional: a source that cannot reliably state a
  // timezone-correct instant (a voice automation with no equivalent of
  // Shortcuts' "Change Time Zone") can leave it out and get "whenever sync
  // next notices the file" instead — still correct to within the poll
  // interval, and never silently an hour out from a mismatched zone.
  //
  // The id accepts letters, digits and dashes — not just hex — so a
  // different automation platform's own idea of "something unique" (a
  // formatted date, a run count) can be used as-is instead of app.js
  // needing to know each source's shape. It deliberately stops short of
  // "anything": an id that reaches events some other way — pasted in as a
  // JSON backup, or pulled from another phone's copy of the log — passes
  // through normaliseImported first, which strips every character outside
  // this exact set (see the comment there). A voice id with a character
  // that sanitiser would strip survives its own first push fine, but comes
  // back stripped on the very next pull and reads as a second, new event —
  // so the two must agree on what "safe" means, not each invent their own.
  var VOICE_NAME_RE = /^([a-z_]+)__([0-9A-Za-z-]{1,80})(?:__(\d{8}T\d{6}Z))?\.json$/;
  var SYNC_DEBOUNCE = 8000;
  var SYNC_POLL = 60000;
  var SYNC_RETRIES = 3;
  // One source of truth for the version on screen. It is read from this
  // script's own ?v= cache-busting query, so bumping the URL in index.html is
  // the only edit needed and the number shown can never disagree with the file
  // the browser actually loaded. Opened straight from disk there is no query,
  // which is what the fallback is for — a test keeps it level with the HTML.
  var APP_VERSION = (function () {
    var fallback = "54";
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
  // The gap the wake+change+feed combo button backdates by. Fixed rather
  // than configurable: it stands in for "however long that usually takes",
  // not a schedule anyone is asked to tune.
  var WAKE_CHANGE_FEED_GAP = 5 * MS_MIN;
  // How long the combo button assumes the feed itself took, since nobody
  // is there to answer the usual "how long did it take?" chip mid-sequence.
  var WAKE_CHANGE_FEED_MIN = 15;
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
  // The handover screen. Six hours covers a shift that has just started,
  // twelve covers the night somebody else had, and a full day is there for
  // the appointment where all of it gets asked about at once.
  var HANDOVER_HOURS = [6, 12, 24];
  // Labelled with the two-letter code rather than the language's own name:
  // "en" and "ru" are read the same by everybody, which is what the chip that
  // fixes an unreadable screen has to be. Shared by every screen that offers
  // the choice — handover today, the shopping list from v38.
  var LANG_CHOICES = [
    { id: "en", label: "en" },
    { id: "ru", label: "ru" }
  ];
  var HANDOVER_DEFAULT_HOURS = 12;
  // Whoever is taking over needs today and tomorrow, not the term ahead.
  var HANDOVER_PLAN_HORIZON = 2 * MS_DAY;
  var HANDOVER_MAX_PLANS = 3;
  var HANDOVER_SPREAD_WORTH_SAYING = 20 * MS_MIN;
  // Below this, "due" and "now" are the same word.
  var HANDOVER_DUE_NOW = 2 * MS_MIN;

  var SHOPPING_KEY = "baby-tracker-shopping";
  var MAX_SHOP_TITLE = 80;
  var MAX_SHOP_LINK = 500;
  // Long enough that a mis-tap is still undoable the same evening, short
  // enough that "bought" does not quietly turn into a second, permanent list.
  var SHOP_DONE_LINGER = 24 * MS_HOUR;
  // Everything in the app so far has been UK English and NHS numbers; this
  // assumes a UK Amazon the same way. There is no setting for it because
  // there is nowhere else in the app that would need one.
  var AMAZON_SEARCH = "https://www.amazon.co.uk/s?k=";
  // Where an item stands before it is bought. "new" is the default and is
  // never written explicitly by a human — tapping the pill only ever moves it
  // forward, wrapping back to "new" so a mis-tap is one more tap from undone.
  // Once ticked off (done), the status stops mattering and is not shown.
  var SHOP_STATUSES = ["new", "ordered", "arrived"];
  // A plain YYYY-MM-DD, same shape as a plan's date — no time of day, so
  // there is no timezone to get wrong. Only meaningful once ordered; set
  // it once, the app clears it if the status ever moves off "ordered", so
  // a later re-order can't inherit a stale date left over from a first one.
  var SHOP_ETA_RE = /^\d{4}-\d{2}-\d{2}$/;

  var ROTA_HOURS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  var ROTA_DEFAULT_HOURS = 6;
  var ROTA_DEFAULT_START = "09:00";
  // Half-hour steps, not one-minute — a native time input scrolls a minute
  // at a time, which is a lot of scrolling for a number that is never more
  // precise than "roughly half nine" in practice.
  var ROTA_TIME_OPTIONS = (function () {
    var out = [];
    for (var h = 0; h < 24; h++) {
      out.push(pad2(h) + ":00");
      out.push(pad2(h) + ":30");
    }
    return out;
  })();

  var NEXTUP_TIMEOUT = 20000;
  // Catching up on a whole sequence — woke, nappy, fed, asleep again —
  // happens in one sitting well after the fact, and needs a time rather than
  // a handful of round numbers to fix it against. Kept to today: the entry is
  // stamped onto the day it was originally logged on, and correcting
  // something onto a different day — spanning midnight — goes through the
  // manual form below, which has an actual date to set.
  // How long the button says what it just did. Long enough to be read by
  // somebody who tapped and looked away, short enough to be gone before the
  // next feed.
  var LOGGED_NOTE = 5000;
  // Two of the same thing this close together is more likely a second tap
  // than a second feed, so the card says so rather than deciding for anyone.
  var RAPID_WINDOW = 3 * 60 * 1000;
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
  var MAX_NOTE_TEXT = 200;

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
    other: { label: "Measurement", icon: "🔬" },
    // A rash, or anything else worth writing down that isn't a number and
    // isn't one of the three big buttons. The photo itself never lives in
    // the app — text is optional context, link is a pointer to wherever the
    // photo actually is (a shared album), never fetched or embedded.
    note: { label: "Note", icon: "📝" }
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

  // No weekly template — tried first, and it did not survive contact with a
  // real rota: which day starts the week and what time it starts on both
  // move from one week to the next, so a recurring Mon/Tue/Wed pattern would
  // be wrong about as often as it was right. What is kept instead is a
  // sparse, date-keyed shift, one per date that actually has one — the same
  // shape IDEAS.md set aside for a leave-day exception, generalised to be
  // the only record there is. A date with nothing in it simply is not
  // worked; nothing here says why.
  // A date has one of three states: nothing recorded (no entry at all),
  // explicitly off, or working a number of hours. Off is its own record
  // rather than an absence, on purpose — "nobody has said anything about
  // Monday" and "Monday is off" read the same on a calendar unless one of
  // them is actually written down.
  function normaliseRotaShift(raw) {
    if (!raw || typeof raw !== "object") return null;
    var date = (typeof raw.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.date)) ? raw.date : "";
    if (!date) return null;
    var updatedAt = typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString();
    if (raw.deleted) return { id: date, date: date, deleted: true, updatedAt: updatedAt };
    if (raw.off) return { id: date, date: date, off: true, updatedAt: updatedAt };
    var hours = Number(raw.hours);
    var validHours = (hours > 0 && hours <= 24) ? Math.round(hours * 2) / 2 : 0;
    if (!validHours) return null;
    var start = (typeof raw.start === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(raw.start)) ? raw.start : "";
    return { id: date, date: date, hours: validHours, start: start, updatedAt: updatedAt };
  }

  function loadRotaShifts() {
    try {
      var raw = localStorage.getItem(ROTA_SHIFTS_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveRotaShifts(list) {
    try {
      localStorage.setItem(ROTA_SHIFTS_KEY, JSON.stringify(list));
      hideError();
      scheduleSync();
      return true;
    } catch (e) {
      showError("Couldn't save — this browser's storage is full");
      return false;
    }
  }

  function pruneRotaShiftTombstones() {
    var before = rotaShifts.length;
    rotaShifts = rotaShifts.filter(function (s) { return !tombstoneExpired(s); });
    return before - rotaShifts.length;
  }

  function mergeRotaShifts(remoteList) {
    var byId = {};
    rotaShifts.forEach(function (s) { byId[s.id] = s; });
    var changed = 0;
    (remoteList || []).forEach(function (raw) {
      var shift = normaliseRotaShift(raw);
      if (!shift || !shift.id) return;
      if (tombstoneExpired(shift)) return;
      var existing = byId[shift.id];
      if (!existing) {
        rotaShifts.push(shift);
        byId[shift.id] = shift;
        changed++;
      } else if (shift.updatedAt > updatedAtOf(existing)) {
        rotaShifts[rotaShifts.indexOf(existing)] = shift;
        byId[shift.id] = shift;
        changed++;
      }
    });
    return changed;
  }

  function rotaShiftFor(dateKey) {
    return rotaShifts.filter(function (s) { return s.date === dateKey && !s.deleted; })[0] || null;
  }

  function liveRotaShifts() {
    return rotaShifts.filter(function (s) { return !s.deleted; });
  }

  function remoteMissesOurRotaShifts(remoteList) {
    var remoteById = {};
    (remoteList || []).forEach(function (s) { if (s && s.date) remoteById[s.date] = s; });
    return rotaShifts.some(function (s) {
      var mirror = remoteById[s.date];
      return !mirror || updatedAtOf(s) > (mirror.updatedAt || "");
    });
  }

  // One entry per date, id and date the same string, so setting a date
  // twice replaces rather than duplicates, on this phone or any other.
  // One call for both working states: pass hours (and optionally a start
  // time) to record a shift, or { off: true } to record the day as off.
  function saveRotaDay(dateKey, fields) {
    var existing = rotaShifts.filter(function (s) { return s.date === dateKey; })[0];
    var record = existing || { id: dateKey, date: dateKey };
    record.deleted = false;
    record.updatedAt = new Date().toISOString();
    if (fields.off) {
      record.off = true;
      delete record.hours;
      delete record.start;
    } else {
      delete record.off;
      record.hours = fields.hours;
      record.start = fields.start || "";
    }
    if (!existing) rotaShifts.push(record);
    return saveRotaShifts(rotaShifts);
  }

  // Back to nothing recorded at all — not "off", which is itself a record.
  function clearRotaDay(dateKey) {
    var existing = rotaShifts.filter(function (s) { return s.date === dateKey; })[0];
    if (!existing) return true;
    existing.deleted = true;
    existing.updatedAt = new Date().toISOString();
    return saveRotaShifts(rotaShifts);
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

  function loadPhotoAlbum() {
    try {
      return localStorage.getItem(PHOTO_ALBUM_KEY) || "";
    } catch (e) {
      return "";
    }
  }

  function savePhotoAlbum(value) {
    var typed = cleanText(value, MAX_SHOP_LINK);
    var link = safeLink(typed);
    if (typed && !link) {
      showError("A link has to start with http:// or https://");
      return false;
    }
    try {
      if (link) localStorage.setItem(PHOTO_ALBUM_KEY, link);
      else localStorage.removeItem(PHOTO_ALBUM_KEY);
      touchMeta();
      hideError();
      scheduleSync();
      return true;
    } catch (e) {
      showError("Couldn't save the photo album link");
      return false;
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
      label: event.label, unit: event.unit, fedMin: event.fedMin, fedWith: event.fedWith,
      text: event.text, link: event.link };
    delete event.nappy;
    delete event.value;
    delete event.nextMin;
    delete event.label;
    delete event.unit;
    delete event.fedMin;
    delete event.fedWith;
    delete event.text;
    delete event.link;
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
    if (carried.text !== undefined) event.text = carried.text;
    if (carried.link !== undefined) event.link = carried.link;
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
    if (prunePlanTombstones()) savePlans(plans);
    var shopRetired = retireBoughtShopping();
    var shopPruned = pruneShopTombstones();
    if (shopRetired || shopPruned) saveShopping(shopping);
    if (pruneRotaShiftTombstones()) saveRotaShifts(rotaShifts);
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
    manualNoteTextField: document.getElementById("manualNoteTextField"),
    manualNoteText: document.getElementById("manualNoteText"),
    manualLinkField: document.getElementById("manualLinkField"),
    manualLink: document.getElementById("manualLink"),
    addNoteBtn: document.getElementById("addNoteBtn"),
    photoAlbum: document.getElementById("photoAlbum"),
    babyDob: document.getElementById("babyDob"),
    babyFeeding: document.getElementById("babyFeeding"),
    babyDobEcho: document.getElementById("babyDobEcho"),
    btnFeed: document.getElementById("btnFeed"),
    btnDiaper: document.getElementById("btnDiaper"),
    btnSleep: document.getElementById("btnSleep"),
    btnWakeChangeFeed: document.getElementById("btnWakeChangeFeed"),
    feedNote: document.getElementById("feedNote"),
    diaperNote: document.getElementById("diaperNote"),
    sleepNote: document.getElementById("sleepNote"),
    nextUpUndo: document.getElementById("nextUpUndo"),
    nextUpRepeat: document.getElementById("nextUpRepeat"),
    sleepLabel: document.getElementById("sleepLabel"),
    forecastList: document.getElementById("forecastList"),
    nextUp: document.getElementById("nextUp"),
    nextUpTitle: document.getElementById("nextUpTitle"),
    nextUpLine: document.getElementById("nextUpLine"),
    nextUpChips: document.getElementById("nextUpChips"),
    nextUpForecastBlock: document.getElementById("nextUpForecastBlock"),
    timeScroll: document.getElementById("timeScroll"),
    timeScrollNow: document.getElementById("timeScrollNow"),
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
    screenHandover: document.getElementById("screenHandover"),
    handoverOpenBtn: document.getElementById("handoverOpen"),
    handoverBack: document.getElementById("handoverBack"),
    handoverTitle: document.getElementById("handoverTitle"),
    handoverWindowLabel: document.getElementById("handoverWindowLabel"),
    handoverLangLabel: document.getElementById("handoverLangLabel"),
    handoverLangs: document.getElementById("handoverLangs"),
    handoverFooter: document.getElementById("handoverFooter"),
    screenShop: document.getElementById("screenShop"),
    shopOpenBtn: document.getElementById("shopOpen"),
    shopBack: document.getElementById("shopBack"),
    shopTitle: document.getElementById("shopTitle"),
    shopLangLabel: document.getElementById("shopLangLabel"),
    shopLangs: document.getElementById("shopLangs"),
    shopWhatLabel: document.getElementById("shopWhatLabel"),
    shopWhat: document.getElementById("shopWhat"),
    shopLinkLabel: document.getElementById("shopLinkLabel"),
    shopLink: document.getElementById("shopLink"),
    shopBadge: document.getElementById("shopBadge"),
    shopSubmit: document.getElementById("shopSubmit"),
    shopCancel: document.getElementById("shopCancel"),
    shopList: document.getElementById("shopList"),
    shopQuiet: document.getElementById("shopQuiet"),
    shopAmazonNote: document.getElementById("shopAmazonNote"),
    handoverWho: document.getElementById("handoverWho"),
    handoverWhen: document.getElementById("handoverWhen"),
    handoverHours: document.getElementById("handoverHours"),
    handoverStrip: document.getElementById("handoverStrip"),
    handoverEmpty: document.getElementById("handoverEmpty"),
    handoverLines: document.getElementById("handoverLines"),
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
    screenRota: document.getElementById("screenRota"),
    rotaOpenBtn: document.getElementById("rotaOpen"),
    rotaBack: document.getElementById("rotaBack"),
    rotaBanner: document.getElementById("rotaBanner"),
    rotaBannerBtn: document.getElementById("rotaBannerBtn"),
    rotaBannerText: document.getElementById("rotaBannerText"),
    rotaWeekPrev: document.getElementById("rotaWeekPrev"),
    rotaWeekNext: document.getElementById("rotaWeekNext"),
    rotaWeekRange: document.getElementById("rotaWeekRange"),
    rotaWeekTotal: document.getElementById("rotaWeekTotal"),
    rotaWeekDays: document.getElementById("rotaWeekDays"),
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
    toastAction: document.getElementById("toastAction"),
    screenStats: document.getElementById("screenStats"),
    statsOpenBtn: document.getElementById("statsOpen"),
    statsBack: document.getElementById("statsBack"),
    statsPeriodChips: document.getElementById("statsPeriodChips"),
    statsEmpty: document.getElementById("statsEmpty"),
    statsCharts: document.getElementById("statsCharts"),
    statsFeedChart: document.getElementById("statsFeedChart"),
    statsFeedSummary: document.getElementById("statsFeedSummary"),
    statsDiaperChart: document.getElementById("statsDiaperChart"),
    statsDiaperSummary: document.getElementById("statsDiaperSummary"),
    statsSleepChart: document.getElementById("statsSleepChart"),
    statsSleepSummary: document.getElementById("statsSleepSummary")
  };

  var logOpen = false;
  var manualOpen = false;
  var measureOpen = false;
  var editingId = null;
  var expandedDays = {};
  var lastLogDayKey = null;
  var STATS_PERIODS = [7, 14, 30];
  var statsPeriod = 7;

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

  // The top bar has to hold a date, a clock and four buttons on a phone held
  // in one hand. Spelling out "Wednesday" wraps it onto two lines, and the
  // three letters say the same thing.
  function formatDateShort(date) {
    return WEEKDAYS[date.getDay()].slice(0, 3) + ", " + date.getDate() + " " +
      MONTHS[date.getMonth()].slice(0, 3);
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
          ? "At 38°C or above in a baby under 3 months, call an ambulance now — 999 in the UK, 112 across Europe. Set the date of birth in Settings and this will use the right threshold for your baby's age."
          : "Call an ambulance straight away for a baby this age — 999 in the UK, 112 across Europe. For anything less urgent, NHS 111 in the UK, or your doctor."
      };
    }
    if (value < LOW_TEMP) {
      return {
        level: "low",
        headline: formatMeasure("temp", value) + " is low",
        advice: "A temperature below 36°C in a baby needs checking — ring your doctor, or NHS 111 in the UK. Call an ambulance (999, or 112 across Europe) if they are also floppy, pale or hard to wake."
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

  function noteTextOf(event) {
    return (event && event.type === "note") ? cleanText(event.text, MAX_NOTE_TEXT) : "";
  }

  function noteLinkOf(event) {
    return (event && event.type === "note") ? safeLink(event.link) : "";
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

  // ---------- statistics ----------

  // One row per calendar day, oldest first, so the chart reads left to
  // right the same way the clock does. Feeds and diapers come from a
  // single pass over the log; sleep reuses the same range math the sleep
  // banner and handover strip already use, so a nap that crosses
  // midnight is split the same way everywhere in the app.
  function statsRange(days) {
    var byDay = {};
    liveEvents().forEach(function (e) {
      var key = dayKeyOf(new Date(e.time));
      if (!byDay[key]) byDay[key] = { feeds: 0, diapers: 0 };
      if (e.type === "feed") byDay[key].feeds++;
      else if (e.type === "diaper") byDay[key].diapers++;
    });
    var analysis = analyzeSleep();
    var now = Date.now();
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var out = [];
    for (var i = days - 1; i >= 0; i--) {
      var dayStart = new Date(today);
      dayStart.setDate(dayStart.getDate() - i);
      var key = dayKeyOf(dayStart);
      var counts = byDay[key] || { feeds: 0, diapers: 0 };
      out.push({
        date: dayStart,
        feeds: counts.feeds,
        diapers: counts.diapers,
        sleepMs: sleepMsInRange(analysis, +dayStart, +dayStart + MS_DAY, now)
      });
    }
    return out;
  }

  // Plain counts, shown as they are; an average gets the one decimal place
  // the summary line already uses, so a bar and the dashed line it is read
  // against never disagree about how many places matter.
  function statsCountLabel(v) {
    return (v % 1 === 0) ? String(Math.round(v)) : v.toFixed(1);
  }

  // Minutes would crowd a bar barely wide enough for two digits, so this
  // stays deliberately rounded — the exact figure is still one tap away, in
  // the tooltip and in the summary line underneath.
  function statsHoursLabel(hours) {
    return Math.round(hours) + "h";
  }

  // A small hand-drawn bar chart, same reasoning as the handover strip a
  // little further down: no charting library, so it is drawn once here and
  // reused for all three counts. valueOf reads the number from a row; cls
  // picks the colour, from the same m-feed/m-diaper/m-sleep set the strip
  // already defines. avg draws as a dashed reference line — the one thing a
  // row of bare bars cannot say on its own is which of them are actually
  // above or below the run's own average. formatLabel turns a number into
  // the text drawn on a bar and on the average line alike.
  function statsBarSvg(rows, valueOf, cls, avg, formatLabel) {
    var WIDTH = 320, LEFT = 2, RIGHT = 2, TOP = 13, BARH = 60, AXIS = 14;
    var height = TOP + BARH + AXIS;
    var plotW = WIDTH - LEFT - RIGHT;
    var n = rows.length;
    var gap = n > 14 ? 1 : 3;
    var barW = (plotW - gap * (n - 1)) / n;
    var max = 1;
    rows.forEach(function (r) { max = Math.max(max, valueOf(r)); });
    // An outlier day, or a quiet run sitting well under it, can each put the
    // average outside the tallest bar's own range — the scale has to fit
    // whichever of the two reaches further.
    max = Math.max(max, avg);

    var out = ['<svg class="ho-svg" viewBox="0 0 ' + WIDTH + ' ' + height +
      '" role="img" aria-label="' + n + '-day chart, average ' + escapeHtml(formatLabel(avg)) + '">'];
    out.push('<line class="ho-rail" x1="' + LEFT + '" y1="' + (TOP + BARH) +
      '" x2="' + (LEFT + plotW) + '" y2="' + (TOP + BARH) + '"/>');

    if (avg > 0) {
      var avgY = TOP + BARH - (avg / max) * BARH;
      out.push('<line class="stats-avg" x1="' + LEFT + '" y1="' + (Math.round(avgY * 10) / 10) +
        '" x2="' + (LEFT + plotW) + '" y2="' + (Math.round(avgY * 10) / 10) + '"/>');
      out.push('<text class="stats-avg-label" x="' + (LEFT + plotW) + '" y="' + (Math.round((avgY - 3) * 10) / 10) +
        '" text-anchor="end">avg ' + escapeHtml(formatLabel(avg)) + '</text>');
    }

    // Every label would collide past about ten bars, so only enough of
    // them are drawn to still tell roughly where in the range a bar sits.
    var labelEvery = Math.max(1, Math.ceil(n / 6));
    // A number on every bar is only legible up to the 14-day view; past
    // that the dashed average line above is what carries the shape.
    var showValues = n <= 14;
    rows.forEach(function (row, i) {
      var v = valueOf(row);
      var h = (v / max) * BARH;
      var x = LEFT + i * (barW + gap);
      var y = TOP + BARH - h;
      out.push('<rect class="' + cls + '" x="' + (Math.round(x * 10) / 10) +
        '" y="' + (Math.round(y * 10) / 10) + '" width="' + (Math.round(Math.max(1, barW) * 10) / 10) +
        '" height="' + (Math.round(Math.max(0, h) * 10) / 10) + '" rx="1">' +
        '<title>' + escapeHtml(formatDateHeader(row.date) + ': ' + formatLabel(v)) + '</title></rect>');
      if (showValues && v > 0) {
        out.push('<text class="stats-bar-label" x="' + (Math.round((x + barW / 2) * 10) / 10) +
          '" y="' + (Math.round(Math.max(9, y - 3) * 10) / 10) +
          '" text-anchor="middle">' + escapeHtml(formatLabel(v)) + '</text>');
      }
      if (n <= 10 || i % labelEvery === 0 || i === n - 1) {
        out.push('<text class="ho-tick" x="' + (Math.round((x + barW / 2) * 10) / 10) +
          '" y="' + (height - 2) + '" text-anchor="middle">' + row.date.getDate() + '</text>');
      }
    });
    out.push('</svg>');
    return out.join("");
  }

  function renderStatsPeriodChips() {
    el.statsPeriodChips.innerHTML = "";
    STATS_PERIODS.forEach(function (days) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "ho-chip" + (days === statsPeriod ? " on" : "");
      chip.textContent = days + " days";
      chip.addEventListener("click", function () {
        statsPeriod = days;
        renderStats();
      });
      el.statsPeriodChips.appendChild(chip);
    });
  }

  function renderStats() {
    renderStatsPeriodChips();

    if (!liveEvents().length) {
      el.statsEmpty.hidden = false;
      el.statsCharts.hidden = true;
      return;
    }
    el.statsEmpty.hidden = true;
    el.statsCharts.hidden = false;

    var rows = statsRange(statsPeriod);
    var n = rows.length;

    var totalFeeds = 0, totalDiapers = 0, totalSleepMs = 0;
    rows.forEach(function (r) {
      totalFeeds += r.feeds;
      totalDiapers += r.diapers;
      totalSleepMs += r.sleepMs;
    });

    el.statsFeedChart.innerHTML = statsBarSvg(rows, function (r) { return r.feeds; }, "m-feed",
      totalFeeds / n, statsCountLabel);
    el.statsDiaperChart.innerHTML = statsBarSvg(rows, function (r) { return r.diapers; }, "m-diaper",
      totalDiapers / n, statsCountLabel);
    el.statsSleepChart.innerHTML = statsBarSvg(rows, function (r) { return r.sleepMs / MS_HOUR; }, "m-sleep",
      (totalSleepMs / n) / MS_HOUR, statsHoursLabel);

    el.statsFeedSummary.textContent =
      "Average " + (totalFeeds / n).toFixed(1) + " a day · " + totalFeeds + " over " + n + " days";
    el.statsDiaperSummary.textContent =
      "Average " + (totalDiapers / n).toFixed(1) + " a day · " + totalDiapers + " over " + n + " days";
    el.statsSleepSummary.textContent =
      "Average " + formatDuration(totalSleepMs / n) + " a day · " + formatDuration(totalSleepMs) + " over " + n + " days";
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
              (noteTextOf(e) ? '<div class="l-detail">' + escapeHtml(noteTextOf(e)) + '</div>' : '') +
              (noteLinkOf(e) ? '<a class="l-link" href="' + escapeHtml(noteLinkOf(e)) +
                '" target="_blank" rel="noopener">📷 Photo</a>' : '') +
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

  // Tombstones one event without touching storage or the screen — so a
  // caller undoing several at once (see quickWakeChangeFeed below) can save
  // and render once for the whole batch rather than once per entry.
  function tombstoneEventQuiet(id) {
    var target = events.filter(function (e) { return e.id === id; })[0];
    if (!target || isDeleted(target)) return null;
    var carried = stripToTombstone(target);
    touch(target);
    return { target: target, carried: carried };
  }

  function deleteEvent(id) {
    var stripped = tombstoneEventQuiet(id);
    if (!stripped) return;
    if (!saveEvents(events)) return;
    if (editingId === id) resetManualForm();
    renderAll();
    showToast("Entry deleted", function () {
      restoreFromTombstone(stripped.target, stripped.carried);
      touch(stripped.target);
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

  function syncManualNoteField() {
    var isNote = el.manualType.value === "note";
    el.manualNoteTextField.hidden = !isNote;
    el.manualLinkField.hidden = !isNote;
    if (!isNote) {
      el.manualNoteText.value = "";
      el.manualLink.value = "";
    // A fresh note starts from whatever album link is already saved, so
    // there is nothing to retype for the common case of one shared album.
    // Editing an existing note leaves it alone — startEdit fills it in.
    } else if (!editingId && !el.manualLink.value) {
      el.manualLink.value = loadPhotoAlbum();
    }
  }

  function syncManualFields() {
    syncManualFedField();
    syncManualNappyField();
    syncManualValueField();
    syncManualNoteField();
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
    el.manualNoteText.value = "";
    el.manualLink.value = "";
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
    el.manualNoteText.value = noteTextOf(found);
    el.manualLink.value = noteLinkOf(found);
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

  function startNote() {
    resetManualForm();
    openManualPanel();
    el.manualTitle.textContent = "New note";
    el.manualType.value = "note";
    syncManualFields();
    el.manualDateTime.value = toDateTimeLocalValue(new Date());
    el.manualPanel.scrollIntoView({ behavior: "smooth", block: "center" });
    el.manualNoteText.focus();
  }

  el.addNoteBtn.addEventListener("click", startNote);

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

    var noteText = "";
    var noteLink = "";
    if (type === "note") {
      noteText = cleanText(el.manualNoteText.value, MAX_NOTE_TEXT);
      if (!noteText) {
        showManualNotice("Write a few words, so you can tell it apart later");
        return;
      }
      var typedLink = cleanText(el.manualLink.value, MAX_SHOP_LINK);
      noteLink = safeLink(typedLink);
      if (typedLink && !noteLink) {
        showManualNotice("A link has to start with http:// or https://");
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
      if (noteText) target.text = noteText;
      else delete target.text;
      if (noteLink) target.link = noteLink;
      else delete target.link;
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
        type === "feed" ? el.manualSource.value : "", noteText, noteLink);
      if (!savedId) return;
      el.manualDateTime.value = toDateTimeLocalValue(new Date());
      // The form is the one place where the entry vanishes from view the
      // moment it is saved — the fields reset and nothing on screen says it
      // worked. Naming the time it went in answers the question the button
      // press asked, and the short disable stops the impatient second tap
      // that produced two identical entries.
      var original = el.manualSubmit.textContent;
      el.manualSubmit.textContent = "Added ✓ at " + formatClockTime(picked);
      el.manualSubmit.disabled = true;
      setTimeout(function () { el.manualSubmit.disabled = false; }, 1200);
      setTimeout(function () {
        if (!editingId) el.manualSubmit.textContent = original;
      }, 3000);
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
  // The moment this entry was actually tapped, fixed for the life of the
  // card. Backdating reads and writes against this rather than against "now"
  // at the moment of the tap, so picking 20m and then 30m lands 30 minutes
  // before the original tap, not 30 minutes before whenever the second tap
  // happened to land.
  var nextUpBaseTime = null;

  function hideNextUp() {
    clearTimeout(nextUpTimer);
    el.nextUp.hidden = true;
    nextUpKind = null;
    nextUpEventId = null;
    nextUpBaseTime = null;
  }

  function chipChoices(currentMin) {
    var list = CHIP_CHOICES.slice();
    if (list.indexOf(currentMin) === -1) list.push(currentMin);
    return list.sort(function (a, b) { return a - b; });
  }

  // Every kind of entry can be backdated the same way, so this renders on its
  // own rather than inside any of the type-specific blocks below it.
  // A native time control rather than a row of round numbers: on a phone it
  // opens as a wheel already sitting on the moment this was logged, and
  // winding it back is one continuous gesture instead of a search through
  // fixed choices for the nearest one. No date on it — this is always today
  // by construction, and touching a different day belongs to the manual form.
  function renderTimeScroll(event) {
    if (document.activeElement === el.timeScroll) return;
    el.timeScroll.value = formatClockTime(new Date(event.time));
  }

  function renderNextUp() {
    if (!nextUpKind) return;
    var event = events.filter(function (e) { return e.id === nextUpEventId; })[0];
    if (!event) {
      hideNextUp();
      return;
    }
    // Waking up does not start a new gap, so there is no "next" to plan —
    // but it still deserves the same time correction as everything else,
    // which is the only reason this card shows for it at all.
    var isWake = event.type === "sleep_end";
    el.nextUpForecastBlock.hidden = isWake;

    el.nextUpTitle.textContent =
      (isWake ? "Woke up" : KIND_META[nextUpKind].logged) + " at " + formatClockTime(new Date(event.time));
    renderRepeatWarning(event);
    renderTimeScroll(event);

    if (!isWake) {
      var planned = plannedMinutesFor(nextUpKind, event);
      var when = new Date(new Date(event.time).getTime() + planned * MS_MIN);
      el.nextUpLine.innerHTML = "Next " + KIND_META[nextUpKind].label.toLowerCase() +
        ' <span class="nextup-when">' + escapeHtml(formatWhen(when)) + '</span>';
    }

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

    if (!isWake) {
      el.nextUpChips.innerHTML = "";
      chipChoices(planned).forEach(function (mins) {
        var chip = document.createElement("button");
        chip.className = "nextup-chip" + (mins === planned ? " selected" : "");
        chip.setAttribute("data-min", String(mins));
        chip.textContent = formatDuration(mins * MS_MIN);
        el.nextUpChips.appendChild(chip);
      });
    }
  }

  function showNextUp(kind, eventId) {
    nextUpKind = kind;
    nextUpEventId = eventId;
    var event = events.filter(function (e) { return e.id === eventId; })[0];
    nextUpBaseTime = event ? +new Date(event.time) : Date.now();
    el.nextUp.hidden = false;
    renderNextUp();
    clearTimeout(nextUpTimer);
    nextUpTimer = setTimeout(hideNextUp, NEXTUP_TIMEOUT);
  }

  // Nobody feeds a baby twice in three minutes, so a second entry that close
  // together is almost certainly a second tap by somebody who could not tell
  // the first had worked. Said plainly, with the way out next to it — never
  // blocked, because "almost certainly" is not certainly and this app does not
  // overrule the person holding the baby.
  function renderRepeatWarning(event) {
    var until = +new Date(event.time);
    var recent = events.filter(function (e) {
      if (isDeleted(e) || e.type !== event.type) return false;
      var at = +new Date(e.time);
      return at <= until && until - at <= RAPID_WINDOW;
    }).length;
    if (recent < 2) {
      el.nextUpRepeat.hidden = true;
      return;
    }
    el.nextUpRepeat.textContent = "That is the " + ordinal(recent) + " " +
      KIND_META[nextUpKind].label.toLowerCase() + " in three minutes. Tap Undo if it was a slip.";
    el.nextUpRepeat.hidden = false;
  }

  function ordinal(n) {
    var rest = n % 100;
    if (rest >= 11 && rest <= 13) return n + "th";
    var suffix = { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th";
    return n + suffix;
  }

  el.nextUpClose.addEventListener("click", hideNextUp);

  // The entry it removes is the one this card is about, so there is no doubt
  // about which of four identical taps goes.
  el.nextUpUndo.addEventListener("click", function () {
    var id = nextUpEventId;
    hideNextUp();
    if (id) deleteEvent(id);
  });

  // The button that just confirmed the tap still says when it was logged,
  // and moving the time invalidates that — so every correction below
  // refreshes it too, exactly as the chips elsewhere on this card already do.
  function reconfirmLoggedButton() {
    var buttons = { feed: [el.btnFeed, el.feedNote, "feed"],
      diaper: [el.btnDiaper, el.diaperNote, "diaper"], sleep: [el.btnSleep, el.sleepNote, "sleep"] };
    var target = buttons[nextUpKind];
    var event = events.filter(function (e) { return e.id === nextUpEventId; })[0];
    if (target && event) confirmOnButton(target[0], target[1], target[2], new Date(event.time));
  }

  function applyTimeScroll(newTime) {
    var event = events.filter(function (e) { return e.id === nextUpEventId; })[0];
    if (!event) return;
    event.time = newTime.toISOString();
    touch(event);
    if (!saveEvents(events)) return;
    renderAll();
    renderNextUp();
    reconfirmLoggedButton();
    clearTimeout(nextUpTimer);
    nextUpTimer = setTimeout(hideNextUp, NEXTUP_TIMEOUT);
  }

  el.timeScroll.addEventListener("input", function () {
    if (!nextUpKind) return;
    // Fires on every notch of the wheel, including the instant between
    // picking the hour and picking the minute — a half-typed value is not
    // acted on, it is simply waited out.
    var m = /^(\d{2}):(\d{2})$/.exec(el.timeScroll.value);
    if (!m) return;
    var base = new Date(nextUpBaseTime);
    applyTimeScroll(new Date(base.getFullYear(), base.getMonth(), base.getDate(),
      +m[1], +m[2], 0, 0));
  });

  el.timeScrollNow.addEventListener("click", function () {
    if (!nextUpKind) return;
    applyTimeScroll(new Date(nextUpBaseTime));
  });

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

  function addEvent(type, isoTime, nappy, value, label, unit, fedMin, fedWith, text, link) {
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
    if (type === "note" && text) event.text = text;
    if (type === "note" && link) event.link = link;
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

  // The card below the buttons already says what was logged, but the eye is on
  // the button that was just pressed, and a quarter-second flash is easy to
  // miss in the dark with a baby in the other arm. Saying it on the button
  // itself, with the time, is what stops the same feed being tapped in four
  // times: the second tap now visibly disagrees with the first.
  var noteTimers = {};

  function confirmOnButton(btn, note, key, at) {
    note.textContent = "Logged " + formatClockTime(at);
    btn.classList.add("just-logged");
    clearTimeout(noteTimers[key]);
    noteTimers[key] = setTimeout(function () {
      note.textContent = "";
      btn.classList.remove("just-logged");
    }, LOGGED_NOTE);
  }

  function quickLog(type, btn, note, key) {
    flashButton(btn);
    var id = addEvent(type);
    if (!id) return null;
    var saved = events.filter(function (e) { return e.id === id; })[0];
    confirmOnButton(btn, note, key, new Date(saved ? saved.time : Date.now()));
    return id;
  }

  el.btnFeed.addEventListener("click", function () {
    var id = quickLog("feed", el.btnFeed, el.feedNote, "feed");
    if (id) showNextUp("feed", id);
  });

  el.btnDiaper.addEventListener("click", function () {
    var id = quickLog("diaper", el.btnDiaper, el.diaperNote, "diaper");
    if (id) showNextUp("diaper", id);
  });

  el.btnSleep.addEventListener("click", function () {
    var sleeping = isSleepingNow();
    var id = quickLog(sleeping ? "sleep_end" : "sleep_start", el.btnSleep, el.sleepNote, "sleep");
    // Waking up does not start a new gap, so there is nothing to plan there —
    // but the card still opens for it, purely for the time correction below,
    // which renderNextUp hides the forecast half of when the event is a wake.
    if (id) showNextUp("sleep", id);
  });

  // One tap for the sequence that otherwise means three: baby wakes, the
  // nappy gets changed (assumed wee & poo — the common case on waking) a
  // few minutes later, feeding starts a few minutes after that and takes
  // WAKE_CHANGE_FEED_MIN itself. Backdated at fixed five-minute steps
  // ending now, rather than opened as three separate taps — the "what
  // time did this actually start" card is what the manual form and each
  // entry's own edit are for if five minutes or fifteen minutes was not
  // quite right this time.
  function quickWakeChangeFeed() {
    var now = Date.now();
    var wakeId = addEvent("sleep_end", new Date(now - 2 * WAKE_CHANGE_FEED_GAP).toISOString());
    if (!wakeId) return;
    var nappyId = addEvent("diaper", new Date(now - WAKE_CHANGE_FEED_GAP).toISOString(), "both");
    var feedId = addEvent("feed", new Date(now).toISOString(), null, undefined, undefined, undefined,
      WAKE_CHANGE_FEED_MIN);
    var ids = [wakeId, nappyId, feedId].filter(Boolean);

    var atWake = eventById(wakeId), atNappy = eventById(nappyId), atFeed = eventById(feedId);
    var summary = "Logged: woke " + (atWake ? formatClockTime(new Date(atWake.time)) : "") +
      (atNappy ? " · nappy (wee & poo) " + formatClockTime(new Date(atNappy.time)) : "") +
      (atFeed ? " · feed " + formatClockTime(new Date(atFeed.time)) : "");

    showToast(summary, function () {
      var stripped = ids.map(tombstoneEventQuiet).filter(Boolean);
      if (!stripped.length) return;
      saveEvents(events);
      renderAll();
    });
  }

  function eventById(id) {
    return id ? events.filter(function (e) { return e.id === id; })[0] : null;
  }

  el.btnWakeChangeFeed.addEventListener("click", quickWakeChangeFeed);

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
    var rows = [["id", "type", "label", "time_local", "time_iso", "duration_min", "next_interval_min", "fed_with", "nappy", "value", "label", "unit", "updated_iso", "note", "link"]];
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
        updatedAtOf(e),
        noteTextOf(e),
        noteLinkOf(e)
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
        // A pipe in a note's own text would otherwise split the table row.
        var noteText = noteTextOf(e).replace(/\|/g, "\\|");
        var noteLink = noteLinkOf(e);
        out.push("| " + formatClockTime(new Date(e.time)) +
          " | " + eventTypeIcon(e.type) + " " + eventTypeLabel(e.type) +
          (nappyOf(e) ? " (" + NAPPY_TYPES[e.nappy].label.toLowerCase() + ")" : "") +
          (fedWithOf(e) ? " (" + feedSource(e.fedWith).label.toLowerCase() + ")" : "") +
          (measureValueOf(e) !== null ? " — " + measureLine(e) : "") +
          (noteText ? " — " + noteText : "") +
          (noteLink ? " ([photo](" + noteLink + "))" : "") +
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
    // A full backup, not a log report — CSV, Markdown and the AI summary all
    // guard on events because that is all they contain, but a family with
    // appointments or a shopping list and nothing logged yet still has
    // something worth saving here.
    if (!liveEvents().length && !livePlans().length && !liveShopping().length && !liveRotaShifts().length) {
      showToast("Nothing to export yet");
      return;
    }
    var payload = JSON.stringify({
      name: loadName(),
      nameFont: storedNameFont(),
      dob: loadDob(),
      feeding: loadFeeding(),
      intervals: intervals,
      photoAlbum: loadPhotoAlbum(),
      rotaShifts: rotaShifts,
      plans: plans,
      shopping: shopping,
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
    // A note's text and any link can run well past the size a share link
    // stays comfortable at, and there is no column here for them anyway —
    // left out, rather than shipped as a row missing its own content. Sync
    // and a full JSON backup still carry it in full.
    var chosen = eventsToShare(days).filter(function (e) {
      return SHARE_TYPES.indexOf(e.type) !== -1;
    });
    return {
      v: SHARE_VERSION,
      n: loadName(),
      s: storedNameFont(),
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
    // `s` was appended later, so a link made before it simply has no style.
    var out = { name: payload.n || "", nameFont: payload.s || "", dob: payload.b || "",
      feeding: payload.f || "", intervals: null, events: [] };
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
    // A style this phone has no font for is still worth storing: it is the
    // other phone's choice, it displays as the default here, and it survives
    // to be handed on rather than being quietly dropped.
    if (parsed.nameFont && knownNameFont(String(parsed.nameFont)) &&
        (parsed.overwrite || !storedNameFont())) {
      saveNameFont(String(parsed.nameFont));
      renderName();
      renderNameFonts();
    }
    if (parsed.photoAlbum && (parsed.overwrite || !loadPhotoAlbum())) {
      savePhotoAlbum(String(parsed.photoAlbum));
      el.photoAlbum.value = loadPhotoAlbum();
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
      name: parsed.name, nameFont: parsed.nameFont, dob: parsed.dob, feeding: parsed.feeding,
      intervals: parsed.intervals, photoAlbum: parsed.photoAlbum, takeIntervals: true, overwrite: false
    });
    if (Array.isArray(parsed.plans) && mergePlans(parsed.plans)) {
      savePlans(plans);
      renderPlans();
    }
    if (Array.isArray(parsed.shopping) && mergeShopping(parsed.shopping)) {
      saveShopping(shopping);
      renderShopping();
    }
    if (Array.isArray(parsed.rotaShifts) && mergeRotaShifts(parsed.rotaShifts)) {
      saveRotaShifts(rotaShifts);
      renderRotaBanner();
      renderRotaWeek();
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
    // Skipped for a tombstone, which by design carries no reading at all:
    // deleting a weight strips its value the same way deleting a note strips
    // its text. Demanding one back here is what used to drop the tombstone on
    // arrival, so a measurement deleted on one phone stayed on the other.
    if (MEASURES[raw.type] && !raw.deleted) {
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
    // A tombstone carries neither — deleting a note strips its text and
    // link the same way deleting anything else strips its reading.
    if (raw.type === "note" && !raw.deleted) {
      var noteText = cleanText(raw.text, MAX_NOTE_TEXT);
      if (!noteText) return null;
      entry.text = noteText;
      var noteLink = safeLink(raw.link);
      if (noteLink) entry.link = noteLink;
    }
    if (raw.deleted) entry.deleted = true;

    var stamped = new Date(String(raw.updatedAt || "").trim().replace(" ", "T"));
    entry.updatedAt = isNaN(stamped.getTime()) ? entry.time : stamped.toISOString();

    // Ids arrive from a file, so keep only characters safe to put in markup.
    // Every other id-producing path in the app (VOICE_NAME_RE included) has
    // to stay inside this same set — an id that gets through elsewhere but
    // is stripped here comes back different on its next pull and reads as
    // a second, new event rather than the same one again.
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
    el.screenHandover.hidden = name !== "handover";
    el.screenShop.hidden = name !== "shop";
    el.screenRota.hidden = name !== "rota";
    el.screenStats.hidden = name !== "stats";
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
  el.statsOpenBtn.addEventListener("click", function () {
    showScreen("stats");
    renderStats();
  });
  el.statsBack.addEventListener("click", showMain);

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
      name: incoming.name, nameFont: incoming.nameFont, dob: incoming.dob,
      feeding: incoming.feeding, intervals: incoming.intervals,
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

  function githubUrl(repo, path) {
    return "https://api.github.com/repos/" + repo + "/contents/" + (path || SYNC_PATH);
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
  function fetchRemote(config, path) {
    return fetch(githubUrl(config.repo, path) + "?ref=HEAD&t=" + Date.now(), {
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

  function putRemote(config, doc, sha, path) {
    var payload = {
      message: "Update baby log (" + new Date().toISOString() + ")",
      content: textToBase64(JSON.stringify(doc, null, 1))
    };
    if (sha) payload.sha = sha;
    return fetch(githubUrl(config.repo, path), {
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

  // Lists the queue directory. Each file's name alone carries type + id +
  // time, so this one request is all sync needs to know what a voice
  // shortcut has dropped since the last look — no per-file read.
  function listRemoteDir(config, path) {
    return fetch(githubUrl(config.repo, path) + "?ref=HEAD&t=" + Date.now(), {
      headers: githubHeaders(config.token),
      cache: "no-store"
    }).then(function (response) {
      if (response.status === 404) return [];
      if (!response.ok) throw { http: response.status };
      return response.json().then(function (body) {
        return Array.isArray(body) ? body : [];
      });
    });
  }

  // Best-effort: if it is already gone (another sync got there first) that
  // is the outcome we wanted anyway.
  function deleteRemoteFile(config, path, sha, message) {
    return fetch(githubUrl(config.repo, path), {
      method: "DELETE",
      headers: githubHeaders(config.token),
      body: JSON.stringify({ message: message || "Baby tracker: processed voice entry", sha: sha })
    }).then(function (response) {
      if (!response.ok && response.status !== 404 && response.status !== 409) throw { http: response.status };
    }).catch(function () {});
  }

  // "feed__3f9c2b7a-…__20260815T153000Z.json" -> { id, type, time }. No
  // JSON body to parse — the filename is the whole record, which is why the
  // shortcut never needs to read the queue before it can write to it.
  function parseVoiceFilename(name) {
    var m = VOICE_NAME_RE.exec(String(name || ""));
    if (!m) return null;
    if (!VOICE_LOG_TYPES[m[1]]) return null;
    var time = null;
    if (m[3]) {
      var iso = m[3].replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z");
      time = new Date(iso);
      if (isNaN(time.getTime())) return null;
      time = time.toISOString();
    }
    return { id: m[2], type: m[1], time: time };
  }

  // Turns whatever is waiting in the queue into real events (by id, so
  // seeing the same file twice is harmless) and clears the files out.
  // Failures here are swallowed by the caller: a stalled voice entry just
  // waits for the next sync rather than breaking the ordinary one.
  function processVoiceQueue(config) {
    return listRemoteDir(config, VOICE_QUEUE_DIR).then(function (entries) {
      var files = entries.filter(function (e) { return e && e.type === "file" && e.name && e.sha; });
      if (!files.length) return 0;
      var byId = {};
      events.forEach(function (e) { byId[e.id] = e; });
      var changed = 0;
      files.forEach(function (file) {
        var parsed = parseVoiceFilename(file.name);
        if (!parsed || byId[parsed.id]) return;
        var event = { id: parsed.id, type: parsed.type, time: parsed.time || new Date().toISOString() };
        if (event.type === "feed") {
          var source = feedSource(defaultFedWith());
          if (source) event.fedWith = source.id;
        }
        touch(event);
        events.push(event);
        byId[event.id] = event;
        changed++;
      });
      return Promise.all(files.map(function (file) {
        return deleteRemoteFile(config, VOICE_QUEUE_DIR + "/" + file.name, file.sha);
      })).then(function () { return changed; });
    });
  }

  function localDocument() {
    return {
      app: "baby-tracker",
      version: 1,
      meta: {
        name: loadName(),
        nameFont: storedNameFont(),
        dob: loadDob(),
        feeding: loadFeeding(),
        intervals: { feed: intervals.feed, diaper: intervals.diaper, sleep: intervals.sleep },
        photoAlbum: loadPhotoAlbum(),
        updatedAt: metaStamp()
      },
      events: events,
      plans: plans,
      shopping: shopping,
      rotaShifts: rotaShifts
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

  function syncNow(reason, joining) {
    if (!syncConfig) return Promise.resolve(false);
    if (syncInFlight) {
      syncQueued = true;
      return Promise.resolve(false);
    }
    syncInFlight = true;
    setSyncState("busy", "Syncing…");

    var attempt = function (remaining) {
      var config = syncConfig;
      // The voice queue lives in its own file per entry, so reading it runs
      // alongside the main document rather than blocking on it. A queue
      // hiccup (offline, a bad token) must never fail the sync it rode in
      // on, so it is swallowed here rather than left to reject the pair.
      var voicePromise = processVoiceQueue(config).catch(function () { return 0; });
      return Promise.all([fetchRemote(config), voicePromise]).then(function (results) {
        var found = results[0];
        var pulledVoice = results[1];
        var remoteDoc = found.doc || {};
        var remoteEvents = Array.isArray(remoteDoc.events) ? remoteDoc.events : [];
        var pulled = mergeIntoLocal(remoteEvents);
        var remotePlans = Array.isArray(remoteDoc.plans) ? remoteDoc.plans : [];
        var pulledPlans = mergePlans(remotePlans);
        if (pulledPlans) savePlans(plans);
        var remoteShopping = Array.isArray(remoteDoc.shopping) ? remoteDoc.shopping : [];
        var pulledShopping = mergeShopping(remoteShopping);
        if (pulledShopping) saveShopping(shopping);
        var remoteRotaShifts = Array.isArray(remoteDoc.rotaShifts) ? remoteDoc.rotaShifts : [];
        var pulledRotaShifts = mergeRotaShifts(remoteRotaShifts);
        if (pulledRotaShifts) saveRotaShifts(rotaShifts);

        var remoteMeta = remoteDoc.meta;
        applyingRemote = true;
        try {
          if (remoteMeta) {
            var stampBefore = metaStamp();
            // Three cases, in order. Connecting is a decision to join the log
            // that is already there, so on a first connection its settings win
            // outright however old they are — without that, a phone with a
            // name typed into it keeps that name and pushes it over everybody
            // else's on its first commit. After that, genuinely newer settings
            // replace ours. Failing both we still take what we are missing,
            // which is how a log written before settings carried a timestamp
            // still fills in a blank phone.
            var remoteNewer = joining || (remoteMeta.updatedAt || "") > metaStamp();
            applyIncomingSettings({
              name: remoteMeta.name,
              nameFont: remoteMeta.nameFont,
              dob: remoteMeta.dob,
              feeding: remoteMeta.feeding,
              intervals: remoteMeta.intervals,
              photoAlbum: remoteMeta.photoAlbum,
              takeIntervals: remoteNewer,
              overwrite: remoteNewer
            });
            // Adopt their stamp rather than stamping ourselves, or each pull
            // would look like a local edit and push straight back.
            // Filling in blanks is not a local edit, so keep our own stamp
            // where it was rather than claiming to be the newer side.
            setMetaStamp(remoteNewer ? remoteMeta.updatedAt : stampBefore);
          }
          if (pulled || pulledVoice) saveEvents(events);
        } finally {
          applyingRemote = false;
        }
        if (pulledPlans) renderPlans();
        if (pulledShopping) renderShopping();
        if (pulledRotaShifts) { renderRotaBanner(); renderRotaWeek(); }
        if (pulled || pulledVoice || remoteMeta) renderAll();

        // Drop what has aged out before comparing, so the cleaned-up log is
        // what gets compared and sent.
        var pruned = pruneTombstones();
        if (pruned) saveEvents(events);
        if (prunePlanTombstones()) savePlans(plans);
        var shopRetired = retireBoughtShopping();
        var shopPruned = pruneShopTombstones();
        if (shopRetired || shopPruned) saveShopping(shopping);
        if (pruneRotaShiftTombstones()) saveRotaShifts(rotaShifts);

        var remoteCarriesExpired = remoteEvents.some(tombstoneExpired) ||
          remotePlans.some(tombstoneExpired) || remoteShopping.some(tombstoneExpired) ||
          remoteRotaShifts.some(tombstoneExpired);
        var mustPush = !found.sha || remoteCarriesExpired || remoteHasNothingOfOurs(remoteEvents) ||
          remoteMissesOurPlans(remotePlans) || remoteMissesOurShopping(remoteShopping) ||
          remoteMissesOurRotaShifts(remoteRotaShifts) ||
          metaStamp() > ((remoteMeta && remoteMeta.updatedAt) || "");
        if (!mustPush) return { pulled: pulled + pulledVoice, pushed: 0 };

        return putRemote(config, localDocument(), found.sha).then(function (sha) {
          syncConfig.sha = sha;
          saveSyncConfig(syncConfig);
          return { pulled: pulled + pulledVoice, pushed: 1 };
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
        showToast("Synced — " + result.pulled + (result.pulled === 1 ? " new entry" : " new entries"));
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
    // Only a first connection is a join. The same button says "Save changes"
    // once connected, and correcting a token there must not throw away a
    // setting changed a minute earlier.
    var joining = !syncConfig;
    syncConfig = { repo: repo, token: token, sha: null };
    if (!saveSyncConfig(syncConfig)) return;
    renderSyncState();
    startSyncPolling();
    syncNow("manual", joining).then(function (ok) {
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

  // Stored raw, so "nothing chosen yet" stays distinguishable from "chose the
  // default": one is a blank an incoming setting may fill, the other is not.
  function storedNameFont() {
    try {
      return localStorage.getItem(NAME_FONT_KEY) || "";
    } catch (e) {
      return "";
    }
  }

  function knownNameFont(id) {
    return NAME_FONTS.some(function (font) { return font.id === id; });
  }

  function saveNameFont(id) {
    try {
      localStorage.setItem(NAME_FONT_KEY, id);
      // The style belongs to the baby's name, not to the handset, so it
      // travels with the other settings and dates itself the same way.
      touchMeta();
      scheduleSync();
    } catch (e) {
      showError("Couldn't save the name style");
    }
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

  el.photoAlbum.value = loadPhotoAlbum();
  el.photoAlbum.addEventListener("change", function () {
    if (savePhotoAlbum(el.photoAlbum.value)) el.photoAlbum.value = loadPhotoAlbum();
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

  // ---------- carer rota ----------

  var rotaShifts = loadRotaShifts();

  function todaysRotaShift() {
    return rotaShiftFor(dayKeyOf(new Date()));
  }

  // Calendar-local minutes since midnight, not epoch arithmetic — adding
  // hours straight across a clock change is how the immunisation dates once
  // came out a day early, and a shift window would drift the same way.
  function rotaShiftRange(shift, atDate) {
    if (!shift || !shift.hours || !shift.start) return null;
    var mins = Number(shift.start.slice(0, 2)) * 60 + Number(shift.start.slice(3, 5));
    var base = new Date(atDate.getFullYear(), atDate.getMonth(), atDate.getDate());
    var from = new Date(base.getTime() + mins * MS_MIN);
    var to = new Date(from.getTime() + shift.hours * MS_HOUR);
    return { from: from, to: to };
  }

  // A quiet line on the main screen, and only while today's shift has a
  // known start time and is actually on — a shift with no start time has
  // nothing to count down to, so it earns no line here.
  function renderRotaBanner() {
    var range = rotaShiftRange(todaysRotaShift(), new Date());
    var now = Date.now();
    var active = !!range && now >= +range.from && now < +range.to;
    el.rotaBanner.hidden = !active;
    if (active) el.rotaBannerText.textContent = "Carer here until " + formatClockTime(range.to);
  }

  // ---------- carer rota: the week editor ----------

  // One week on screen at a time, every day of it editable in place — no
  // separate add-a-shift form to open and close. The first version of this
  // asked for a date, hours and a start time through a form for every single
  // shift; direct feedback was that a week's worth of that is too many taps,
  // and that a native time input scrolling a minute at a time made the start
  // time the worst of it. This is the reply to both: tap a day to cycle it
  // through nothing set, off, and working (in that order, so marking a day
  // off — the thing asked to be quicker — is always a single tap away), and
  // the two dropdowns that appear are pre-set to sensible defaults rather
  // than left blank.
  function startOfWeek(d) {
    var weekday = (d.getDay() + 6) % 7; // 0 = Monday
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - weekday);
  }

  var rotaWeekStart = startOfWeek(new Date());

  function rotaWeekDates(weekStart) {
    var days = [];
    for (var i = 0; i < 7; i++) days.push(new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i));
    return days;
  }

  function rotaWeekRangeLabel(weekStart) {
    var days = rotaWeekDates(weekStart);
    var first = days[0], last = days[6];
    var firstLabel = first.getDate() + " " + MONTHS[first.getMonth()].slice(0, 3);
    var lastLabel = (first.getMonth() === last.getMonth())
      ? String(last.getDate())
      : (last.getDate() + " " + MONTHS[last.getMonth()].slice(0, 3));
    return firstLabel + "–" + lastLabel;
  }

  function rotaDayState(shift) {
    if (!shift) return "unset";
    return shift.off ? "off" : "on";
  }

  function buildRotaTimeOptions(select) {
    select.innerHTML = "";
    ROTA_TIME_OPTIONS.forEach(function (t) {
      var opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      select.appendChild(opt);
    });
  }

  function rotaDayRow(date) {
    var key = dayKeyOf(date);
    var shift = rotaShiftFor(key);
    var state = rotaDayState(shift);
    var row = document.createElement("div");
    row.className = "rota-row";
    row.innerHTML =
      '<button type="button" class="rota-toggle" data-state="' + state + '">' +
        '<span class="rota-day-name">' + WEEKDAYS[date.getDay()].slice(0, 3) + ' ' + date.getDate() + '</span>' +
        '<span class="rota-day-state">' + (state === "off" ? "Off" : state === "unset" ? "—" : "") + '</span>' +
      '</button>' +
      '<div class="rota-detail"' + (state === "on" ? "" : " hidden") + '>' +
        '<select class="rota-hours-select" aria-label="Hours"></select>' +
        '<select class="rota-start-select" aria-label="Start time"></select>' +
      '</div>';

    var toggle = row.querySelector(".rota-toggle");
    var hoursSelect = row.querySelector(".rota-hours-select");
    var startSelect = row.querySelector(".rota-start-select");

    ROTA_HOURS.forEach(function (h) {
      var opt = document.createElement("option");
      opt.value = String(h);
      opt.textContent = h + "h";
      hoursSelect.appendChild(opt);
    });
    buildRotaTimeOptions(startSelect);
    hoursSelect.value = String((shift && shift.hours) || ROTA_DEFAULT_HOURS);
    startSelect.value = (shift && shift.start) || ROTA_DEFAULT_START;

    var saveWorking = function () {
      return saveRotaDay(key, {
        hours: Number(hoursSelect.value) || ROTA_DEFAULT_HOURS,
        start: startSelect.value || ROTA_DEFAULT_START
      });
    };

    toggle.addEventListener("click", function () {
      var ok = state === "unset" ? saveRotaDay(key, { off: true })
        : state === "off" ? saveWorking()
        : clearRotaDay(key);
      if (!ok) return;
      renderRotaWeek();
      renderRotaBanner();
    });
    hoursSelect.addEventListener("change", function () { if (saveWorking()) renderRotaBanner(); });
    startSelect.addEventListener("change", function () { if (saveWorking()) renderRotaBanner(); });

    return row;
  }

  function renderRotaWeek() {
    el.rotaWeekRange.textContent = rotaWeekRangeLabel(rotaWeekStart);
    var days = rotaWeekDates(rotaWeekStart);
    var total = 0;
    el.rotaWeekDays.innerHTML = "";
    days.forEach(function (d) {
      var shift = rotaShiftFor(dayKeyOf(d));
      if (shift && !shift.off) total += shift.hours;
      el.rotaWeekDays.appendChild(rotaDayRow(d));
    });
    el.rotaWeekTotal.textContent = total ? (total + (total === 1 ? " hour" : " hours")) : "—";
  }

  el.rotaWeekPrev.addEventListener("click", function () {
    rotaWeekStart = new Date(rotaWeekStart.getFullYear(), rotaWeekStart.getMonth(), rotaWeekStart.getDate() - 7);
    renderRotaWeek();
  });
  el.rotaWeekNext.addEventListener("click", function () {
    rotaWeekStart = new Date(rotaWeekStart.getFullYear(), rotaWeekStart.getMonth(), rotaWeekStart.getDate() + 7);
    renderRotaWeek();
  });

  el.rotaOpenBtn.addEventListener("click", function () {
    rotaWeekStart = startOfWeek(new Date());
    renderRotaWeek();
    showScreen("rota");
  });
  el.rotaBack.addEventListener("click", showMain);
  el.rotaBannerBtn.addEventListener("click", function () {
    rotaWeekStart = startOfWeek(new Date());
    renderRotaWeek();
    showScreen("rota");
  });

  // ---------- handover: the words ----------

  // Russian counts in three forms, and which one you need depends on the last
  // digit: 1 кормление, 2 кормления, 5 кормлений — with the teens breaking the
  // rule they otherwise look like they follow.
  function pluralRu(n, one, few, many) {
    var ten = n % 10;
    var hundred = n % 100;
    if (ten === 1 && hundred !== 11) return one;
    if (ten >= 2 && ten <= 4 && (hundred < 12 || hundred > 14)) return few;
    return many;
  }

  // Months in the genitive, because a Russian date reads "13 августа" and
  // never "13 август".
  var MONTHS_RU = ["января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  var WEEKDAYS_RU = ["воскресенье", "понедельник", "вторник", "среда",
    "четверг", "пятница", "суббота"];

  function durationRu(ms) {
    if (ms < 0) ms = 0;
    var totalMin = Math.floor(ms / MS_MIN);
    var h = Math.floor(totalMin / 60);
    var m = totalMin % 60;
    if (h <= 0) return m + " мин";
    if (m === 0) return h + " ч";
    return h + " ч " + m + " мин";
  }

  function ageRu(days) {
    if (days === null || days < 0) return "";
    if (days < 14) return days + "-й день";
    var weeks = Math.floor(days / 7);
    var rest = days % 7;
    if (weeks < 9) {
      return weeks + " " + pluralRu(weeks, "неделя", "недели", "недель") +
        (rest ? " " + rest + " " + pluralRu(rest, "день", "дня", "дней") : "");
    }
    var months = Math.floor(days / 30.44);
    return months + " " + pluralRu(months, "месяц", "месяца", "месяцев");
  }

  var MEASURE_RU = {
    weight: "Вес",
    height: "Рост",
    temp: "Температура",
    head: "Окружность головы",
    other: ""
  };

  // A decimal point is a thousands separator to a Russian reader, so 37.2 has
  // to become 37,2 before it goes on screen.
  function measureValueRu(event) {
    var value = measureValueOf(event);
    var comma = function (shown) { return String(shown).replace(".", ","); };
    if (event.type === "weight") return comma(Math.round(value) / 1000) + " кг";
    if (event.type === "temp") return comma(value.toFixed(1)) + " °C";
    if (event.type === "height" || event.type === "head") return comma(value.toFixed(1)) + " см";
    var unit = measureUnitOf(event);
    return comma(Number(value.toFixed(2))) + (unit ? " " + unit : "");
  }

  // Every sentence on the handover screen, in both languages, written as
  // functions rather than as strings with holes punched in them. Russian puts
  // the words in a different order from English and bends their endings to
  // match what is being counted, so a fragment translated on its own comes out
  // wrong however carefully it is translated. The two halves of each entry sit
  // next to each other on purpose: that is the only thing stopping them
  // drifting apart as the screen changes.
  //
  // Nothing here says "he" or "she". The app is never told which, and Russian
  // verbs in the past tense would have to pick one, so every line is phrased
  // around a noun instead — "Сон начался", not "он заснул".
  var HANDOVER_TEXT = {
    en: {
      screenTitle: "Handover",
      back: "Back",
      windowLabel: "The last",
      langLabel: "Language",
      hours: function (n) { return n + " hours"; },
      noName: "The baby",
      age: function (days) { return formatAge(days); },
      now: function (clock, date, hours) {
        return "It is " + clock + " on " + date + ". Everything below covers the last " +
          hours + ", up to this minute.";
      },
      empty: "Nothing has been logged in this stretch.",
      footer: "All of this is worked out from what has been logged. Anything nobody " +
        "tapped in is not here — a quiet strip can mean a quiet night or a phone left " +
        "in another room.",
      stripLabel: function (hours) {
        return "The last " + hours + " drawn as a strip. Everything marked on it is " +
          "written out in words underneath.";
      },

      duration: function (ms) { return formatDuration(ms); },
      dateHeader: function (date) { return formatDateHeader(date); },
      // The day word trails the time in English and leads it in Russian, which
      // is exactly why this cannot be assembled from shared pieces.
      at: function (date, day) {
        var time = formatClockTime(date);
        if (day === "today") return "at " + time;
        if (day === "yesterday") return "at " + time + " yesterday";
        if (day === "tomorrow") return "at " + time + " tomorrow";
        return "at " + time + " on " + formatDateHeader(date);
      },
      ago: function (ms) { return formatDuration(ms) + " ago"; },

      asleepFor: function (dur) { return "Asleep for " + dur; },
      wentDown: function (at) { return "Went down " + at + "."; },
      longSleep: "That is a long stretch — the wake-up may never have been logged.",
      awake: "Awake",
      woke: function (atAgo) { return "Woke " + atAgo + "."; },

      feeds: function (n) { return n + (n === 1 ? " feed" : " feeds"); },
      noFeeds: "No feeds",
      lastFeed: function (atAgo, extras) {
        return "Last " + atAgo + (extras ? " — " + extras : "") + ".";
      },
      feedLength: function (dur) { return dur + " on it"; },
      feedSource: function (source) { return source.label.toLowerCase(); },
      nothingLogged: "Nothing has been logged yet.",
      spacing: function (middle, shortest, longest) {
        return "About " + middle + " apart" +
          (shortest ? " — anything from " + shortest + " to " + longest : "") + ".";
      },
      feedingTotal: function (dur, timed, all) {
        return dur + " spent feeding" + (timed
          ? ", though only " + timed + " of the " + all + (timed === 1 ? " was timed." : " were timed.")
          : ".");
      },

      nappies: function (n) { return n + (n === 1 ? " nappy" : " nappies"); },
      noNappies: "No nappies",
      wet: function (n) { return n + " wet"; },
      dirty: function (n) { return n + " dirty"; },
      dry: function (n) { return n + " dry"; },
      unsaid: function (n) { return n + " not recorded"; },
      lastNappy: function (atAgo) { return "Last " + atAgo + "."; },
      noDirty: function (atAgo) {
        return "Nothing dirty in this stretch — the last was " + atAgo + ".";
      },

      asleepTotal: function (dur) { return dur + " asleep"; },
      noSleep: "No sleep logged",
      stretches: function (n, longest) {
        return "In " + n + (n === 1 ? " stretch" : " stretches") +
          (longest ? ", the longest " + longest : "") + ".";
      },
      clipped: "One of those began before this stretch and is counted only from where it starts.",

      dueTitle: "Due next",
      kind: function (kind) { return KIND_META[kind].label; },
      dueIn: function (dur) { return "in " + dur; },
      dueLate: function (dur) { return "was due " + dur + " ago"; },
      dueNow: "due about now",
      dueLine: function (icon, label, phrase, at) {
        return icon + " " + label + " " + phrase + ", " + at + ".";
      },
      dueAsleep: function (icon, label) { return icon + " " + label + " — asleep right now."; },
      dueNote: "These come off the plan in Settings, not off the baby.",

      readingsTitle: "Readings taken",
      readingLine: function (event, at) {
        var named = MEASURES[event.type].freeform ? "" : MEASURES[event.type].label + " ";
        return named + measureLine(event) + " " + at + ".";
      },
      tempHigh: function (event) {
        return formatMeasure("temp", measureValueOf(event)) + " is a high temperature.";
      },
      tempHighAdvice: function (knowsAge) {
        return knowsAge
          ? "Call an ambulance straight away for a baby this age — 999 in the UK, 112 across " +
            "Europe. For anything less urgent, NHS 111 in the UK, or your doctor."
          : "At 38°C or above in a baby under 3 months, call an ambulance now — 999 in the UK, " +
            "112 across Europe. Set the date of birth in Settings and this will use the right " +
            "threshold for your baby's age.";
      },
      tempLow: function (event) {
        return formatMeasure("temp", measureValueOf(event)) + " is low.";
      },
      tempLowAdvice: "A temperature below 36°C in a baby needs checking — ring your doctor, or " +
        "NHS 111 in the UK. Call an ambulance (999, or 112 across Europe) if they are also " +
        "floppy, pale or hard to wake.",

      planTitle: "Coming up",
      planWhen: function (date, hasTime, day) {
        var named = day === "today" ? "Today" : day === "tomorrow" ? "Tomorrow"
          : day === "yesterday" ? "Yesterday" : formatDateHeader(date);
        return hasTime ? named + " at " + formatClockTime(date) : named;
      },
      planLine: function (when, title, place) {
        return when + " — " + title + (place ? ", " + place : "") + ".";
      }
    },

    ru: {
      screenTitle: "Передача смены",
      back: "Назад",
      windowLabel: "Последние",
      langLabel: "Язык",
      hours: function (n) { return n + " " + pluralRu(n, "час", "часа", "часов"); },
      noName: "Ребёнок",
      age: function (days) { return ageRu(days); },
      now: function (clock, date, hours) {
        return "Сейчас " + clock + ", " + date + ". Всё ниже — за последние " +
          hours + ", до текущей минуты.";
      },
      empty: "За это время ничего не записано.",
      footer: "Всё это посчитано по тому, что записали. Чего никто не отметил — здесь нет: " +
        "пустая полоска может значить и спокойную ночь, и телефон, забытый в другой комнате.",
      stripLabel: function (hours) {
        return "Последние " + hours + " в виде полоски. Всё, что на ней отмечено, ниже " +
          "написано словами.";
      },

      duration: function (ms) { return durationRu(ms); },
      dateHeader: function (date) {
        return WEEKDAYS_RU[date.getDay()] + ", " + date.getDate() + " " + MONTHS_RU[date.getMonth()];
      },
      at: function (date, day) {
        var time = formatClockTime(date);
        if (day === "today") return "в " + time;
        if (day === "yesterday") return "вчера в " + time;
        if (day === "tomorrow") return "завтра в " + time;
        return date.getDate() + " " + MONTHS_RU[date.getMonth()] + " в " + time;
      },
      ago: function (ms) { return durationRu(ms) + " назад"; },

      asleepFor: function (dur) { return "Спит " + dur; },
      wentDown: function (at) { return "Сон начался " + at + "."; },
      longSleep: "Это очень долго — возможно, пробуждение не записали.",
      awake: "Не спит",
      woke: function (atAgo) { return "Пробуждение " + atAgo + "."; },

      feeds: function (n) { return n + " " + pluralRu(n, "кормление", "кормления", "кормлений"); },
      noFeeds: "Кормлений нет",
      lastFeed: function (atAgo, extras) {
        return "Последнее " + atAgo + (extras ? " — " + extras : "") + ".";
      },
      feedLength: function (dur) { return dur; },
      feedSource: function (source) {
        return { breast: "грудь", formula: "смесь", expressed: "сцеженное" }[source.id] || "";
      },
      nothingLogged: "Пока ничего не записано.",
      spacing: function (middle, shortest, longest) {
        return "В среднем каждые " + middle +
          (shortest ? " — от " + shortest + " до " + longest : "") + ".";
      },
      feedingTotal: function (dur, timed, all) {
        return "На кормления ушло " + dur + (timed
          ? ", но длительность записана только у " + timed + " из " + all + "."
          : ".");
      },

      nappies: function (n) { return n + " " + pluralRu(n, "подгузник", "подгузника", "подгузников"); },
      noNappies: "Подгузников нет",
      wet: function (n) { return n + " " + pluralRu(n, "мокрый", "мокрых", "мокрых"); },
      dirty: function (n) { return n + " " + pluralRu(n, "грязный", "грязных", "грязных"); },
      dry: function (n) { return n + " " + pluralRu(n, "сухой", "сухих", "сухих"); },
      unsaid: function (n) { return n + " без пометки"; },
      lastNappy: function (atAgo) { return "Последний " + atAgo + "."; },
      noDirty: function (atAgo) {
        return "Грязных за это время не было — последний " + atAgo + ".";
      },

      asleepTotal: function (dur) { return "Сон " + dur; },
      noSleep: "Сон не записан",
      stretches: function (n, longest) {
        return "За " + n + " " + pluralRu(n, "заход", "захода", "заходов") +
          (longest ? ", самый долгий " + longest : "") + ".";
      },
      clipped: "Один из них начался раньше этого отрезка и посчитан только с его начала.",

      dueTitle: "Дальше по плану",
      kind: function (kind) {
        return { feed: "Кормление", diaper: "Подгузник", sleep: "Сон" }[kind];
      },
      dueIn: function (dur) { return "через " + dur; },
      // "просрочено" would have to agree in gender with the word in front of
      // it, and it cannot agree with both "кормление" and "подгузник". A
      // prepositional phrase agrees with nothing, which is the point.
      dueLate: function (dur) { return "с опозданием на " + dur; },
      dueNow: "пора сейчас",
      dueLine: function (icon, label, phrase, at) {
        return icon + " " + label + " — " + phrase + " (" + at + ").";
      },
      dueAsleep: function (icon, label) { return icon + " " + label + " — сейчас спит."; },
      dueNote: "Это расчёт по интервалам из настроек, а не наблюдение за ребёнком.",

      readingsTitle: "Замеры",
      readingLine: function (event, at) {
        var label = MEASURES[event.type].freeform
          ? measureLabelOf(event) : MEASURE_RU[event.type];
        return (label ? label + " " : "") + measureValueRu(event) + " " + at + ".";
      },
      tempHigh: function (event) {
        return measureValueRu(event) + " — высокая температура.";
      },
      tempHighAdvice: function (knowsAge) {
        return knowsAge
          ? "Для ребёнка такого возраста сразу вызывайте скорую. " +
            "В Великобритании 999, по Европе 112. " +
            "Если случай не срочный — в Великобритании NHS 111 или ваш врач."
          : "При 38 °C и выше у ребёнка младше 3 месяцев вызывайте скорую немедленно. " +
            "В Великобритании 999, по Европе 112. " +
            "Укажите дату рождения в настройках, и порог будет считаться по возрасту.";
      },
      tempLow: function (event) {
        return measureValueRu(event) + " — низкая температура.";
      },
      tempLowAdvice: "Температура ниже 36 °C у ребёнка требует проверки — позвоните врачу, " +
        "в Великобритании это NHS 111. " +
        "Вызывайте скорую (в Великобритании 999, по Европе 112), если ребёнок к тому же " +
        "вялый, бледный или его трудно разбудить.",

      planTitle: "Дальше в календаре",
      planWhen: function (date, hasTime, day) {
        var named = day === "today" ? "Сегодня" : day === "tomorrow" ? "Завтра"
          : day === "yesterday" ? "Вчера"
          : WEEKDAYS_RU[date.getDay()] + ", " + date.getDate() + " " + MONTHS_RU[date.getMonth()];
        return hasTime ? named + " в " + formatClockTime(date) : named;
      },
      planLine: function (when, title, place) {
        return when + " — " + title + (place ? ", " + place : "") + ".";
      }
    }
  };

  // ---------- handover ----------

  // What somebody arriving at the door asks for, in the order they ask for it.
  // Deliberately a rolling window ending now rather than "today": at nine in
  // the morning today is three hours old, and a handover measured that way
  // says nothing at all about the night the other person just had.
  var handoverHours = HANDOVER_DEFAULT_HOURS;
  var uiLang = storedUiLang();

  // Which language the handover and shopping screens are read in — shared
  // between them, since it is a property of the handset and the person
  // holding it rather than of either screen. Deliberately kept out of the
  // synced settings: the carer's phone reads Russian and the parents' read
  // English at the same time, so one of them choosing must never change it
  // for the others. It stays out of backups, reports and share links too.
  function storedUiLang() {
    try { return localStorage.getItem(LANG_KEY) === "ru" ? "ru" : "en"; }
    catch (e) { return "en"; }
  }

  function saveUiLang(id) {
    try { localStorage.setItem(LANG_KEY, id === "ru" ? "ru" : "en"); }
    catch (e) { showError("Couldn't save the language"); }
  }

  // A duration in whichever language is currently on, shared by every screen
  // that states one rather than each carrying its own copy.
  function uiDuration(ms) { return uiLang === "ru" ? durationRu(ms) : formatDuration(ms); }

  function ho() { return HANDOVER_TEXT[uiLang] || HANDOVER_TEXT.en; }

  function handoverWindow() {
    var toMs = Date.now();
    return { fromMs: toMs - handoverHours * MS_HOUR, toMs: toMs, hours: handoverHours };
  }

  function inHandoverWindow(list, w) {
    return list.filter(function (e) {
      var t = +new Date(e.time);
      return t >= w.fromMs && t <= w.toMs;
    });
  }

  // Which day a time falls on, named rather than formatted, because English
  // trails the day word after the clock and Russian leads with it.
  function handoverDay(date) {
    var now = new Date();
    var key = dayKeyOf(date);
    if (key === dayKeyOf(now)) return "today";
    if (key === dayKeyOf(new Date(now.getTime() - MS_DAY))) return "yesterday";
    if (key === dayKeyOf(new Date(now.getTime() + MS_DAY))) return "tomorrow";
    return "";
  }

  function handoverAt(date) {
    return ho().at(date, handoverDay(date));
  }

  function handoverAgo(date) {
    return handoverAt(date) + ", " + ho().ago(Date.now() - +date);
  }

  // Three numbers rather than one: the middle says what to expect, the spread
  // says whether it is worth expecting anything.
  function handoverSpacing(gaps) {
    if (gaps.length < 2) return "";
    var T = ho();
    var lengths = gaps.map(function (g) { return g.ms; });
    var shortest = Math.min.apply(null, lengths);
    var longest = Math.max.apply(null, lengths);
    // "anything from 3h 24m to 3h 36m" is not a spread, it is the same number
    // said three times. Only a gap wide enough to change what somebody expects
    // earns the extra clause; an empty shortest is how that is asked for.
    var wide = longest - shortest >= HANDOVER_SPREAD_WORTH_SAYING;
    return T.spacing(T.duration(median(lengths)),
      wide ? T.duration(shortest) : "", wide ? T.duration(longest) : "");
  }

  function handoverStateRow(analysis) {
    var T = ho();
    var now = Date.now();
    var row = { icon: "👶", title: "", details: [] };
    if (analysis.active) {
      var down = new Date(analysis.active.time);
      row.title = T.asleepFor(T.duration(now - +down));
      row.details.push(T.wentDown(handoverAt(down)));
      if (now - +down > SUSPICIOUS_SLEEP) row.details.push(T.longSleep);
    } else {
      row.title = T.awake;
      var woke = sortedByTimeDesc(liveEvents().filter(function (e) {
        return e.type === "sleep_end";
      }))[0];
      if (woke) row.details.push(T.woke(handoverAgo(new Date(woke.time))));
    }
    return row;
  }

  function handoverFeedRow(w, live) {
    var T = ho();
    var all = live.filter(function (e) { return e.type === "feed"; });
    var feeds = inHandoverWindow(all, w);
    var row = {
      icon: KIND_META.feed.icon,
      title: feeds.length ? T.feeds(feeds.length) : T.noFeeds,
      details: []
    };
    var last = sortedByTimeDesc(all)[0];
    if (last) {
      var extras = [];
      var mins = fedMinutesOf(last);
      if (mins !== null) extras.push(T.feedLength(T.duration(mins * MS_MIN)));
      var source = feedSource(fedWithOf(last));
      if (source) {
        var named = T.feedSource(source);
        if (named) extras.push(named);
      }
      row.details.push(T.lastFeed(handoverAgo(new Date(last.time)), extras.join(", ")));
    } else {
      row.details.push(T.nothingLogged);
    }
    var spacing = handoverSpacing(aiGaps("feed", w.fromMs));
    if (spacing) row.details.push(spacing);

    // Only ever the feeds somebody actually timed, and it says how many those
    // were — a total over three of eight feeds is not a total. A zero for the
    // count is how "all of them were timed" is asked for.
    var fedMs = 0;
    var timed = 0;
    feeds.forEach(function (e) {
      var m = fedMinutesOf(e);
      if (m === null) return;
      fedMs += m * MS_MIN;
      timed++;
    });
    if (timed) {
      row.details.push(T.feedingTotal(T.duration(fedMs),
        timed < feeds.length ? timed : 0, feeds.length));
    }
    return row;
  }

  function handoverNappyRow(w, live) {
    var T = ho();
    var all = live.filter(function (e) { return e.type === "diaper"; });
    var nappies = inHandoverWindow(all, w);
    var wet = 0, dirty = 0, dry = 0, unsaid = 0;
    nappies.forEach(function (e) {
      var kind = nappyOf(e);
      if (!kind) { unsaid++; return; }
      if (kind === "wet" || kind === "both") wet++;
      if (kind === "dirty" || kind === "both") dirty++;
      if (kind === "dry") dry++;
    });
    var row = {
      icon: KIND_META.diaper.icon,
      title: nappies.length ? T.nappies(nappies.length) : T.noNappies,
      details: []
    };
    var made = [];
    if (wet) made.push(T.wet(wet));
    if (dirty) made.push(T.dirty(dirty));
    if (dry) made.push(T.dry(dry));
    if (unsaid) made.push(T.unsaid(unsaid));
    if (made.length) row.details.push(made.join(", ") + ".");
    var last = sortedByTimeDesc(all)[0];
    if (last) row.details.push(T.lastNappy(handoverAgo(new Date(last.time))));

    // How long since a dirty one is the question a stranger is likeliest to be
    // asked, so it is answered rather than left to be counted off the log.
    if (!dirty) {
      var lastDirty = sortedByTimeDesc(all.filter(function (e) {
        var kind = nappyOf(e);
        return kind === "dirty" || kind === "both";
      }))[0];
      if (lastDirty) row.details.push(T.noDirty(handoverAgo(new Date(lastDirty.time))));
    }
    return row;
  }

  function handoverSleepRow(w, analysis) {
    var T = ho();
    var now = Date.now();
    var stretches = 0;
    var longest = 0;
    var clipped = false;
    var count = function (startMs, endMs) {
      var overlap = Math.min(endMs, w.toMs) - Math.max(startMs, w.fromMs);
      if (overlap <= 0) return;
      stretches++;
      longest = Math.max(longest, overlap);
      if (startMs < w.fromMs) clipped = true;
    };
    analysis.sessions.forEach(function (s) { count(s.startMs, s.endMs); });
    if (analysis.active) count(+new Date(analysis.active.time), now);

    var total = sleepMsInRange(analysis, w.fromMs, w.toMs, now);
    var row = {
      icon: KIND_META.sleep.icon,
      title: total ? T.asleepTotal(T.duration(total)) : T.noSleep,
      details: []
    };
    if (stretches) {
      row.details.push(T.stretches(stretches, stretches > 1 ? T.duration(longest) : ""));
      // Only said when it happened. A sleep that began before the window is
      // counted from where the window starts, and the figure above would
      // otherwise look like the length of the whole sleep.
      if (clipped) row.details.push(T.clipped);
    }
    return row;
  }

  function handoverDueRow(analysis) {
    var T = ho();
    var now = Date.now();
    var row = { icon: "⏭", title: T.dueTitle, details: [] };
    KINDS.forEach(function (kind) {
      if (kind === "sleep" && analysis.active) {
        row.details.push(T.dueAsleep(KIND_META.sleep.icon, T.kind("sleep")));
        return;
      }
      var forecast = computeForecast(kind);
      if (!forecast.hasData) return;
      var diff = +forecast.nextTime - now;
      var phrase = Math.abs(diff) < HANDOVER_DUE_NOW ? T.dueNow
        : diff < 0 ? T.dueLate(T.duration(-diff))
        : T.dueIn(T.duration(diff));
      row.details.push(T.dueLine(KIND_META[kind].icon, T.kind(kind), phrase,
        handoverAt(forecast.nextTime)));
    });
    if (!row.details.length) return null;
    // Said plainly, because a time on a screen looks like knowledge and this
    // is arithmetic on an interval somebody typed into Settings.
    row.details.push(T.dueNote);
    return row;
  }

  function handoverReadingRow(w, live) {
    var T = ho();
    var readings = inHandoverWindow(live.filter(function (e) {
      return MEASURES[e.type] && measureValueOf(e) !== null;
    }), w);
    if (!readings.length) return null;
    var row = { icon: "🌡", title: T.readingsTitle, details: [] };
    sortedByTimeDesc(readings).forEach(function (e) {
      row.details.push(T.readingLine(e, handoverAt(new Date(e.time))));
      // The one thing on this screen that has to be understood rather than
      // merely read, so it is translated with everything else rather than
      // being left in a language the person holding the baby may not have.
      var concern = temperatureConcern(e);
      if (!concern) return;
      if (concern.level === "high") {
        row.details.push(T.tempHigh(e));
        row.details.push(T.tempHighAdvice(ageDaysAt(e.time) !== null));
      } else {
        row.details.push(T.tempLow(e));
        row.details.push(T.tempLowAdvice);
      }
    });
    return row;
  }

  function handoverPlanRow(w) {
    var T = ho();
    var now = Date.now();
    var horizon = now + HANDOVER_PLAN_HORIZON;
    var lines = [];
    sortedPlans().forEach(function (plan) {
      var start = planStart(plan);
      if (start < w.fromMs || start > horizon) return;
      if (lines.length >= HANDOVER_MAX_PLANS) return;
      var at = new Date(start);
      // The title and the place stay exactly as somebody typed them. Nothing
      // here translates what a person wrote, and nothing ever will: that would
      // need a service to ask, and this app asks nobody anything.
      lines.push(T.planLine(T.planWhen(at, !!plan.time, handoverDay(at)),
        plan.title, plan.place || ""));
    });
    return lines.length ? { icon: "📅", title: T.planTitle, details: lines } : null;
  }

  function handoverRows(w) {
    var live = liveEvents();
    var analysis = analyzeSleep();
    var rows = [
      handoverStateRow(analysis),
      handoverFeedRow(w, live),
      handoverNappyRow(w, live),
      handoverSleepRow(w, analysis),
      handoverDueRow(analysis),
      handoverShopRow(),
      handoverReadingRow(w, live),
      handoverPlanRow(w)
    ];
    return rows.filter(function (row) { return !!row; });
  }

  function renderHandoverLines(rows) {
    el.handoverLines.innerHTML = "";
    rows.forEach(function (row) {
      var wrap = document.createElement("div");
      wrap.className = "ho-row";
      var icon = document.createElement("span");
      icon.className = "ho-icon";
      icon.textContent = row.icon;
      var body = document.createElement("div");
      body.className = "ho-body";
      var title = document.createElement("div");
      title.className = "ho-title";
      title.textContent = row.title;
      body.appendChild(title);
      row.details.forEach(function (text) {
        var line = document.createElement("div");
        line.className = "ho-detail";
        line.textContent = text;
        body.appendChild(line);
      });
      wrap.appendChild(icon);
      wrap.appendChild(body);
      el.handoverLines.appendChild(wrap);
    });
  }

  // Drawn by hand as inline SVG, because the alternative is a charting library
  // and this app fetches nothing. Time runs left to right and ends at now;
  // the three rails are the three buttons on the main screen, in that order.
  // Colour never carries meaning on its own — each rail is labelled with the
  // same icon as its button, and every mark on it is written out underneath.
  // It is also the one part of the screen that needs no translation: an icon
  // and a clock read the same in both languages.
  function handoverStripSvg(w) {
    var WIDTH = 320, LEFT = 22, RIGHT = 4, TOP = 4, LANE = 20, GAP = 6, AXIS = 15;
    var lanes = [
      { kind: "feed", cls: "m-feed" },
      { kind: "diaper", cls: "m-diaper" },
      { kind: "sleep", cls: "m-sleep" }
    ];
    var plotW = WIDTH - LEFT - RIGHT;
    var band = lanes.length * (LANE + GAP) - GAP;
    var height = TOP + band + AXIS;
    var span = w.toMs - w.fromMs;
    var live = liveEvents();
    var analysis = analyzeSleep();
    var T = ho();

    function x(ms) {
      var at = LEFT + (Math.max(w.fromMs, Math.min(w.toMs, ms)) - w.fromMs) / span * plotW;
      return Math.round(at * 10) / 10;
    }
    function laneTop(i) { return TOP + i * (LANE + GAP); }

    var out = ['<svg class="ho-svg" viewBox="0 0 ' + WIDTH + ' ' + height + '" role="img" ' +
      'aria-label="' + escapeHtml(T.stripLabel(T.hours(w.hours))) + '">'];

    // Night shaded behind everything, walked hour by hour on the local clock
    // rather than by adding milliseconds, so a clock change cannot slide the
    // band sideways.
    var seg = w.fromMs;
    while (seg < w.toMs) {
      var startsAt = new Date(seg);
      var next = new Date(seg);
      next.setMinutes(0, 0, 0);
      next.setHours(next.getHours() + 1);
      var end = Math.min(+next, w.toMs);
      if (end <= seg) break;
      var hour = startsAt.getHours();
      if (hour >= AI_NIGHT_FROM || hour < AI_NIGHT_TO) {
        out.push('<rect class="ho-night" x="' + x(seg) + '" y="' + TOP +
          '" width="' + (x(end) - x(seg)) + '" height="' + band + '"/>');
      }
      seg = end;
    }

    // Enough hours named to place a mark, few enough that the numbers do not
    // collide on a phone held in one hand.
    var step = w.hours <= 6 ? 1 : (w.hours <= 12 ? 3 : 6);
    var tick = new Date(w.fromMs);
    tick.setMinutes(0, 0, 0);
    tick.setHours(tick.getHours() + 1);
    while (+tick < w.toMs) {
      if (tick.getHours() % step === 0) {
        var tx = x(+tick);
        if (tx > LEFT + 9 && tx < LEFT + plotW - 9) {
          out.push('<line class="ho-grid" x1="' + tx + '" y1="' + TOP + '" x2="' + tx +
            '" y2="' + (TOP + band) + '"/>');
          out.push('<text class="ho-tick" x="' + tx + '" y="' + (height - 3) +
            '" text-anchor="middle">' + pad2(tick.getHours()) + ':00</text>');
        }
      }
      tick.setHours(tick.getHours() + 1);
    }

    lanes.forEach(function (lane, i) {
      var cy = laneTop(i) + LANE / 2;
      out.push('<line class="ho-rail" x1="' + LEFT + '" y1="' + cy + '" x2="' +
        (LEFT + plotW) + '" y2="' + cy + '"/>');
      out.push('<text class="ho-lane-icon" x="0" y="' + (cy + 4) + '">' +
        KIND_META[lane.kind].icon + '</text>');

      if (lane.kind === "sleep") {
        var bars = analysis.sessions.slice();
        if (analysis.active) {
          bars.push({ startMs: +new Date(analysis.active.time), endMs: w.toMs });
        }
        bars.forEach(function (s) {
          if (s.endMs < w.fromMs || s.startMs > w.toMs) return;
          var wide = Math.max(3, x(s.endMs) - x(s.startMs));
          out.push('<rect class="' + lane.cls + '" x="' +
            Math.min(x(s.startMs), LEFT + plotW - wide) + '" y="' + (cy - 6) +
            '" width="' + (Math.round(wide * 10) / 10) + '" height="12" rx="3"/>');
        });
        return;
      }

      inHandoverWindow(live.filter(function (e) { return e.type === lane.kind; }), w)
        .forEach(function (e) {
          var at = x(+new Date(e.time));
          // A timed feed is drawn as long as it took, so a forty-minute feed
          // does not look the same as a five-minute one.
          var mins = lane.kind === "feed" ? fedMinutesOf(e) : null;
          var wide = Math.max(3, mins ? (mins * MS_MIN) / span * plotW : 3);
          // Something logged this minute sits exactly on the right-hand edge,
          // where a mark of any width would be drawn outside the strip. It is
          // the one thing on here nobody can afford to miss, so it is nudged
          // back inside rather than clipped away.
          out.push('<rect class="' + lane.cls + '" x="' +
            Math.min(at, LEFT + plotW - wide) + '" y="' + (cy - 7) +
            '" width="' + (Math.round(wide * 10) / 10) + '" height="14" rx="1.5"/>');
        });
    });

    out.push('</svg>');
    return out.join("");
  }

  // Shared by every screen that offers a language choice — handover and the
  // shopping list both read it, so both build the same two buttons rather
  // than each keeping its own copy that could drift out of step.
  function buildLangChips(container) {
    LANG_CHOICES.forEach(function (lang) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ho-chip ho-chip-lang";
      // Never translated and never restyled by which language is on: whichever
      // one somebody cannot read, both chips look the same to them.
      btn.textContent = lang.label;
      btn.addEventListener("click", function () {
        uiLang = lang.id;
        saveUiLang(lang.id);
        renderHandover();
        renderShopping();
      });
      container.appendChild(btn);
    });
  }

  function markLangChips(container) {
    Array.prototype.forEach.call(container.children, function (btn, i) {
      var on = LANG_CHOICES[i].id === uiLang;
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function buildHandoverChips() {
    HANDOVER_HOURS.forEach(function (hours) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ho-chip";
      btn.addEventListener("click", function () {
        handoverHours = hours;
        renderHandover();
      });
      el.handoverHours.appendChild(btn);
    });
    buildLangChips(el.handoverLangs);
  }

  function markHandoverChips() {
    var T = ho();
    Array.prototype.forEach.call(el.handoverHours.children, function (btn, i) {
      var on = HANDOVER_HOURS[i] === handoverHours;
      btn.textContent = T.hours(HANDOVER_HOURS[i]);
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
    markLangChips(el.handoverLangs);
  }

  // The heading and the two labels a screen reader announces. Set at startup
  // too, so the button in the top bar is named in the right language before
  // anybody has opened the screen behind it.
  function applyHandoverChrome() {
    var T = ho();
    el.handoverTitle.textContent = T.screenTitle;
    el.handoverBack.setAttribute("aria-label", T.back);
    el.handoverOpenBtn.setAttribute("aria-label", T.screenTitle);
  }

  function renderHandover() {
    var T = ho();
    var w = handoverWindow();
    var now = new Date();
    var typed = loadName().trim();
    var ageDays = ageDaysAt(Date.now());
    var age = ageDays === null ? "" : T.age(ageDays);

    el.handoverWho.textContent = (typed || T.noName) + (age ? ", " + age : "");
    el.handoverWhen.textContent = T.now(formatClockTime(now), T.dateHeader(now), T.hours(w.hours));
    el.handoverWindowLabel.textContent = T.windowLabel;
    el.handoverLangLabel.textContent = T.langLabel;
    el.handoverEmpty.textContent = T.empty;
    el.handoverFooter.textContent = T.footer;

    applyHandoverChrome();
    markHandoverChips();
    el.handoverStrip.innerHTML = handoverStripSvg(w);
    el.handoverEmpty.hidden = inHandoverWindow(liveEvents(), w).length > 0;
    renderHandoverLines(handoverRows(w));
  }

  el.handoverOpenBtn.addEventListener("click", function () {
    showScreen("handover");
    renderHandover();
  });
  el.handoverBack.addEventListener("click", showMain);


  // ---------- a shopping list ----------

  // Structurally the diary again: a list of records with an id, an updatedAt
  // and a tombstone, merged by the same last-write-wins rule and carried in
  // the same synced document. Where it differs is that ticking something off
  // is a state and not a deletion — a mis-tap has to be undoable, and "bought
  // this morning" is worth being able to see for the rest of the day.
  var SHOPPING_TEXT = {
    en: {
      screenTitle: "Shopping list",
      back: "Back",
      langLabel: "Language",
      badge: function (n) { return String(n); },
      whatLabel: "What is needed",
      linkLabel: "Link",
      linkOptional: "— optional",
      // Whichever of the two is on the pill is where a tap sends it next —
      // said as the destination, not the current state, matching the tick's
      // own "Mark as bought" / "Put it back" pattern.
      statusLabel: { "new": "New", ordered: "Ordered", arrived: "Arrived" },
      statusNext: { "new": "Mark as ordered", ordered: "Mark as arrived", arrived: "Mark as new" },
      etaFieldLabel: "Expected arrival",
      etaLabel: function (days) {
        if (days === null) return "";
        if (days === 0) return "today";
        if (days === 1) return "tomorrow";
        if (days === -1) return "overdue by a day";
        if (days > 1) return "in " + days + " days";
        return "overdue by " + (-days) + " days";
      },
      add: "Add",
      save: "Save",
      cancel: "Cancel",
      empty: "Nothing on the list.",
      toBuy: "To buy",
      bought: "Bought",
      addedAgo: function (dur) { return "added " + dur + " ago"; },
      boughtAgo: function (dur) { return "bought " + dur + " ago"; },
      openLink: "🛒 Open",
      searchAmazon: "🛒 Amazon",
      markBought: "Mark as bought",
      markNotBought: "Put it back on the list",
      remove: "Delete",
      edit: "Edit item",
      added: "Added to the list",
      updated: "Item updated",
      removed: "Item deleted",
      needText: "Type what is needed, or paste a link",
      badLink: "A link has to start with http:// or https://",
      quiet: "Nobody is told. There is no server behind this app and a web page cannot ring " +
        "a phone, so an item added at eight is seen when the other person next opens the app.",
      amazonNote: "Either box is enough on its own. A link with nothing typed shows as the " +
        "link itself until you rename it; a name with no link searches Amazon UK for it " +
        "instead. A link is opened by the phone, which hands it to the Amazon app if one is " +
        "installed. Nothing is sent anywhere until somebody taps it.",
      // Read out on the handover screen, so the list is seen without a
      // separate trip to its own screen.
      handoverTitle: function (n) { return n === 1 ? "1 item to buy" : n + " items to buy"; },
      handoverLine: function (titles, more) {
        return titles.join(", ") + (more ? " and " + more + " more." : ".");
      }
    },
    ru: {
      screenTitle: "Список покупок",
      back: "Назад",
      langLabel: "Язык",
      badge: function (n) { return String(n); },
      whatLabel: "Что нужно купить",
      linkLabel: "Ссылка",
      linkOptional: "— необязательно",
      statusLabel: { "new": "Новое", ordered: "Заказано", arrived: "Приехало" },
      statusNext: { "new": "Отметить заказанным", ordered: "Отметить прибывшим",
        arrived: "Вернуть в «новое»" },
      etaFieldLabel: "Ожидаемая дата",
      etaLabel: function (days) {
        if (days === null) return "";
        if (days === 0) return "сегодня";
        if (days === 1) return "завтра";
        if (days === -1) return "просрочено на день";
        if (days > 1) return "через " + pluralRu(days, days + " день", days + " дня", days + " дней");
        var n = -days;
        return "просрочено на " + pluralRu(n, n + " день", n + " дня", n + " дней");
      },
      add: "Добавить",
      save: "Сохранить",
      cancel: "Отмена",
      empty: "В списке пусто.",
      toBuy: "Нужно купить",
      bought: "Куплено",
      addedAgo: function (dur) { return "добавлено " + dur + " назад"; },
      boughtAgo: function (dur) { return "куплено " + dur + " назад"; },
      openLink: "🛒 Открыть",
      searchAmazon: "🛒 Amazon",
      markBought: "Отметить купленным",
      markNotBought: "Вернуть в список",
      remove: "Удалить",
      edit: "Изменить позицию",
      added: "Добавлено в список",
      updated: "Позиция изменена",
      removed: "Позиция удалена",
      needText: "Напишите, что нужно купить, или вставьте ссылку",
      badLink: "Ссылка должна начинаться с http:// или https://",
      quiet: "Никого не уведомит. Сервера за приложением нет, а веб-страница не может позвонить " +
        "на телефон, поэтому добавленное в восемь утра увидят, когда в следующий раз откроют " +
        "приложение.",
      amazonNote: "Достаточно заполнить только одно поле. Если есть только ссылка, вместо " +
        "названия покажется сама ссылка — пока её не переименуют; если есть только название, " +
        "кнопка ищет его на Amazon UK. Ссылку открывает телефон: если установлено приложение " +
        "Amazon, он передаст её туда. Никуда ничего не уходит, пока кнопку не нажали.",
      handoverTitle: function (n) {
        return pluralRu(n, "1 позиция на покупку", n + " позиции на покупку", n + " позиций на покупку");
      },
      handoverLine: function (titles, more) {
        return titles.join(", ") + (more ? " и ещё " + more + "." : ".");
      }
    }
  };

  function sh() { return SHOPPING_TEXT[uiLang] || SHOPPING_TEXT.en; }

  var shopping = loadShopping();
  var editingShopId = null;

  function loadShopping() {
    try {
      var raw = localStorage.getItem(SHOPPING_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      showError("Couldn't read your shopping list");
      return [];
    }
  }

  function saveShopping(list) {
    try {
      localStorage.setItem(SHOPPING_KEY, JSON.stringify(list));
      hideError();
      scheduleSync();
      return true;
    } catch (e) {
      showError("Couldn't save — this browser's storage is full");
      return false;
    }
  }

  // This list is the one place in the app where something one person typed
  // becomes a link on somebody else's phone, so only an ordinary web address
  // is ever allowed through. A pasted "javascript:" would otherwise be one
  // tap away, and it would be a tap the other person had no reason to distrust.
  function safeLink(raw) {
    var text = cleanText(raw, MAX_SHOP_LINK);
    if (!text) return "";
    return /^https?:\/\/\S+$/i.test(text) ? text : "";
  }

  // A bare YYYY-MM-DD, and nothing that merely looks like one — a native
  // date input can only ever hand back this shape, but an incoming sync or
  // a pasted backup gets no such guarantee.
  function safeEtaDate(raw) {
    var text = String(raw || "").trim();
    if (!SHOP_ETA_RE.test(text)) return "";
    return isNaN(new Date(text + "T00:00:00").getTime()) ? "" : text;
  }

  // Anything arriving from another phone or a file, made safe to store.
  function normaliseShopItem(raw) {
    if (!raw || typeof raw !== "object") return null;
    var id = String(raw.id || "").trim().replace(/[^A-Za-z0-9_-]/g, "");
    if (!id) return null;
    var item = { id: id, title: cleanText(raw.title, MAX_SHOP_TITLE) };
    var link = safeLink(raw.link);
    if (link) item.link = link;
    if (raw.done) item.done = true;
    if (raw.deleted) item.deleted = true;
    // A live item needs a name or a link to be worth keeping — either is
    // enough on its own. A tombstone has neither, by design.
    if (!item.title && !item.link && !item.deleted) return null;
    var added = new Date(String(raw.addedAt || "").trim().replace(" ", "T"));
    var stamped = new Date(String(raw.updatedAt || "").trim().replace(" ", "T"));
    item.updatedAt = isNaN(stamped.getTime()) ? new Date().toISOString() : stamped.toISOString();
    item.addedAt = isNaN(added.getTime()) ? item.updatedAt : added.toISOString();
    if (item.done) {
      var ticked = new Date(String(raw.doneAt || "").trim().replace(" ", "T"));
      item.doneAt = isNaN(ticked.getTime()) ? item.updatedAt : ticked.toISOString();
    }
    // Absent or unrecognised reads as "new" — the same thing an item added
    // before this existed should read as.
    item.status = SHOP_STATUSES.indexOf(String(raw.status)) >= 0 ? String(raw.status) : "new";
    // Only kept alongside "ordered" — see the comment on SHOP_ETA_RE.
    if (item.status === "ordered") {
      var eta = safeEtaDate(raw.eta);
      if (eta) item.eta = eta;
    }
    return item;
  }

  // Read this way everywhere rather than trusting item.status to be set,
  // because loadShopping() hands back whatever was written before this
  // existed without normalising it.
  function shopStatusOf(item) {
    return SHOP_STATUSES.indexOf(item.status) >= 0 ? item.status : "new";
  }

  function nextShopStatus(status) {
    var i = SHOP_STATUSES.indexOf(status);
    return SHOP_STATUSES[(i + 1) % SHOP_STATUSES.length];
  }

  // A link with nothing typed is shown as the link itself, stripped of the
  // part that says nothing — "amazon.co.uk/dp/…" rather than
  // "https://www.amazon.co.uk/dp/…" — until somebody renames it.
  function shopTitleText(item) {
    if (item.title) return item.title;
    return String(item.link || "").replace(/^https?:\/\/(www\.)?/i, "");
  }

  function liveShopping() {
    return shopping.filter(function (item) { return !isDeleted(item); });
  }

  // Oldest first: a list where the thing somebody forgot sinks to the bottom
  // is a list that forgets it again.
  function outstandingShopping() {
    return liveShopping().filter(function (item) { return !item.done; })
      .sort(function (a, b) { return a.addedAt > b.addedAt ? 1 : -1; });
  }

  function boughtShopping() {
    var now = Date.now();
    return liveShopping().filter(function (item) {
      return item.done && now - +new Date(item.doneAt || item.updatedAt) < SHOP_DONE_LINGER;
    }).sort(function (a, b) { return a.doneAt > b.doneAt ? -1 : 1; });
  }

  // A bought item stays in view for a day so a mis-tap can be undone, then it
  // is retired as a tombstone rather than merely hidden — otherwise every
  // phone keeps a growing list of things bought last month and hands them
  // back to each other forever. Both phones work the rule out from the same
  // two fields, so they agree on it without discussing it.
  function retireBoughtShopping() {
    var now = Date.now();
    var changed = 0;
    shopping.forEach(function (item) {
      if (isDeleted(item) || !item.done) return;
      if (now - +new Date(item.doneAt || item.updatedAt) < SHOP_DONE_LINGER) return;
      item.title = "";
      delete item.link;
      delete item.done;
      delete item.doneAt;
      delete item.status;
      delete item.eta;
      item.deleted = true;
      touch(item);
      changed++;
    });
    return changed;
  }

  function pruneShopTombstones() {
    var before = shopping.length;
    shopping = shopping.filter(function (item) { return !tombstoneExpired(item); });
    return before - shopping.length;
  }

  function mergeShopping(remoteList) {
    var byId = {};
    shopping.forEach(function (item) { byId[item.id] = item; });
    var changed = 0;
    (remoteList || []).forEach(function (raw) {
      var item = normaliseShopItem(raw);
      if (!item || !item.id) return;
      if (tombstoneExpired(item)) return;
      var existing = byId[item.id];
      if (!existing) {
        shopping.push(item);
        byId[item.id] = item;
        changed++;
      } else if (item.updatedAt > updatedAtOf(existing)) {
        shopping[shopping.indexOf(existing)] = item;
        byId[item.id] = item;
        changed++;
      }
    });
    return changed;
  }

  function remoteMissesOurShopping(remoteList) {
    var remoteById = {};
    (remoteList || []).forEach(function (item) {
      if (item && item.id) remoteById[item.id] = item;
    });
    return shopping.some(function (item) {
      var mirror = remoteById[item.id];
      return !mirror || updatedAtOf(item) > (mirror.updatedAt || "");
    });
  }

  // Where a tap on the trolley goes. A link the phone recognises is handed to
  // whichever app claims that address by the phone itself — nothing here
  // arranges that, and nothing here is sent until somebody taps.
  function shopLinkFor(item) {
    if (item.link) return item.link;
    return AMAZON_SEARCH + encodeURIComponent(item.title);
  }

  function addShopItem(title, link) {
    var item = {
      id: uuid(), title: cleanText(title, MAX_SHOP_TITLE), status: "new",
      addedAt: new Date().toISOString()
    };
    if (link) item.link = link;
    touch(item);
    shopping.push(item);
    if (!saveShopping(shopping)) return null;
    renderShopping();
    return item.id;
  }

  function setShopStatus(id, status) {
    var target = shopping.filter(function (item) { return item.id === id; })[0];
    if (!target) return;
    target.status = status;
    // Only "ordered" has an expected-arrival date to lose — moving off it
    // (arrived, or a mis-tap wrapping back to new) drops any date already
    // set, so a later re-order does not inherit a stale one.
    if (status !== "ordered") delete target.eta;
    touch(target);
    if (!saveShopping(shopping)) return;
    renderShopping();
  }

  function setShopEta(id, value) {
    var target = shopping.filter(function (item) { return item.id === id; })[0];
    if (!target || shopStatusOf(target) !== "ordered") return;
    var eta = safeEtaDate(value);
    if (eta) target.eta = eta; else delete target.eta;
    touch(target);
    if (!saveShopping(shopping)) return;
    renderShopping();
  }

  // Calendar-day difference, not epoch arithmetic — the same reason the
  // rota and the immunisation dates work this way. Adding milliseconds
  // across a clock change is how an ETA would read a day early or late.
  function shopEtaDays(dateStr) {
    var parts = String(dateStr || "").split("-");
    if (parts.length !== 3) return null;
    var at = new Date(+parts[0], +parts[1] - 1, +parts[2]);
    if (isNaN(at.getTime())) return null;
    var midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    return Math.round((+at - +midnight) / MS_DAY);
  }

  function setShopDone(id, done) {
    var target = shopping.filter(function (item) { return item.id === id; })[0];
    if (!target) return;
    if (done) {
      target.done = true;
      target.doneAt = new Date().toISOString();
    } else {
      delete target.done;
      delete target.doneAt;
    }
    touch(target);
    if (!saveShopping(shopping)) return;
    renderShopping();
  }

  function deleteShopItem(id) {
    var target = shopping.filter(function (item) { return item.id === id; })[0];
    if (!target) return;
    var carried = {
      title: target.title, link: target.link, done: target.done, doneAt: target.doneAt,
      status: target.status, eta: target.eta
    };
    target.title = "";
    delete target.link;
    delete target.done;
    delete target.doneAt;
    delete target.status;
    delete target.eta;
    target.deleted = true;
    touch(target);
    if (!saveShopping(shopping)) return;
    renderShopping();
    var T = sh();
    showToast(T.removed, function () {
      delete target.deleted;
      target.title = carried.title;
      if (carried.link) target.link = carried.link;
      if (carried.done) {
        target.done = true;
        target.doneAt = carried.doneAt;
      }
      target.status = carried.status || "new";
      if (carried.eta && target.status === "ordered") target.eta = carried.eta;
      touch(target);
      if (!saveShopping(shopping)) return;
      renderShopping();
    });
  }

  function startShopEdit(id) {
    var target = liveShopping().filter(function (item) { return item.id === id; })[0];
    if (!target) return;
    editingShopId = id;
    el.shopWhat.value = target.title;
    el.shopLink.value = target.link || "";
    renderShopForm();
    el.shopWhat.focus();
  }

  function cancelShopEdit() {
    editingShopId = null;
    el.shopWhat.value = "";
    el.shopLink.value = "";
    renderShopForm();
  }

  function renderShopForm() {
    var T = sh();
    el.shopWhatLabel.textContent = T.whatLabel;
    el.shopLinkLabel.innerHTML = escapeHtml(T.linkLabel) + ' <span class="manual-optional">' +
      escapeHtml(T.linkOptional) + '</span>';
    el.shopSubmit.textContent = editingShopId ? T.save : T.add;
    el.shopCancel.textContent = T.cancel;
    el.shopCancel.hidden = !editingShopId;
  }

  function submitShopForm() {
    var T = sh();
    var title = cleanText(el.shopWhat.value, MAX_SHOP_TITLE);
    var typed = cleanText(el.shopLink.value, MAX_SHOP_LINK);
    var link = safeLink(typed);
    if (typed && !link) {
      showError(T.badLink);
      el.shopLink.focus();
      return;
    }
    // Either box is enough on its own — a link with nothing typed still
    // names something, shown as the link itself until somebody renames it.
    if (!title && !link) {
      showError(T.needText);
      el.shopWhat.focus();
      return;
    }
    hideError();
    if (editingShopId) {
      var target = shopping.filter(function (item) { return item.id === editingShopId; })[0];
      if (target) {
        target.title = title;
        if (link) target.link = link; else delete target.link;
        touch(target);
        if (!saveShopping(shopping)) return;
      }
      cancelShopEdit();
      renderShopping();
      showToast(T.updated);
      return;
    }
    if (!addShopItem(title, link)) return;
    el.shopWhat.value = "";
    el.shopLink.value = "";
    el.shopWhat.focus();
    showToast(T.added);
  }

  function shopRow(item) {
    var T = sh();
    var row = document.createElement("div");
    row.className = "shop-item" + (item.done ? " is-done" : "");

    var tick = document.createElement("button");
    tick.type = "button";
    tick.className = "shop-tick";
    tick.textContent = item.done ? "☑" : "☐";
    tick.setAttribute("aria-label", item.done ? T.markNotBought : T.markBought);
    tick.setAttribute("aria-pressed", item.done ? "true" : "false");
    tick.addEventListener("click", function () { setShopDone(item.id, !item.done); });

    // A column of its own so the tappable "edit" area (a <button>, below) and
    // the link (an <a>, which a button cannot legally contain) can sit one
    // above the other without one being nested inside the other.
    var content = document.createElement("div");
    content.className = "shop-content";

    var body = document.createElement("button");
    body.type = "button";
    body.className = "shop-body";
    body.setAttribute("aria-label", T.edit);
    var title = document.createElement("div");
    title.className = "shop-title" + (item.title ? "" : " is-link-only");
    title.textContent = shopTitleText(item);
    var when = document.createElement("div");
    when.className = "shop-when";
    when.textContent = item.done
      ? T.boughtAgo(uiDuration(Date.now() - +new Date(item.doneAt || item.updatedAt)))
      : T.addedAgo(uiDuration(Date.now() - +new Date(item.addedAt || item.updatedAt)));
    body.appendChild(title);
    body.appendChild(when);
    body.addEventListener("click", function () { startShopEdit(item.id); });
    content.appendChild(body);

    var actions = document.createElement("div");
    actions.className = "shop-actions";

    // Before it is bought, one tap moves it on to the next stage; once
    // bought, the journey is over and the pill would say nothing useful.
    if (!item.done) {
      var status = shopStatusOf(item);
      var pill = document.createElement("button");
      pill.type = "button";
      pill.className = "shop-status st-" + status;
      pill.textContent = T.statusLabel[status];
      pill.setAttribute("aria-label", T.statusNext[status]);
      pill.addEventListener("click", function () { setShopStatus(item.id, nextShopStatus(status)); });
      actions.appendChild(pill);

      // Only once ordered — an expected date means nothing before that,
      // and once it has arrived the pill already says so on its own.
      if (status === "ordered") {
        var etaInput = document.createElement("input");
        etaInput.type = "date";
        etaInput.className = "shop-eta";
        etaInput.setAttribute("aria-label", T.etaFieldLabel);
        etaInput.value = item.eta || "";
        etaInput.addEventListener("change", function () { setShopEta(item.id, etaInput.value); });
        actions.appendChild(etaInput);

        if (item.eta) {
          var etaNote = document.createElement("span");
          etaNote.className = "shop-eta-note";
          etaNote.textContent = T.etaLabel(shopEtaDays(item.eta));
          actions.appendChild(etaNote);
        }
      }
    }

    // A real anchor rather than a scripted open, so the phone treats it as an
    // ordinary link and hands it to whichever app claims that address.
    var open = document.createElement("a");
    open.className = "shop-open";
    open.href = shopLinkFor(item);
    open.target = "_blank";
    open.rel = "noopener noreferrer";
    open.textContent = item.link ? T.openLink : T.searchAmazon;
    actions.appendChild(open);
    content.appendChild(actions);

    var remove = document.createElement("button");
    remove.type = "button";
    remove.className = "shop-delete";
    remove.textContent = "✕";
    remove.setAttribute("aria-label", T.remove);
    remove.addEventListener("click", function () { deleteShopItem(item.id); });

    row.appendChild(tick);
    row.appendChild(content);
    row.appendChild(remove);
    return row;
  }

  function renderShopList() {
    var T = sh();
    el.shopList.innerHTML = "";
    var waiting = outstandingShopping();
    var done = boughtShopping();
    if (!waiting.length && !done.length) {
      var empty = document.createElement("div");
      empty.className = "log-empty";
      empty.textContent = T.empty;
      el.shopList.appendChild(empty);
      return;
    }
    [[T.toBuy, waiting], [T.bought, done]].forEach(function (pair) {
      if (!pair[1].length) return;
      var heading = document.createElement("div");
      heading.className = "shop-heading";
      heading.textContent = pair[0];
      el.shopList.appendChild(heading);
      pair[1].forEach(function (item) { el.shopList.appendChild(shopRow(item)); });
    });
  }

  function applyShopChrome() {
    var T = sh();
    el.shopTitle.textContent = T.screenTitle;
    el.shopBack.setAttribute("aria-label", T.back);
    el.shopOpenBtn.setAttribute("aria-label", T.screenTitle);
    el.shopLangLabel.textContent = T.langLabel;
    el.shopQuiet.textContent = T.quiet;
    el.shopAmazonNote.textContent = T.amazonNote;
  }

  // A small count on the top-bar icon, so the list is visible without opening
  // it — the only way this app can hint that something needs doing, having no
  // server to send a real notification from.
  function renderShopBadge() {
    var n = outstandingShopping().length;
    el.shopBadge.textContent = sh().badge(n);
    el.shopBadge.hidden = n === 0;
  }

  function renderShopping() {
    renderShopBadge();
    if (el.screenShop.hidden) return;
    applyShopChrome();
    markLangChips(el.shopLangs);
    renderShopForm();
    renderShopList();
  }

  // Read out on the handover screen: three names is a glance, and the count
  // covers whatever does not fit.
  var HANDOVER_SHOP_NAMES = 3;
  function handoverShopRow() {
    var waiting = outstandingShopping();
    if (!waiting.length) return null;
    var T = sh();
    var shown = waiting.slice(0, HANDOVER_SHOP_NAMES).map(function (item) { return item.title; });
    var more = waiting.length - shown.length;
    return { icon: "🛒", title: T.handoverTitle(waiting.length),
      details: [T.handoverLine(shown, more)] };
  }

  el.shopOpenBtn.addEventListener("click", function () {
    showScreen("shop");
    cancelShopEdit();
    renderShopping();
  });
  el.shopBack.addEventListener("click", showMain);
  el.shopSubmit.addEventListener("click", submitShopForm);
  el.shopCancel.addEventListener("click", cancelShopEdit);
  [el.shopWhat, el.shopLink].forEach(function (input) {
    input.addEventListener("keydown", function (ev) {
      if (ev.key !== "Enter") return;
      ev.preventDefault();
      submitShopForm();
    });
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
      "a midwife, health visitor or doctor rather than guessing at it.\n\n" +
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
    var days = ageDaysAt(now);
    el.topDate.textContent = formatDateShort(now) +
      (days !== null && days >= 0 ? " · " + formatAge(days) : "");
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
    renderShopBadge();
    renderRotaBanner();
    // Only while it is being looked at: it reads the whole log, and nobody is
    // served by rebuilding it behind a screen nobody is on.
    if (!el.screenHandover.hidden) renderHandover();
    if (!el.screenShop.hidden) renderShopping();
    // The calendar only, not the day editor above it — that one holds
    // focused selects and time inputs mid-edit, and a periodic rebuild
    // would drop whatever was half-chosen.
    if (!el.screenRota.hidden) renderRotaWeek();
    if (withLog) renderLog();
  }

  function tick() {
    // The log shows fixed clock times, so it only needs rebuilding when the
    // date rolls over or a running sleep keeps growing today's total.
    var needLog = logOpen && (dayKeyOf(new Date()) !== lastLogDayKey || isSleepingNow());
    renderAll({ log: needLog });
  }

  renderVersion();
  buildHandoverChips();
  applyHandoverChrome();
  buildLangChips(el.shopLangs);
  applyShopChrome();
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
