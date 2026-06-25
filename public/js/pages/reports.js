import { boot, renderRadar, api, esc, fmtLocal, currentUser, planRank } from "/js/app.js";
import { renderReport } from "/js/report.js";
boot("/reports");

/* ---- sample data for the exemplar Ultra Report ---- */
const t0 = Date.now();
const SAMPLE = {
  plan: "ultra", isExemplar: true,
  eventTitle: "Friday Night Border Patrol", serverName: "Liberty County RP", scenario: "Border patrol", score: 78,
  joinsInWindow: 87, uniquePlayers: 71, peakConcurrent: 42, avgSessionMin: 61, retained30: 49,
  staffOnline: 9, modCalls: 4, commands: 57, queue: 6, maxPlayers: 50, conversionPct: 4.2,
  windowStart: new Date(t0 - 2 * 3600000).toISOString(), windowEnd: new Date(t0 - 0.5 * 3600000).toISOString(), generatedAt: new Date(t0).toISOString(),
  timeline: Array.from({ length: 10 }, (_, i) => ({ t: new Date(t0 - (2 - i * 0.166) * 3600000).toISOString(), n: [12, 21, 28, 35, 42, 40, 36, 34, 27, 19][i] })),
  funnel: { views: 820, reveals: 64, entries: 87, retained30: 49 },
  benchmark: { cohortSize: 23, peakPercentile: 71, sessionPercentile: 84, platformAvgSessionMin: 43 },
  forecast: { projectedJoins: [55, 70], projectedPeak: [38, 45], basedOnEvents: 4, confidence: "medium", recommendedStartLocal: new Date(t0 + 5 * 86400000).toISOString() },
  momentum: { direction: "up", changePct: 18 },
  staff: {
    estimatedResponseMin: 2.4, online: new Array(9), modCalls: 4, kills: 11,
    leaderboard: [
      { name: "Deputy_Marsh", permission: "Server Moderator", team: "Police", moderations: 18 },
      { name: "Sgt_Okafor", permission: "Server Administrator", team: "Police", moderations: 14 },
      { name: "Trooper_Lane", permission: "Server Moderator", team: "Police", moderations: 11 },
      { name: "Cpl_Vance", permission: "Server Moderator", team: "Sheriff", moderations: 8 },
    ],
  },
  scenarioDNA: { scenarios: [{ scenario: "Border patrol", runs: 9, avgScore: 74, avgRetention: 61 }, { scenario: "Bank heist", runs: 6, avgScore: 68, avgRetention: 54 }, { scenario: "Traffic enforcement", runs: 5, avgScore: 71, avgRetention: 58 }], advice: "Border patrol is your strongest format — keep it on Friday nights." },
  scenarioFatigue: { avgScoreEarly: 79, avgScoreRecent: 71, fatigued: false, advice: "Scores are holding steady across repeats. No fatigue detected yet." },
  deadHour: { advice: "A quiet 11-minute stretch was found at the 40-minute mark. Pre-announce the next code earlier to bridge it." },
  loyaltyTracker: { returningPlayers: 38, newPlayers: 33, returningRate: 54, advice: "Over half your room are returners — a fixed weekly slot keeps them locked in." },
  staffRatioAlert: { advice: "Player-to-staff ratio peaked at 12:1. Comfortable, but one more mod adds headroom." },
  bestTimeHeatmap: null,
  villainDetection: { disruptors: [{ player: "xX_Drift_Xx", timesKilled: 7, staffActed: true }, { player: "RandomCiv22", timesKilled: 4, staffActed: false }], advice: "RandomCiv22 was never actioned despite repeat RDM — flag for your staff team." },
  ghostStaff: { ghosts: [{ name: "Cadet_Reyes" }], advice: "1 staff member sat online without issuing a command. Re-balance the roster." },
  staffFatigue: { firstHalfAvgResponseMin: 1.8, secondHalfAvgResponseMin: 3.1, fatigued: false, advice: "Response held up well across the event. Solid staffing." },
  queueIntelligence: { peakQueue: 6, estimatedLost: 4, advice: "About 4 players left while queued — a higher slot cap or a boost recovers them." },
  goldenHour: { bestWindowStart: 12, bestWindowEnd: 34, retentionRate: 73, advice: "Minutes 12-34 retained best. Schedule your set-piece for that window." },
  moderationPressureMap: { early: 1, mid: 5, late: 3, advice: "Mod calls clustered mid-event. Brief staff to expect the surge." },
  healthTrend: { scores: [61, 66, 70, 68, 74, 78], trend: "improving", advice: "Six-event trend is climbing — keep the current format and slot." },
  tippingPoint: { avgSessionBelow: 21, avgSessionAbove: 52, advice: "Past 20 concurrent, sessions more than double. Boost early to clear the threshold." },
  weeklyReport: { events: 3, totalJoins: 214, bestEvent: "Friday Night Border Patrol", avgScore: 73, advice: "3 events, 214 joins, average score 73 — your strongest week this month." },
  aiSummary: "This was your strongest border patrol in a month: 87 joins against a projected 55 to 70, with peak concurrency of 42 filling 84 percent of the server. Retention was the standout, with 49 players staying past 30 minutes. The weak point sits at the top of the funnel, where only 64 of 820 listing viewers revealed the join code. For the next session, hold the Friday 7pm slot and refresh the banner.",
  delivery: { dm: true, webhook: true, recipient: true },
};

