/* ============================================================
   Badminton Expense Tracker — Application Logic
   ============================================================
   Tracks badminton session costs and measures progress toward
   a collection target. Sessions are stored per-row in RestDB.

   DB Schema (badminton-data collection):
     Date     : string  — stored as "yyyy-mm-dd" (ISO)
     Duration : string  — "2hr" | "1hr" | "cancelled"
     id       : number  — unique timestamp, required by DB schema
   ============================================================ */


/* ── Configuration ──────────────────────────────────────────── */

const API_URL = "https://badminton1-728f.restdb.io/rest/badminton-data";
const API_HEADERS = {
  "x-apikey":     "69133b1c7f34ed2ba4200e07",
  "content-type": "application/json"
};

// The previous collection target (already met). Sessions up to and
// including the session that crossed this amount go into Old History.
const PREVIOUS_TARGET = 1080;

// The current fresh collection target.
const CURRENT_TARGET = 1180;

// Fixed deduction applied when a session is cancelled.
const CANCELLATION_DEDUCTION = -20;

// Rate change cutoff: from this date onwards, new per-hour rates apply.
// Month is 0-indexed (4 = May).
const RATE_CHANGE_DATE = new Date(2026, 4, 16);

// Per-hour and per-session rates, keyed by era.
const SESSION_RATES = {
  before: { "1hr": 36,  "2hr": 72  },  // rates before RATE_CHANGE_DATE
  after:  { "1hr": 50,  "2hr": 100 }   // rates from RATE_CHANGE_DATE onwards
};


/* ── Application State ──────────────────────────────────────── */

// All sessions loaded from DB, sorted chronologically.
// Each entry: { _id, date: "dd-mm-yyyy", duration, cost }
let allSessions = [];

// The duration type selected in the UI for the next entry.
let selectedDurationType = "2hr";


/* ── Date Utilities ─────────────────────────────────────────── */

/**
 * Parse a date string into a JS Date for comparison.
 * Handles both ISO timestamps ("2025-10-05T00:00:00.000Z")
 * and internal "dd-mm-yyyy" format.
 */
function parseDateString(dateStr) {
  if (!dateStr) return new Date(0);
  if (dateStr.includes("T")) return new Date(dateStr);   // ISO from DB
  const [day, month, year] = dateStr.split("-");
  return new Date(+year, +month - 1, +day);
}

/**
 * Convert any date value returned by RestDB (ISO timestamp) into
 * the internal "dd-mm-yyyy" format used throughout the app.
 * Returns null if the date is invalid.
 */
function normaliseDateFromDB(rawDateValue) {
  if (!rawDateValue) return null;
  const dt = new Date(rawDateValue);
  if (isNaN(dt.getTime())) return null;
  const day   = String(dt.getUTCDate()).padStart(2, "0");
  const month = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const year  = dt.getUTCFullYear();
  return `${day}-${month}-${year}`;
}

/**
 * Format a "dd-mm-yyyy" string for display, e.g. "05 Oct 2025".
 */
function formatDateForDisplay(dateStr) {
  const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun",
                       "Jul","Aug","Sep","Oct","Nov","Dec"];
  if (!dateStr) return "";
  const [day, month, year] = dateStr.split("-");
  return `${day} ${MONTH_NAMES[+month - 1]} ${year}`;
}

/**
 * Convert the native date-input value ("yyyy-mm-dd") to the
 * internal "dd-mm-yyyy" format.
 */
function inputValueToInternal(inputValue) {
  const [y, m, d] = inputValue.split("-");
  return `${d}-${m}-${y}`;
}

/**
 * Convert the native date-input value ("yyyy-mm-dd") to an ISO
 * date string ("yyyy-mm-dd") safe for DB storage.
 */
function inputValueToISODate(inputValue) {
  return inputValue; // already in yyyy-mm-dd — no change needed
}


/* ── Rate / Cost Utilities ──────────────────────────────────── */

/**
 * Return the applicable rate table for a given session date.
 */
function getRatesForDate(dateStr) {
  return parseDateString(dateStr) >= RATE_CHANGE_DATE
    ? SESSION_RATES.after
    : SESSION_RATES.before;
}

/**
 * Calculate the cost for a session given its duration type and date.
 * Cancelled sessions always return the fixed CANCELLATION_DEDUCTION.
 */
