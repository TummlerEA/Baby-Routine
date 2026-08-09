(function () {
  "use strict";

  var EVENTS_KEY = "baby-tracker-events";
  var NAME_KEY = "baby-tracker-name";
  var MS_MIN = 60 * 1000;
  var MS_HOUR = 60 * MS_MIN;

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

  function saveEvents(events) {
    try {
      localStorage.setItem(EVENTS_KEY, JSON.stringify(events));
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
    btnFeed: document.getElementById("btnFeed"),
    btnDiaper: document.getElementById("btnDiaper"),
    btnSleep: document.getElementById("btnSleep"),
    sleepLabel: document.getElementById("sleepLabel"),
    forecastList: document.getElementById("forecastList"),
    logToggle: document.getElementById("logToggle"),
    logToggleText: document.getElementById("logToggleText"),
    logList: document.getElementById("logList")
  };

  var logOpen = false;

  // ---------- helpers ----------

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

  function lastSleepEvent() {
    var sleepEvents = events.filter(function (e) {
      return e.type === "sleep_start" || e.type === "sleep_end";
    });
    if (!sleepEvents.length) return null;
    return sortedByTimeDesc(sleepEvents)[0];
  }

  function isSleepingNow() {
    var last = lastSleepEvent();
    return !!last && last.type === "sleep_start";
  }

  function formatDuration(ms) {
    if (ms < 0) ms = 0;
    var totalMin = Math.floor(ms / MS_MIN);
    var h = Math.floor(totalMin / 60);
    var m = totalMin % 60;
    if (h <= 0) return m + " мин";
    return h + " ч " + m + " мин";
  }

  function formatClockTime(date) {
    var h = String(date.getHours()).padStart(2, "0");
    var m = String(date.getMinutes()).padStart(2, "0");
    return h + ":" + m;
  }

  var WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
  var MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

  function formatDateHeader(date) {
    return date.getDate() + " " + MONTHS[date.getMonth()] + ", " + WEEKDAYS[date.getDay()];
  }

  // ---------- forecast ----------

  function computeForecast(kind) {
    // kind: 'feed' | 'diaper' | 'sleep'
    var filtered;
    if (kind === "sleep") {
      filtered = events.filter(function (e) { return e.type === "sleep_start"; });
    } else {
      filtered = events.filter(function (e) { return e.type === kind; });
    }
    var asc = sortedByTimeAsc(filtered);

    var intervals = [];
    for (var i = 1; i < asc.length; i++) {
      intervals.push(new Date(asc[i].time) - new Date(asc[i - 1].time));
    }
    var lastN = intervals.slice(-5);

    var isEstimate = lastN.length === 0;
    var avgInterval;
    if (isEstimate) {
      avgInterval = DEFAULTS[kind];
    } else {
      avgInterval = lastN.reduce(function (a, b) { return a + b; }, 0) / lastN.length;
    }

    var lastEvent = asc.length ? asc[asc.length - 1] : null;
    var baseTime = lastEvent ? new Date(lastEvent.time) : new Date();
    var nextTime = new Date(baseTime.getTime() + avgInterval);

    return {
      hasData: !!lastEvent,
      isEstimate: isEstimate,
      nextTime: nextTime
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

      if (!f.hasData && f.isEstimate === false) {
        // unreachable, kept for clarity
      }

      var timeHtml;
      if (!f.hasData) {
        var diffFromNow = f.nextTime - now;
        timeHtml = '<span class="f-time">через ' + formatDuration(diffFromNow) + '</span> <span class="f-estimate-tag">(оценка)</span>';
      } else {
        var diff = f.nextTime - now;
        if (diff < 0) {
          timeHtml = '<span class="f-time overdue">просрочено на ' + formatDuration(-diff) + '</span>';
        } else {
          timeHtml = '<span class="f-time">через ' + formatDuration(diff) + '</span>';
        }
        if (f.isEstimate) {
          timeHtml += ' <span class="f-estimate-tag">(оценка)</span>';
        }
      }

      div.innerHTML =
        '<span class="f-icon">' + item.icon + '</span>' +
        '<div class="f-body">' +
          '<div class="f-type">' + item.label + ' · ожидается ' + formatClockTime(f.nextTime) + '</div>' +
          '<div>' + timeHtml + '</div>' +
        '</div>';
      el.forecastList.appendChild(div);
    });
  }

  // ---------- sleep banner ----------

  function renderSleepBanner() {
    if (isSleepingNow()) {
      var last = lastSleepEvent();
      var dur = new Date() - new Date(last.time);
      el.sleepDuration.textContent = formatDuration(dur);
      el.sleepBanner.hidden = false;
    } else {
      el.sleepBanner.hidden = true;
    }
  }

  function renderSleepButton() {
    var sleeping = isSleepingNow();
    el.sleepLabel.textContent = sleeping ? "Проснулась" : "Уснула";
    el.btnSleep.classList.toggle("sleeping", sleeping);
  }

  // ---------- log ----------

  function eventTypeLabel(type) {
    return TYPE_META[type] ? TYPE_META[type].label : type;
  }

  function eventTypeIcon(type) {
    return TYPE_META[type] ? TYPE_META[type].icon : "•";
  }

  function renderLog() {
    el.logToggleText.textContent = (logOpen ? "Скрыть журнал" : "Показать журнал") + " (" + events.length + ")";
    el.logList.hidden = !logOpen;
    if (!logOpen) return;

    el.logList.innerHTML = "";
    if (!events.length) {
      var empty = document.createElement("div");
      empty.className = "log-empty";
      empty.textContent = "Записей пока нет";
      el.logList.appendChild(empty);
      return;
    }

    var desc = sortedByTimeDesc(events);
    desc.forEach(function (e) {
      var row = document.createElement("div");
      row.className = "log-item";
      var d = new Date(e.time);
      row.innerHTML =
        '<span class="l-icon">' + eventTypeIcon(e.type) + '</span>' +
        '<div class="l-body">' +
          '<div class="l-type">' + eventTypeLabel(e.type) + '</div>' +
          '<div class="l-time">' + formatDateHeader(d) + ', ' + formatClockTime(d) + '</div>' +
        '</div>' +
        '<button class="l-delete" data-id="' + e.id + '" aria-label="Удалить запись">✕</button>';
      el.logList.appendChild(row);
    });
  }

  el.logList.addEventListener("click", function (ev) {
    var btn = ev.target.closest(".l-delete");
    if (!btn) return;
    var id = btn.getAttribute("data-id");
    events = events.filter(function (e) { return e.id !== id; });
    saveEvents(events);
    renderAll();
  });

  el.logToggle.addEventListener("click", function () {
    logOpen = !logOpen;
    renderLog();
  });

  // ---------- actions ----------

  function addEvent(type) {
    var event = { id: uuid(), type: type, time: new Date().toISOString() };
    events.push(event);
    if (saveEvents(events)) {
      renderAll();
    }
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

  function flashButton(btn) {
    btn.classList.add("active-flash");
    setTimeout(function () {
      btn.classList.remove("active-flash");
    }, 250);
  }

  // ---------- name ----------

  el.babyName.value = loadName();
  el.babyName.addEventListener("input", function () {
    saveName(el.babyName.value);
  });

  // ---------- clock ----------

  function renderClock() {
    var now = new Date();
    el.topClock.textContent = formatClockTime(now);
    el.topDate.textContent = formatDateHeader(now);
  }

  // ---------- master render ----------

  function renderAll() {
    renderClock();
    renderSleepBanner();
    renderSleepButton();
    renderForecast();
    renderLog();
  }

  renderAll();
  setInterval(renderAll, 30 * 1000);
})();