/* ---- colour helper ---- */
const scoreColor = (s) => s >= 70 ? "#69d99c" : s >= 45 ? "#7fa8ff" : "#ff7a7a";

/* ---- mini ring for the report list ---- */
function miniRing(value, max, color, label) {
  const r = 20, sw = 4, c = 2 * Math.PI * r;
  const pct = Math.min(1, Math.max(0, value / (max || 1)));
  const off = c * (1 - pct);
  return `
  <div class="rep-list-ring" title="${label}: ${value}">
    <svg viewBox="0 0 48 48" width="52" height="52">
      <circle cx="24" cy="24" r="${r}" fill="none" stroke="rgba(148,170,205,0.12)" stroke-width="${sw}"/>
      <circle cx="24" cy="24" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}"
        stroke-linecap="round" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}"/>
    </svg>
    <div class="rep-list-ring-val" style="color:${color}">${value}</div>
  </div>`;
}

/* ---- render the my-reports list ---- */
function renderReportList(events, userPlan) {
  const listEl = document.getElementById("repListInner");
  if (!events.length) {
    listEl.innerHTML = `<div class="card" style="padding:32px;text-align:center;color:var(--muted)">No reports yet. Run an event with your ER:LC API key connected to generate your first report. <a href="/settings">Connect in Settings</a>.</div>`;
    return;
  }

  listEl.innerHTML = events.map((ev, idx) => {
    const r = ev.lastReport;
    const score = r.score ?? 0;
    const peak = r.peakConcurrent ?? 0;
    const maxP = r.maxPlayers ?? 50;
    const ret = r.retained30 ?? 0;
    const joins = r.joinsInWindow ?? 1;
    const retPct = Math.min(100, Math.round((ret / Math.max(joins, 1)) * 100));
    const dateStr = r.windowStart ? fmtLocal(r.windowStart) : (ev.startsAt ? fmtLocal(ev.startsAt) : "");
    return `
    <div class="rep-list-item" id="rli-${idx}">
      <button class="rep-list-header" data-idx="${idx}">
        <div class="rep-list-rings">
          ${miniRing(score, 100, scoreColor(score), "Health score")}
          ${miniRing(peak, maxP, "#7fa8ff", "Peak concurrent")}
          ${miniRing(retPct, 100, "#ffb454", "Retention %")}
        </div>
        <div class="rep-list-meta">
          <h4>${esc(ev.title || r.eventTitle || "Event")}</h4>
          <p>${esc(r.serverName || "")} &middot; ${esc(r.scenario || "")} &middot; ${dateStr}</p>
          <div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap">
            <span class="badge">Score ${score}/100</span>
            <span class="badge">${peak} peak</span>
            <span class="badge">${ret} retained</span>
            ${r.delivery?.dm ? `<span class="badge badge-good">DM sent</span>` : ""}
          </div>
        </div>
        <span class="rep-list-chevron">&#9660;</span>
      </button>
      <div class="rep-list-body" id="rlb-${idx}"></div>
    </div>`;
  }).join("");

  /* wire expand/collapse */
  listEl.querySelectorAll(".rep-list-header").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = btn.dataset.idx;
      const item = document.getElementById(`rli-${idx}`);
      const body = document.getElementById(`rlb-${idx}`);
      const isOpen = item.classList.toggle("open");
      if (isOpen && !body.dataset.loaded) {
        body.dataset.loaded = "1";
        renderReport(body, events[idx].lastReport, userPlan);
      }
    });
  });
}