function calculateSessionCost(durationType, dateStr) {
  if (durationType === "cancelled") return CANCELLATION_DEDUCTION;
  const rates = getRatesForDate(dateStr);
  return rates[durationType] ?? SESSION_RATES.before[durationType];
}

/**
 * Return the number of playing hours for a session.
 * Cancelled sessions contribute 0 hours.
 */
function getSessionHours(durationType) {
  if (durationType === "cancelled") return 0;
  return durationType === "2hr" ? 2 : 1;
}


/* ── DB: Fetch All Sessions ─────────────────────────────────── */

function loadSessionsFromDB() {
  $.ajax({
    url:     API_URL,
    method:  "GET",
    headers: API_HEADERS
  })
  .done(function (rows) {
    $("#loader").hide();
    $("#app-content").fadeIn();

    allSessions = [];

    rows.forEach(row => {
      if (!row.Date) return;
      const normalisedDate = normaliseDateFromDB(row.Date);
      if (!normalisedDate) return;

      const durationType = row.Duration || "2hr";
      allSessions.push({
        _id:          row._id,
        date:         normalisedDate,
        durationType: durationType,
        cost:         calculateSessionCost(durationType, normalisedDate)
      });
    });

    // Ensure chronological order for target-split and history display
    allSessions.sort((a, b) => parseDateString(a.date) - parseDateString(b.date));

    renderUI();
  })
  .fail(function () {
    alert("Failed to load session data. Please refresh the page.");
  });
}


/* ── DB: Save New Session ───────────────────────────────────── */

function saveSessionToDB(isoDate, durationType, onSuccess, onError) {
  const payload = {
    Date:     isoDate,
    Duration: durationType,
    id:       Date.now()   // required field by current DB schema
  };

  showDebugInfo("→ POST " + API_URL + "\nBody: " + JSON.stringify(payload) + "\n\nWaiting...");

  fetch(API_URL, {
    method:  "POST",
    headers: API_HEADERS,
    body:    JSON.stringify(payload)
  })
  .then(async res => {
    const responseText = await res.text();
    let parsedResponse;
    try { parsedResponse = JSON.parse(responseText); }
    catch (e) { parsedResponse = responseText; }

    showDebugInfo(
      "← Status: " + res.status + " " + res.statusText +
      "\nResponse: " + JSON.stringify(parsedResponse, null, 2)
    );

    if (!res.ok) { onError(parsedResponse); return; }
    onSuccess(parsedResponse);
  })
  .catch(err => {
    showDebugInfo("Network error: " + err.message);
    onError(err);
  });
}


/* ── UI: Duration Toggle ────────────────────────────────────── */

function selectDurationType(durationType) {
  selectedDurationType = durationType;
  $("#btn-2hr").toggleClass("is-active", durationType === "2hr");
  $("#btn-1hr").toggleClass("is-active", durationType === "1hr");
  $("#btn-cancelled").toggleClass("is-active", durationType === "cancelled");
  validateAndRefreshAddButton();
}


/* ── UI: Rate Labels (update when date changes) ─────────────── */

/**
 * Update the duration button labels and the Per Hour stat card
 * to reflect the rates applicable to the currently selected date.
 */
function updateRateLabelsForSelectedDate() {
  const inputValue = $("#session-date-input").val();
  if (!inputValue) return;

  const internalDate = inputValueToInternal(inputValue);
  const rates = getRatesForDate(internalDate);

  $("#btn-2hr").text(`2hr ₹${rates["2hr"]}`);
  $("#btn-1hr").text(`1hr ₹${rates["1hr"]}`);
  $("#per-hour-rate").text(`₹${rates["1hr"]}`);
}


/* ── UI: Build History List HTML ────────────────────────────── */

/**
 * Build the HTML for a list of session rows.
 * Each row shows: index, date, duration badge, and cost.
 */
