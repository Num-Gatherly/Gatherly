import { boot, renderRadar, api, esc, currentUser, planRank } from "/js/app.js";
import { renderReport } from "/js/report.js";
boot("/reports");

renderRadar(document.getElementById("loadRadar"), [{ title: "Compiling", scenario: "report", live: true }], "");

const t0 = Date.now();
const SAMPLE = {
  eventTitle: "Friday Night Border Patrol", serverName: "Liberty County RP", scenario: "Border patrol", score: 78,
  joinsInWindow: 87, uniquePlayers: 71, peakConcurrent: 42, avgSessionMin: 61, retained30: 49,
  staffOnline: 9, modCalls: 4, commands: 57, queue: 6, maxPlayers: 50, conversionPct: 4.2,
  windowStart: new Date(t0 - 2 * 3600000).toISOString(), windowEnd: new Date(t0 - 0.5 * 3600000).toISOString(), generatedAt: new Date(t0).toISOString(),
  timeline: Array.from({ length: 10 }, (_, i) => ({ t: new Date(t0 - (2 - i * 0.166) * 3600000).toISOString(), n: [12, 21, 28, 35, 42, 40, 36, 34, 27, 19][i] })),
  funnel: { views: 820, reveals: 64, entries: 87, retained30: 49 },
  benchmark: { cohortSize: 23, peakPercentile: 71, sessionPercentile: 84, platformAvgSessionMin: 43 },
  forecast: { projectedJoins: [55, 70], projectedPeak: [38, 45], basedOnEvents: 4, recommendedStartLocal: new Date(t0 + 5 * 86400000).toISOString() },
  momentum: { direction: "up", changePct: 18 },
  staff: { avgModResponseMin: 2.4, leaderboard: [{ name: "Deputy_Marsh", commands: 18 }, { name: "Sgt_Okafor", commands: 14 }, { name: "Trooper_Lane", commands: 11 }, { name: "Cpl_Vance", commands: 8 }], idle: ["Cadet_Reyes"] },
  aiSummary: "This was your strongest border patrol in a month: 87 joins against a projected 55 to 70, with peak concurrency of 42 filling 84 percent of the server. Retention was the standout, with 49 players staying past 30 minutes. The weak point sits at the top of the funnel, where only 64 of 820 listing viewers revealed the join code. For the next session, hold the Friday 7pm slot and refresh the banner.",
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
    notice(el, `This is a sample report. <a href="/advertise">List your first event</a> and generate a real one - it replaces this sample automatically the moment it's ready.`);
  }, 1000);
}
init();
