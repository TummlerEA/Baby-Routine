(function () {
  "use strict";

  var EVENTS_KEY = "baby-tracker-events";
  var NAME_KEY = "baby-tracker-name";
  var INTERVALS_KEY = "baby-tracker-intervals";
  var DOB_KEY = "baby-tracker-dob";
  var MS_MIN = 60 * 1000;
  var MS_HOUR = 60 * MS_MIN;
  var MS_DAY = 24 * MS_HOUR;

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
  var NEXTUP_TIMEOUT = 20000;
  // Only flag the gap between plan and reality once it is worth mentioning.
  var DRIFT_TOLERANCE = 0.25;

  // Measurements are ordinary events with a numeric value. They deliberately
  // stay out of KINDS: predicting "next weight in 3h" would be nonsense.
  var MEASURES = {
    weight: { label: "Weight", icon: "⚖️", unit: "g",  step: "10",  max: 30000, decimals: 0 },
    height: { label: "Length", icon: "📏", unit: "cm", step: "0.5", max: 150,   decimals: 1 },
    temp:   { label: "Temperature", icon: "🌡", unit: "°C", step: "0.1", max: 45, decimals: 1 }
  };
  var MEASURE_ORDER = ["weight", "height", "temp"];

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
    temp: { label: "Temperature", icon: "🌡" }
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
      hideError();
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
      hideError();
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

  function saveDob(value) {
    try {
      if (value) localStorage.setItem(DOB_KEY, value);
      else localStorage.removeItem(DOB_KEY);
      hideError();
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

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  var events = loadEvents();
  var intervals = loadIntervals();

  // ---------- dom ----------

  var el = {
    topDate: document.getElementById("topDate"),
    topClock: document.getElementById("topClock"),
    babyName: document.getElementById("babyName"),
    errorBanner: document.getElementById("errorBanner"),
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
    babyDob: document.getElementById("babyDob"),
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
    nappyBlock: document.getElementById("nappyBlock"),
    nappyChips: document.getElementById("nappyChips"),
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
    infoToggle: document.getElementById("infoToggle"),
    infoToggleText: document.getElementById("infoToggleText"),
    infoPanel: document.getElementById("infoPanel"),
    screenMain: document.getElementById("screenMain"),
    screenSettings: document.getElementById("screenSettings"),
    settingsOpenBtn: document.getElementById("settingsOpen"),
    settingsBack: document.getElementById("settingsBack"),
    babyNameDisplay: document.getElementById("babyNameDisplay"),
    exportCsv: document.getElementById("exportCsv"),
    exportMd: document.getElementById("exportMd"),
    exportJson: document.getElementById("exportJson"),
    importBtn: document.getElementById("importBtn"),
    importFile: document.getElementById("importFile"),
    toast: document.getElementById("toast"),
    toastText: document.getElementById("toastText"),
    toastAction: document.getElementById("toastAction")
  };

  var logOpen = false;
  var manualOpen = false;
  var infoOpen = false;
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
    el.errorBanner.textContent = msg;
    el.errorBanner.hidden = false;
  }

  function hideError() {
    el.errorBanner.hidden = true;
  }

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

  function formatMeasure(type, value) {
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

  function measureValueOf(event) {
    if (!event || !MEASURES[event.type]) return null;
    var value = Number(event.value);
    return (isFinite(value) && value > 0) ? value : null;
  }

  function measurementsOf(type) {
    return sortedByTimeAsc(events.filter(function (e) {
      return e.type === type && measureValueOf(e) !== null;
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
    var asc = sortedByTimeAsc(events.filter(function (e) {
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
      ? events.filter(function (e) { return e.type === "sleep_start"; })
      : events.filter(function (e) { return e.type === kind; });
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
    var text = formatMeasure(event.type, value);
    if (event.type === "weight") text += " · " + formatImperial(value);
    return text;
  }

  function signed(delta, digits, unit) {
    var rounded = Number(delta.toFixed(digits));
    var sign = rounded > 0 ? "+" : "";
    return sign + rounded.toFixed(digits) + unit;
  }

  function renderMeasureCards() {
    el.measureCards.innerHTML = "";
    MEASURE_ORDER.forEach(function (type) {
      var meta = MEASURES[type];
      var list = measurementsOf(type);
      var card = document.createElement("div");
      card.className = "measure-card" + (list.length ? "" : " is-empty");

      if (!list.length) {
        card.innerHTML =
          '<span class="m-icon">' + meta.icon + '</span>' +
          '<div class="m-body">' +
            '<div class="m-label">' + meta.label + '</div>' +
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
        var digits = type === "weight" ? 0 : 1;
        var unit = type === "weight" ? " g" : " " + meta.unit;
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
          '<div class="m-label">' + meta.label + '</div>' +
          '<div class="m-value">' + escapeHtml(measureLine(latest)) + '</div>' +
          '<div class="m-sub">' + subParts.join(" · ") + '</div>' +
        '</div>';
      el.measureCards.appendChild(card);
    });
  }

  function renderMeasurements() {
    el.measureToggleText.textContent = measureOpen ? "Hide measurements" : "Measurements";
    el.measurePanel.hidden = !measureOpen;
    if (measureOpen) renderMeasureCards();
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
    var diapers = 0;
    var wet = 0;
    var dirty = 0;
    group.events.forEach(function (e) {
      if (e.type === "feed") feeds++;
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
    return "🍼 " + feeds + " · " + nappies + " · 🌙 " + (sleepMs ? formatDuration(sleepMs) : "0m");
  }

  function isDayExpanded(key, index) {
    return Object.prototype.hasOwnProperty.call(expandedDays, key)
      ? expandedDays[key]
      : index < DEFAULT_EXPANDED_DAYS;
  }

  function renderLog() {
    el.logToggleText.textContent =
      (logOpen ? "Hide history" : "Show history") + " (" + events.length + ")";
    el.logList.hidden = !logOpen;
    if (!logOpen) return;

    lastLogDayKey = dayKeyOf(new Date());
    el.logList.innerHTML = "";

    if (!events.length) {
      var empty = document.createElement("div");
      empty.className = "log-empty";
      empty.textContent = "No entries yet";
      el.logList.appendChild(empty);
      return;
    }

    var analysis = analyzeSleep();
    var groups = groupByDay(sortedByTimeDesc(events));

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
              (nappyOf(e) ? '<div class="l-detail">' + NAPPY_TYPES[e.nappy].detail + '</div>' : '') +
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
    var removed = null;
    events = events.filter(function (e) {
      if (e.id === id) {
        removed = e;
        return false;
      }
      return true;
    });
    if (!removed) return;
    if (!saveEvents(events)) return;
    if (editingId === id) resetManualForm();
    renderAll();
    showToast("Entry deleted", function () {
      events.push(removed);
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

  function syncManualValueField() {
    var meta = MEASURES[el.manualType.value];
    el.manualValueField.hidden = !meta;
    if (!meta) {
      el.manualValue.value = "";
      el.manualValueEcho.textContent = "";
      return;
    }
    el.manualValueLabel.textContent = meta.label + " in " + meta.unit;
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

  function syncManualFields() {
    syncManualNappyField();
    syncManualValueField();
  }

  el.manualType.addEventListener("change", syncManualFields);

  function resetManualForm() {
    editingId = null;
    el.manualNappy.value = "";
    el.manualValue.value = "";
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
    el.manualNappy.value = nappyOf(found) || "";
    el.manualValue.value = measureValueOf(found) === null ? "" : String(found.value);
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
    if (measureMeta) {
      measureValue = Number(el.manualValue.value);
      if (!el.manualValue.value || !isFinite(measureValue) || measureValue <= 0) {
        showManualNotice("Enter a " + measureMeta.label.toLowerCase() + " in " + measureMeta.unit);
        return;
      }
      if (measureValue > measureMeta.max) {
        showManualNotice("That looks too high for a " + measureMeta.label.toLowerCase() + " in " + measureMeta.unit);
        return;
      }
    }

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
      if (measureMeta) target.value = measureValue;
      else delete target.value;
      savedId = editingId;
      if (!saveEvents(events)) return;
      resetManualForm();
      renderAll();
      showToast("Entry updated");
    } else {
      savedId = addEvent(type, picked.toISOString(),
        type === "diaper" ? el.manualNappy.value : "", measureValue);
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

  el.nappyChips.addEventListener("click", function (ev) {
    var chip = ev.target.closest(".nappy-chip");
    if (!chip) return;
    var event = events.filter(function (e) { return e.id === nextUpEventId; })[0];
    if (!event) return;

    var key = chip.getAttribute("data-nappy");
    // Tapping the same answer again clears it, so a mis-tap is undoable.
    if (nappyOf(event) === key) delete event.nappy;
    else event.nappy = key;

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

  function addEvent(type, isoTime, nappy, value) {
    var event = { id: uuid(), type: type, time: isoTime || new Date().toISOString() };
    if (NAPPY_TYPES[nappy]) event.nappy = nappy;
    if (MEASURES[type] && isFinite(value) && value > 0) event.value = value;
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
    var rows = [["id", "type", "label", "time_local", "time_iso", "duration_min", "next_interval_min", "nappy", "value"]];
    sortedByTimeDesc(events).forEach(function (e) {
      var duration = analysis.durationById[e.id];
      rows.push([
        e.id,
        e.type,
        eventTypeLabel(e.type),
        formatDateTimeLocal(new Date(e.time)),
        e.time,
        duration ? Math.round(duration / MS_MIN) : "",
        customMinutesOf(e) || "",
        nappyOf(e) || "",
        measureValueOf(e) === null ? "" : e.value
      ]);
    });
    return rows.map(function (r) { return r.map(csvEscape).join(","); }).join("\r\n");
  }

  function buildMarkdown() {
    var analysis = analyzeSleep();
    var name = loadName().trim() || "Baby";
    var groups = groupByDay(sortedByTimeDesc(events));
    var out = [];

    out.push("# " + name + " — log");
    out.push("");
    out.push("Exported: " + formatDateTimeLocal(new Date()) + "  ");
    out.push("Entries: " + events.length);
    out.push("");

    groups.forEach(function (group) {
      out.push("## " + formatDateHeader(group.date));
      out.push("");
      out.push(daySummary(group, analysis));
      out.push("");
      out.push("| Time | Event | Duration |");
      out.push("| --- | --- | --- |");
      sortedByTimeAsc(group.events).forEach(function (e) {
        var duration = analysis.durationById[e.id];
        out.push("| " + formatClockTime(new Date(e.time)) +
          " | " + eventTypeIcon(e.type) + " " + eventTypeLabel(e.type) +
          (nappyOf(e) ? " (" + NAPPY_TYPES[e.nappy].label.toLowerCase() + ")" : "") +
          (measureValueOf(e) !== null ? " — " + measureLine(e) : "") +
          " | " + (duration ? formatDuration(duration) : "—") + " |");
      });
      out.push("");
    });

    return out.join("\n");
  }

  function guardEmpty() {
    if (events.length) return false;
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
      intervals: intervals,
      events: sortedByTimeDesc(events)
    }, null, 2);
    if (downloadFile(exportBaseName() + ".json", payload, "application/json;charset=utf-8")) {
      showToast("Backup saved");
    }
  });

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
        value: iValue >= 0 ? (cells[iValue] || "").trim() : ""
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

  function applyBackupSettings(text) {
    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return;
    }
    if (!parsed || Array.isArray(parsed)) return;

    if (parsed.intervals) {
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
    // Only fill in a name when there isn't one, so restoring a file never
    // quietly renames a baby that already has one.
    if (parsed.dob && !loadDob()) {
      saveDob(String(parsed.dob));
      el.babyDob.value = loadDob();
      renderDobEcho();
    }
    if (parsed.name && !loadName().trim()) {
      saveName(String(parsed.name));
      el.babyName.value = String(parsed.name);
      renderName();
    }
  }

  function mergeImported(list) {
    var seenIds = {};
    var seenKeys = {};
    events.forEach(function (e) {
      seenIds[e.id] = true;
      seenKeys[e.type + "|" + e.time] = true;
    });

    var added = 0;
    var skipped = 0;
    var invalid = 0;

    list.forEach(function (raw) {
      if (!raw || !TYPE_META[raw.type]) {
        invalid++;
        return;
      }
      var parsedTime = new Date(String(raw.time || "").trim().replace(" ", "T"));
      if (isNaN(parsedTime.getTime())) {
        invalid++;
        return;
      }
      var iso = parsedTime.toISOString();
      // Ids arrive from a file, so keep only characters safe to put in markup.
      var id = String(raw.id || "").trim().replace(/[^A-Za-z0-9_-]/g, "");
      var contentKey = raw.type + "|" + iso;
      // An id is the trustworthy duplicate signal. Falling back to type+time
      // for entries that carry one would discard genuinely separate readings
      // taken in the same minute, since the form records minutes only.
      if (id) {
        if (seenIds[id]) {
          skipped++;
          return;
        }
      } else if (seenKeys[contentKey]) {
        skipped++;
        return;
      }
      if (!id) id = uuid();
      seenIds[id] = true;
      seenKeys[contentKey] = true;
      var entry = { id: id, type: raw.type, time: iso };
      var nextMin = Number(raw.nextMin);
      if (nextMin > 0 && nextMin <= 24 * 60) entry.nextMin = Math.round(nextMin);
      if (raw.type === "diaper" && NAPPY_TYPES[raw.nappy]) entry.nappy = raw.nappy;
      if (MEASURES[raw.type]) {
        var measured = Number(raw.value);
        if (!isFinite(measured) || measured <= 0) {
          invalid++;
          return;
        }
        entry.value = measured;
      }
      events.push(entry);
      added++;
    });

    if (added && !saveEvents(events)) return;

    renderAll();
    var msg = "Added " + added + (added === 1 ? " entry" : " entries");
    if (skipped) msg += ", " + skipped + " duplicate" + (skipped === 1 ? "" : "s") + " skipped";
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

  el.infoToggle.addEventListener("click", function () {
    infoOpen = !infoOpen;
    el.infoPanel.hidden = !infoOpen;
    el.infoToggleText.textContent = infoOpen ? "Hide guidance" : "For new parents";
  });

  // ---------- screens ----------

  function showSettings(focusName) {
    el.screenMain.hidden = true;
    el.screenSettings.hidden = false;
    window.scrollTo(0, 0);
    if (focusName) el.babyName.focus();
  }

  function showMain() {
    el.screenSettings.hidden = true;
    el.screenMain.hidden = false;
    window.scrollTo(0, 0);
  }

  el.settingsOpenBtn.addEventListener("click", function () { showSettings(false); });
  el.settingsBack.addEventListener("click", showMain);
  el.babyNameDisplay.addEventListener("click", function () { showSettings(true); });

  // ---------- name ----------

  function renderName() {
    var name = loadName().trim();
    el.babyNameDisplay.textContent = name || "Baby's name";
    el.babyNameDisplay.classList.toggle("is-empty", !name);
  }

  function renderDobEcho() {
    var days = ageDaysAt(new Date());
    el.babyDobEcho.textContent = days === null
      ? "Not set — the app will assume the strictest temperature threshold."
      : "Today: " + formatAge(days) + " old";
  }

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
    renderTempBanner();
    renderMeasurements();
    if (withLog) renderLog();
  }

  function tick() {
    // The log shows fixed clock times, so it only needs rebuilding when the
    // date rolls over or a running sleep keeps growing today's total.
    var needLog = logOpen && (dayKeyOf(new Date()) !== lastLogDayKey || isSleepingNow());
    renderAll({ log: needLog });
  }

  buildIntervalOptions();
  syncManualFields();
  renderDobEcho();
  renderAll();
  setInterval(tick, 30 * 1000);

  // iOS freezes timers in the background, so refresh the moment the app
  // comes back instead of showing stale numbers for up to half a minute.
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) renderAll();
  });
  window.addEventListener("focus", function () { renderAll(); });
  window.addEventListener("pageshow", function () { renderAll(); });
})();