function buildSessionListHTML(sessionList) {
  if (sessionList.length === 0) return "";

  return sessionList.map((session, index) => {
    // Duration badge
    let badgeClass, badgeLabel;
    if (session.durationType === "2hr") {
      badgeClass = "session-row__badge--two-hr";
      badgeLabel = "2 Hours";
    } else if (session.durationType === "1hr") {
      badgeClass = "session-row__badge--one-hr";
      badgeLabel = "1 Hour";
    } else {
      badgeClass = "session-row__badge--cancelled";
      badgeLabel = "Cancelled";
    }

    // Cost display (deductions shown in red)
    const isDeduction = session.cost < 0;
    const costClass   = isDeduction ? "session-row__cost session-row__cost--deduction" : "session-row__cost";
    const costLabel   = isDeduction ? `-₹${Math.abs(session.cost)}` : `₹${session.cost}`;

    return `
      <li class="session-row">
        <span class="session-row__index">#${index + 1}</span>
        <span class="session-row__date">${formatDateForDisplay(session.date)}</span>
        <span class="session-row__badge ${badgeClass}">${badgeLabel}</span>
        <span class="${costClass}">${costLabel}</span>
      </li>`;
  }).join("");
}


/* ── UI: Main Render ─────────────────────────────────────────── */

function renderUI() {
  // ── 1. Split sessions into "old" (≤ PREVIOUS_TARGET) and "current" ──
  let runningTotal = 0;
  let splitAtIndex = -1;   // index of session that met the previous target

  for (let i = 0; i < allSessions.length; i++) {
    runningTotal += allSessions[i].cost;
    if (runningTotal >= PREVIOUS_TARGET) {
      splitAtIndex = i;
      break;
    }
  }

  const oldHistorySessions     = splitAtIndex >= 0
    ? allSessions.slice(0, splitAtIndex + 1)
    : allSessions.slice();

  const currentPeriodSessions  = splitAtIndex >= 0
    ? allSessions.slice(splitAtIndex + 1)
    : [];

  // ── 2. Compute stats for the current period (toward CURRENT_TARGET) ──
  const amountCollected = currentPeriodSessions.reduce((sum, s) => sum + s.cost, 0);
  const hoursPlayed     = currentPeriodSessions.reduce((sum, s) => sum + getSessionHours(s.durationType), 0);
  const progressPercent = CURRENT_TARGET > 0
    ? Math.min((amountCollected / CURRENT_TARGET) * 100, 100)
    : 0;
  const surplusAmount   = amountCollected - CURRENT_TARGET;

  // ── 3. Update stat cards ────────────────────────────────────────────
  $("#total-hours").text(hoursPlayed);
  $("#total-collected").text(amountCollected);
  $("#current-target").text(CURRENT_TARGET);
  $("#progress-bar-fill").css("width", progressPercent + "%");

  const $surplus = $("#surplus-amount");
  $surplus
    .text((surplusAmount >= 0 ? "+" : "") + surplusAmount)
    .css("color", surplusAmount >= 0 ? "var(--color-success)" : "var(--color-danger)");

  // ── 4. Check if current target has been met ──────────────────────────
  let newTargetMetIndex = -1;
  let runningNew = 0;
  for (let i = 0; i < currentPeriodSessions.length; i++) {
    runningNew += currentPeriodSessions[i].cost;
    if (runningNew >= CURRENT_TARGET) {
      newTargetMetIndex = i;
      break;
    }
  }

  // When the new target is met, the current period sessions merge into old history
  const visibleCurrentSessions  = newTargetMetIndex >= 0 ? [] : currentPeriodSessions;
  const visibleOldSessions      = newTargetMetIndex >= 0
    ? [...oldHistorySessions, ...currentPeriodSessions]
    : oldHistorySessions;

  // ── 5. History list buttons ──────────────────────────────────────────
  $("#btn-view-history").prop("disabled", visibleCurrentSessions.length === 0);
  $("#btn-view-old-history").prop("disabled", visibleOldSessions.length === 0);

  // ── 6. Render history lists ──────────────────────────────────────────
  const currentListHTML = buildSessionListHTML(visibleCurrentSessions);
  $("#current-history-list").html(
    `<ul>${currentListHTML || '<li class="session-row" style="justify-content:center;color:#94a3b8;">No new sessions yet</li>'}</ul>`
  );

  const oldListHTML = buildSessionListHTML(visibleOldSessions);
  $("#old-history-list").html(
    `<ul>${oldListHTML || '<li class="session-row" style="justify-content:center;color:#94a3b8;">No history yet</li>'}</ul>`
  );

  // ── 7. Target met banner ─────────────────────────────────────────────
  renderTargetMetBanner(currentPeriodSessions, newTargetMetIndex);

  validateAndRefreshAddButton();
}