/* ---- notice banner ---- */
function notice(el, html) {
  const n = document.createElement("div");
  n.className = "alert alert-ok";
  n.style.marginBottom = "18px";
  n.innerHTML = html;
  el.prepend(n);
}

/* ---- main ---- */
async function init() {
  const btnMyReports = document.getElementById("btnMyReports");
  const btnExample = document.getElementById("btnExample");
  const loadingEl = document.getElementById("loading");
  const repListEl = document.getElementById("repList");
  const reportEl = document.getElementById("report");

  let me = null;
  let myEvents = [];
  let myReportsMode = false;
  let exampleMode = false;

  /* try to fetch user + their events */
  try {
    me = (await api("/api/auth?action=me")).user;
    const { events } = await api("/api/events?action=mine");
    myEvents = (events || []).filter((e) => e.lastReport).sort((a, b) => new Date(b.startsAt) - new Date(a.startsAt));
    if (me) btnMyReports.style.display = "";
  } catch {}

  /* ---- My Reports button ---- */
  btnMyReports.addEventListener("click", () => {
    if (myReportsMode) {
      /* collapse */
      myReportsMode = false;
      btnMyReports.classList.remove("active");
      repListEl.hidden = true;
      return;
    }
    myReportsMode = true;
    exampleMode = false;
    btnMyReports.classList.add("active");
    btnExample.classList.remove("active");
    reportEl.hidden = true;
    repListEl.hidden = false;
    renderReportList(myEvents, me?.plan || "free");
  });

  /* ---- Example button ---- */
  btnExample.addEventListener("click", () => {
    if (exampleMode) {
      exampleMode = false;
      btnExample.classList.remove("active");
      reportEl.hidden = true;
      return;
    }
    exampleMode = true;
    myReportsMode = false;
    btnExample.classList.add("active");
    btnMyReports.classList.remove("active");
    repListEl.hidden = true;
    reportEl.hidden = false;

    if (!reportEl.dataset.loaded) {
      reportEl.dataset.loaded = "1";
      renderReport(reportEl, SAMPLE);
      const rank = planRank(me?.plan);
      if (rank === 0) notice(reportEl, `This is an exemplar Ultra Report — every analytic filled with sample data. <a href="/advertise">List your first event</a> to generate a real one. Upgrade to unlock blurred sections. <a href="/pricing">See plans</a>`);
      else if (rank === 1) notice(reportEl, `Exemplar Ultra Report. Upgrade to Gatherly Ultra to unlock AI summaries, forecasting and the full intelligence suite. <a href="/pricing">See plans</a>`);
      else notice(reportEl, `This is an exemplar Ultra Report with realistic sample data. Your real reports appear under <b>My reports</b> above.`);
    }
  });
}

init();
