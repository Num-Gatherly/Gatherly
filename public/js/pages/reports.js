import { boot, renderRadar, api, esc, currentUser, planRank } from "/js/app.js";
import { renderReport } from "/js/report.js";
boot("/reports");

renderRadar(document.getElementById("loadRadar"), [{ title: "Compiling", scenario: "report", live: true }], "");

const t0 = Date.now();
// The /reports sample is rendered as the exemplar Ultra Report — every Gatherly
// Ultra analytic box is filled with realistic sample data so hosts see the full
// picture they get from an event. plan: "ultra" unlocks every section.
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
  // ANALYTICS (Pro)
  scenarioDNA: { scenarios: [{ scenario: "Border patrol", runs: 9, avgScore: 74, avgRetention: 61 }, { scenario: "Bank heist", runs: 6, avgScore: 68, avgRetention: 54 }, { scenario: "Traffic enforcement", runs: 5, avgScore: 71, avgRetention: 58 }], advice: "Border patrol is your strongest format — keep it on Friday nights." },
  scenarioFatigue: { avgScoreEarly: 79, avgScoreRecent: 71, fatigued: false, advice: "Scores are holding steady across repeats. No fatigue detected yet." },
  deadHour: { advice: "A quiet 11-minute stretch was found at the 40-minute mark. Pre-announce the next code earlier to bridge it." },
  loyaltyTracker: { returningPlayers: 38, newPlayers: 33, returningRate: 54, advice: "Over half your room are returners — a fixed weekly slot keeps them locked in." },
  staffRatioAlert: { advice: "Player-to-staff ratio peaked at 12:1 at the busiest point. Comfortable, but one more mod adds headroom." },
  bestTimeHeatmap: null,
  // ULTRA INTELLIGENCE
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

function notice(el, html) {
  const n = document.createElement("div");
  n.className = "alert alert-ok";
  n.style.marginBottom = "18px";
  n.innerHTML = html;
  el.prepend(n);
}

async function init() {
  let me = null;
  try {
    me = (await api("/api/auth?action=me")).user;
    const { events } = await api("/api/events?action=mine");
    const withReports = events.filter((e) => e.lastReport).sort((a, b) => new Date(b.startsAt) - new Date(a.startsAt));
    if (withReports.length) {
      document.getElementById("loading").hidden = true;
      const el = document.getElementById("report");
      el.hidden = false;
      renderReport(el, withReports[0].lastReport);
      const rank = planRank(me.plan);
      if (rank === 0) notice(el, `Showing your latest report from <b>${esc(withReports[0].title)}</b>. Upgrade to Gatherly Pro for Health Score, funnel, and benchmarks, or Ultra for AI summaries and forecasting. <a href="/pricing">See plans</a>`);
      else if (rank === 1) notice(el, `Showing your latest report. Upgrade to Gatherly Ultra for AI summaries, forecasting, and staff intelligence. <a href="/pricing">See plans</a>`);
      return;
    }
  } catch {}

  setTimeout(() => {
    document.getElementById("loading").hidden = true;
    const el = document.getElementById("report");
    el.hidden = false;
    renderReport(el, SAMPLE);
    notice(el, `This is an <b>exemplar Ultra Report</b> — every Gatherly Ultra analytic, filled with realistic sample data so you can see exactly what each event hands you. <a href="/advertise">List your first event</a> and your real report replaces this sample automatically. On Free and Pro, the boxes you haven't unlocked appear blurred with a one-tap upgrade.`);
  }, 1000);
}
init();