/**
 * Show or hide the "target met" banner at the bottom of the page.
 */
function renderTargetMetBanner(currentPeriodSessions, newTargetMetIndex) {
  if (newTargetMetIndex < 0) {
    $("#target-met-banner").html("");
    return;
  }

  const metSession     = currentPeriodSessions[newTargetMetIndex];
  const durationLabel  = metSession.durationType === "2hr" ? "2-hour"
                       : metSession.durationType === "1hr" ? "1-hour"
                       : "cancelled";

  $("#target-met-banner").html(`
    <div class="target-met-banner">
      🎯 Target of ₹${CURRENT_TARGET} was met on
      <strong>${formatDateForDisplay(metSession.date)}</strong>
      &nbsp;(${durationLabel} session)
    </div>`);
}


/* ── UI: Add Session Button ─────────────────────────────────── */

/**
 * Validate the selected date and update the Add Date button state.
 * Also refreshes rate labels in case the date changed.
 */
function validateAndRefreshAddButton() {
  const inputValue = $("#session-date-input").val();
  if (!inputValue) return;

  updateRateLabelsForSelectedDate();

  const internalDate = inputValueToInternal(inputValue);

  // Duplicate check: allow a "cancelled" entry on a date that already has a game,
  // but block two game entries on the same date.
  const isDuplicate = selectedDurationType !== "cancelled"
    && allSessions.some(s => s.date === internalDate && s.durationType !== "cancelled");

  if (isDuplicate) {
    $("#btn-add-session").prop("disabled", true).text("Already Recorded");
  } else {
    $("#btn-add-session").prop("disabled", false).text("Add Date");
  }
}

/**
 * Handle the "Add Date" button click: validate PIN, save to DB,
 * update local state, and re-render.
 */
function handleAddSession() {
  const pin = prompt("Enter PIN:");
  if (pin !== "12345") { alert("Wrong PIN"); return; }

  const inputValue = $("#session-date-input").val();
  if (!inputValue) { alert("Please select a date."); return; }

  const internalDate = inputValueToInternal(inputValue);
  const isoDate      = inputValueToISODate(inputValue);

  // Guard against duplicate (belt-and-suspenders check)
  if (selectedDurationType !== "cancelled"
      && allSessions.some(s => s.date === internalDate && s.durationType !== "cancelled")) {
    return;
  }

  const $addButton = $("#btn-add-session").prop("disabled", true).text("Saving...");

  saveSessionToDB(
    isoDate,
    selectedDurationType,
    // ── Success ──────────────────────────────────────────────────────
    function (savedRow) {
      allSessions.push({
        _id:          savedRow._id,
        date:         internalDate,
        durationType: selectedDurationType,
        cost:         calculateSessionCost(selectedDurationType, internalDate)
      });
      allSessions.sort((a, b) => parseDateString(a.date) - parseDateString(b.date));
      renderUI();
      $addButton.prop("disabled", false).text("Add Date");
    },
    // ── Error ─────────────────────────────────────────────────────────
    function () {
      $addButton.prop("disabled", false).text("Add Date");
    }
  );
}


/* ── UI: Debug Panel ────────────────────────────────────────── */

function showDebugInfo(message) {
  $("#debug-panel").show().text(message);
}


/* ── UI: History Toggle ─────────────────────────────────────── */

function toggleCurrentHistory() {
  $("#current-history-list").slideToggle();
  $("#old-history-list").slideUp();
}

function toggleOldHistory() {
  $("#old-history-list").slideToggle();
  $("#current-history-list").slideUp();
}


/* ── Initialisation ─────────────────────────────────────────── */

$(document).ready(function () {
  // Set date picker to today
  $("#session-date-input").val(new Date().toISOString().split("T")[0]);

  // Set initial rate labels based on today's date
  updateRateLabelsForSelectedDate();

  // Wire up event listeners
  $("#session-date-input").on("change", validateAndRefreshAddButton);
  $("#btn-add-session").on("click", handleAddSession);
  $("#btn-view-history").on("click", toggleCurrentHistory);
  $("#btn-view-old-history").on("click", toggleOldHistory);

  // Load data
  loadSessionsFromDB();
});
