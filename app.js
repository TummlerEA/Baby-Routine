(function () {
  "use strict";

  var EVENTS_KEY = "baby-tracker-events";
  var NAME_KEY = "baby-tracker-name";
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

  var DEFAULTS = {
    feed: 2.5 * MS_HOUR,
    diaper: 2 * MS_HOUR,
    sleep: 1.5 * MS_HOUR
  };

  var TYPE_META = {
    feed: { label: "Кормление", icon: "🍼" },
    diaper: { label: "Подгузник", icon: "🧷" },
    sleep_start: { label: "Уснула", icon: "🌙" },
    sleep_end: { label: "Проснулась", icon: "☀️" }
  };

  var WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
  var MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

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
      showError("Не удалось сохранить данные");
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
      showError("Не удалось сохранить имя");
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
    if (h <= 0) return m + " мин";
    if (m === 0) return h + " ч";
    return h + " ч " + m + " мин";
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
    return date.getDate() + " " + MONTHS[date.getMonth()] + ", " + WEEKDAYS[date.getDay()];
  }

  // Same clock time, but says which day it lands on when that is not today.
  function formatWhen(date) {
    var now = new Date();
    var key = dayKeyOf(date);
    var time = formatClockTime(date);
    if (key === dayKeyOf(now)) return time;
    if (key === dayKeyOf(new Date(now.getTime() + MS_DAY))) return "завтра " + time;
    if (key === dayKeyOf(new Date(now.getTime() - MS_DAY))) return "вчера " + time;
    return date.getDate() + " " + MONTHS[date.getMonth()] + " " + time;
  }

  function dayLabel(date) {
    var now = new Date();
    var key = dayKeyOf(date);
    if (key === dayKeyOf(now)) return "Сегодня";
    if (key === dayKeyOf(new Date(now.getTime() - MS_DAY))) return "Вчера";
    return formatDateHeader(date);
  }

  function eventTypeLabel(type) {
    return TYPE_META[type] ? TYPE_META[type].label : type;
  }

  function eventTypeIcon(type) {
    return TYPE_META[type] ? TYPE_META[type].icon : "•";
  }

  // ---------- sleep pairing ----------

  // Walks sleep events in order and pairs each "уснула" with the "проснулась"
  // that follows it. Unpaired records are flagged so they can be spotted and
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
        if (open) warningById[open.id] = "Нет парной записи «Проснулась»";
        open = e;
      } else {
        if (!open) {
          warningById[e.id] = "Нет парной записи «Уснула»";
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

  function computeForecast(kind) {
    var filtered = kind === "sleep"
      ? events.filter(function (e) { return e.type === "sleep_start"; })
      : events.filter(function (e) { return e.type === kind; });
    var asc = sortedByTimeAsc(filtered);

    var intervals = [];
    for (var i = 1; i < asc.length; i++) {
      var gap = new Date(asc[i].time) - new Date(asc[i - 1].time);
      if (gap >= MIN_VALID_INTERVAL) intervals.push(gap);
    }

    var lastN = intervals.slice(-FORECAST_SAMPLE);
    var isEstimate = lastN.length === 0;
    // Median, not mean: one unusually long night gap should not drag the
    // whole prediction with it.
    var interval = isEstimate ? DEFAULTS[kind] : median(lastN);

    var lastEvent = asc.length ? asc[asc.length - 1] : null;
    var baseTime = lastEvent ? new Date(lastEvent.time) : new Date();

    return {
      hasData: !!lastEvent,
      isEstimate: isEstimate,
      nextTime: new Date(baseTime.getTime() + interval)
    };
  }

  function renderForecast() {
    var now = new Date();
    var items = [
      { kind: "feed", icon: "🍼", label: "Кормление" },
      { kind: "diaper", icon: "🧷", label: "Подгузник" },
      { kind: "sleep", icon: "🌙", label: "Сон" }
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
            '<div class="f-time">малышка сейчас спит</div>' +
          '</div>';
        el.forecastList.appendChild(div);
        return;
      }

      var f = computeForecast(item.kind);
      var diff = f.nextTime - now;
      var timeHtml;

      if (!f.hasData) {
        timeHtml = '<span class="f-time">через ' + formatDuration(diff) + '</span>' +
          ' <span class="f-estimate-tag">(оценка)</span>';
      } else {
        timeHtml = diff < 0
          ? '<span class="f-time overdue">просрочено на ' + formatDuration(-diff) + '</span>'
          : '<span class="f-time">через ' + formatDuration(diff) + '</span>';
        if (f.isEstimate) timeHtml += ' <span class="f-estimate-tag">(оценка)</span>';
      }

      div.innerHTML =
        '<span class="f-icon">' + item.icon + '</span>' +
        '<div class="f-body">' +
          '<div class="f-type">' + item.label + ' · ожидается ' + formatWhen(f.nextTime) + '</div>' +
          '<div>' + timeHtml + '</div>' +
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
    el.sleepLabel.textContent = sleeping ? "Проснулась" : "Уснула";
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
    return "🍼 " + feeds + " · 🧷 " + diapers + " · 🌙 " + (sleepMs ? formatDuration(sleepMs) : "0 мин");
  }

  function isDayExpanded(key, index) {
    return Object.prototype.hasOwnProperty.call(expandedDays, key)
      ? expandedDays[key]
      : index < DEFAULT_EXPANDED_DAYS;
  }

  function renderLog() {
    el.logToggleText.textContent =
      (logOpen ? "Скрыть журнал" : "Показать журнал") + " (" + events.length + ")";
    el.logList.hidden = !logOpen;
    if (!logOpen) return;

    lastLogDayKey = dayKeyOf(new Date());
    el.logList.innerHTML = "";

    if (!events.length) {
      var empty = document.createElement("div");
      empty.className = "log-empty";
      empty.textContent = "Записей пока нет";
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
              (duration ? '<div class="l-duration">сон ' + formatDuration(duration) + '</div>' : '') +
              (warning ? '<div class="l-warn">⚠ ' + escapeHtml(warning) + '</div>' : '') +
            '</div>' +
            '<button class="l-delete" data-id="' + escapeHtml(e.id) + '" aria-label="Удалить запись">✕</button>';
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
    showToast("Запись удалена", function () {
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
    el.manualToggleText.textContent = "Скрыть форму";
  }

  function resetManualForm() {
    editingId = null;
    el.manualTitle.textContent = "Новая запись";
    el.manualSubmit.textContent = "Добавить запись";
    el.manualCancel.hidden = true;
    el.manualDateTime.value = toDateTimeLocalValue(new Date());
    hideManualNotice();
  }

  function startEdit(id) {
    var found = events.filter(function (e) { return e.id === id; })[0];
    if (!found) return;
    editingId = id;
    openManualPanel();
    el.manualTitle.textContent = "Изменить запись";
    el.manualType.value = found.type;
    el.manualDateTime.value = toDateTimeLocalValue(new Date(found.time));
    el.manualSubmit.textContent = "Сохранить";
    el.manualCancel.hidden = false;
    hideManualNotice();
    el.manualPanel.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  el.manualDateTime.value = toDateTimeLocalValue(new Date());

  el.manualToggle.addEventListener("click", function () {
    manualOpen = !manualOpen;
    el.manualPanel.hidden = !manualOpen;
    el.manualToggleText.textContent = manualOpen ? "Скрыть форму" : "Добавить запись задним числом";
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
      showManualNotice("Укажите дату и время");
      return;
    }
    var picked = new Date(raw);
    if (isNaN(picked.getTime())) {
      showManualNotice("Некорректная дата и время");
      return;
    }
    if (picked.getTime() > Date.now() + MS_MIN) {
      showManualNotice("Нельзя добавить запись в будущем");
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
      showToast("Запись изменена");
    } else {
      savedId = addEvent(type, picked.toISOString());
      if (!savedId) return;
      el.manualDateTime.value = toDateTimeLocalValue(new Date());
      var original = el.manualSubmit.textContent;
      el.manualSubmit.textContent = "Добавлено ✓";
      setTimeout(function () {
        if (!editingId) el.manualSubmit.textContent = original;
      }, 900);
    }

    // Backfilling history one record at a time easily produces an "уснула"
    // with no matching "проснулась" — say so instead of silently flipping
    // the app into sleep mode.
    var warning = analyzeSleep().warningById[savedId];
    if (warning) showManualNotice(warning + ". Добавьте её, чтобы сон посчитался верно.", true);
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
    addEvent("feed");
  });

  el.btnDiaper.addEventListener("click", function () {
    flashButton(el.btnDiaper);
    addEvent("diaper");
  });

  el.btnSleep.addEventListener("click", function () {
    flashButton(el.btnSleep);
    addEvent(isSleepingNow() ? "sleep_end" : "sleep_start");
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
      showError("Не удалось сохранить файл");
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
    var rows = [["id", "type", "label", "time_local", "time_iso", "duration_min"]];
    sortedByTimeDesc(events).forEach(function (e) {
      var duration = analysis.durationById[e.id];
      rows.push([
        e.id,
        e.type,
        eventTypeLabel(e.type),
        formatDateTimeLocal(new Date(e.time)),
        e.time,
        duration ? Math.round(duration / MS_MIN) : ""
      ]);
    });
    // Semicolons keep the file openable in a Russian-locale Excel.
    return rows.map(function (r) { return r.map(csvEscape).join(";"); }).join("\r\n");
  }

  function buildMarkdown() {
    var analysis = analyzeSleep();
    var name = loadName().trim() || "Малышка";
    var groups = groupByDay(sortedByTimeDesc(events));
    var out = [];

    out.push("# Журнал — " + name);
    out.push("");
    out.push("Выгружено: " + formatDateTimeLocal(new Date()) + "  ");
    out.push("Всего записей: " + events.length);
    out.push("");

    groups.forEach(function (group) {
      out.push("## " + formatDateHeader(group.date));
      out.push("");
      out.push(daySummary(group, analysis));
      out.push("");
      out.push("| Время | Событие | Длительность |");
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
    showToast("Нет записей для выгрузки");
    return true;
  }

  el.exportCsv.addEventListener("click", function () {
    if (guardEmpty()) return;
    // BOM so Excel detects UTF-8 and Cyrillic labels survive.
    if (downloadFile(exportBaseName() + ".csv", "﻿" + buildCsv(), "text/csv;charset=utf-8")) {
      showToast("CSV сохранён");
    }
  });

  el.exportMd.addEventListener("click", function () {
    if (guardEmpty()) return;
    if (downloadFile(exportBaseName() + ".md", buildMarkdown(), "text/markdown;charset=utf-8")) {
      showToast("Markdown сохранён");
    }
  });

  el.exportJson.addEventListener("click", function () {
    if (guardEmpty()) return;
    var payload = JSON.stringify(sortedByTimeDesc(events), null, 2);
    if (downloadFile(exportBaseName() + ".json", payload, "application/json;charset=utf-8")) {
      showToast("Резервная копия сохранена");
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
    var timeCol = iIso >= 0 ? iIso : (iTime >= 0 ? iTime : iLocal);
    if (iType < 0 || timeCol < 0) return null;

    var out = [];
    for (var i = 1; i < lines.length; i++) {
      var cells = parseCsvLine(lines[i], delim);
      out.push({
        id: iId >= 0 ? cells[iId] : "",
        type: (cells[iType] || "").trim(),
        time: (cells[timeCol] || "").trim()
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
      events.push({ id: id, type: raw.type, time: iso });
      added++;
    });

    if (added && !saveEvents(events)) return;

    renderAll();
    var msg = "Добавлено записей: " + added;
    if (skipped) msg += ", повторов пропущено: " + skipped;
    if (invalid) msg += ", не распознано: " + invalid;
    showToast(msg);
  }

  function importFromText(text) {
    var clean = text.replace(/^﻿/, "").trim();
    if (!clean) {
      showToast("Файл пуст");
      return;
    }
    var first = clean.charAt(0);
    var list = (first === "[" || first === "{") ? parseJsonImport(clean) : parseCsvImport(clean);
    if (!list) {
      showToast("Не удалось разобрать файл");
      return;
    }
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
      showToast("Не удалось прочитать файл");
      el.importFile.value = "";
    };
    reader.readAsText(file);
  });

  el.dataToggle.addEventListener("click", function () {
    dataOpen = !dataOpen;
    el.dataPanel.hidden = !dataOpen;
    el.dataToggleText.textContent = dataOpen ? "Скрыть экспорт и импорт" : "Экспорт и импорт";
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
