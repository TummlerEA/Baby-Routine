(function () {
  "use strict";

  var EVENTS_KEY = "baby-tracker-events";
  var NAME_KEY = "baby-tracker-name";
  var INTERVALS_KEY = "baby-tracker-intervals";
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
  var CHIP_CHOICES = [120, 180, 240, 300, 360, 480];
  var KINDS = ["feed", "diaper", "sleep"];
  var KIND_META = {
    feed: { label: "Feed", icon: "🍼", logged: "Feed logged" },
    diaper: { label: "Nappy", icon: "🧷", logged: "Nappy logged" },
    sleep: { label: "Sleep", icon: "🌙", logged: "Sleep logged" }
  };
  var NEXTUP_TIMEOUT = 20000;
  // Only flag the gap between plan and reality once it is worth mentioning.
  var DRIFT_TOLERANCE = 0.25;

  var TYPE_META = {
    feed: { label: "Feed", icon: "🍼" },
    diaper: { label: "Nappy", icon: "🧷" },
    sleep_start: { label: "Fell asleep", icon: "🌙" },
    sleep_end: { label: "Woke up", icon: "☀️" }
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
    btnFeed: document.getElementById("btnFeed"),
    btnDiaper: document.getElementById("btnDiaper"),
    btnSleep: document.getElementById("btnSleep"),
    sleepLabel: document.getElementById("sleepLabel"),
    forecastList: document.getElementById("forecastList"),
    nextUp: document.getElementById("nextUp"),
    nextUpTitle: document.getElementById("nextUpTitle"),
    nextUpLine: document.getElementById("nextUpLine"),
    nextUpChips: document.getElementById("nextUpChips"),
    nextUpClose: document.getElementById("nextUpClose"),
    settingsToggle: document.getElementById("settingsToggle"),
    settingsToggleText: document.getElementById("settingsToggleText"),
    settingsPanel: document.getElementById("settingsPanel"),
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
    dataToggle: document.getElementById("dataToggle"),
    dataToggleText: document.getElementById("dataToggleText"),
    dataPanel: document.getElementById("dataPanel"),
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
  var settingsOpen = false;
  var dataOpen = false;
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
    group.events.forEach(function (e) {
      if (e.type === "feed") feeds++;
      if (e.type === "diaper") diapers++;
    });
    var dayStart = new Date(group.date);
    dayStart.setHours(0, 0, 0, 0);
    var sleepMs = sleepMsInRange(analysis, +dayStart, +dayStart + MS_DAY, Date.now());
    return "🍼 " + feeds + " · 🧷 " + diapers + " · 🌙 " + (sleepMs ? formatDuration(sleepMs) : "0m");
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

  function resetManualForm() {
    editingId = null;
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
    el.manualDateTime.value = toDateTimeLocalValue(new Date(found.time));
    el.manualSubmit.textContent = "Save";
    el.manualCancel.hidden = false;
    hideManualNotice();
    el.manualPanel.scrollIntoView({ behavior: "smooth", block: "center" });
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

    hideManualNotice();
    var savedId;

    if (editingId) {
      var target = events.filter(function (e) { return e.id === editingId; })[0];
      if (!target) {
        resetManualForm();
        return;
      }
      target.type = type;
      target.time = picked.toISOString();
      savedId = editingId;
      if (!saveEvents(events)) return;
      resetManualForm();
      renderAll();
      showToast("Entry updated");
    } else {
      savedId = addEvent(type, picked.toISOString());
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

  el.settingsToggle.addEventListener("click", function () {
    settingsOpen = !settingsOpen;
    el.settingsPanel.hidden = !settingsOpen;
    el.settingsToggleText.textContent = settingsOpen ? "Hide planned intervals" : "Planned intervals";
  });

  // ---------- actions ----------

  function addEvent(type, isoTime) {
    var event = { id: uuid(), type: type, time: isoTime || new Date().toISOString() };
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
    var rows = [["id", "type", "label", "time_local", "time_iso", "duration_min", "next_interval_min"]];
    sortedByTimeDesc(events).forEach(function (e) {
      var duration = analysis.durationById[e.id];
      rows.push([
        e.id,
        e.type,
        eventTypeLabel(e.type),
        formatDateTimeLocal(new Date(e.time)),
        e.time,
        duration ? Math.round(duration / MS_MIN) : "",
        customMinutesOf(e) || ""
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
    var timeCol = iIso >= 0 ? iIso : (iTime >= 0 ? iTime : iLocal);
    if (iType < 0 || timeCol < 0) return null;

    var out = [];
    for (var i = 1; i < lines.length; i++) {
      var cells = parseCsvLine(lines[i], delim);
      out.push({
        id: iId >= 0 ? cells[iId] : "",
        type: (cells[iType] || "").trim(),
        time: (cells[timeCol] || "").trim(),
        nextMin: iNext >= 0 ? cells[iNext] : ""
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
    if (parsed.name && !loadName().trim()) {
      saveName(String(parsed.name));
      el.babyName.value = String(parsed.name);
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
      if (!id) id = uuid();
      if (seenIds[id] || seenKeys[raw.type + "|" + iso]) {
        skipped++;
        return;
      }
      seenIds[id] = true;
      seenKeys[raw.type + "|" + iso] = true;
      var entry = { id: id, type: raw.type, time: iso };
      var nextMin = Number(raw.nextMin);
      if (nextMin > 0 && nextMin <= 24 * 60) entry.nextMin = Math.round(nextMin);
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

  el.dataToggle.addEventListener("click", function () {
    dataOpen = !dataOpen;
    el.dataPanel.hidden = !dataOpen;
    el.dataToggleText.textContent = dataOpen ? "Hide export & backup" : "Export & backup";
  });

  // ---------- name ----------

  el.babyName.value = loadName();
  el.babyName.addEventListener("input", function () {
    saveName(el.babyName.value);
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
    renderSleepBanner();
    renderSleepButton();
    renderForecast();
    if (withLog) renderLog();
  }

  function tick() {
    // The log shows fixed clock times, so it only needs rebuilding when the
    // date rolls over or a running sleep keeps growing today's total.
    var needLog = logOpen && (dayKeyOf(new Date()) !== lastLogDayKey || isSleepingNow());
    renderAll({ log: needLog });
  }

  buildIntervalOptions();
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
