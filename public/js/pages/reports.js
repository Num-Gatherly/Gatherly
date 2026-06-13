import { boot, renderRadar, api, esc } from "/js/app.js";
import { renderReport } from "/js/report.js";
boot("/reports");

renderRadar(document.getElementById("loadRadar"), [{ title: "Compiling", scenario: "report", live: true }], "");

const PLAN_SAMPLE = {
  eventTitle: "Friday Night Border Patrol",
  serverName: "Liberty County RP",
  scenario: "Border patrol",
  score: 78,
  joinsInWindow: 87, uniquePlayers: 71, peakConcurrent: 42, avgSessionMin: 61, retained30: 49,
  staffOnline: 9, modCalls: 4, commands: 57, queue: 6, maxPlayers: 50,
  conversionPct: 4.2,
  windowStart: new Date(Date.now() - 2 * 3600000).toISOString(),
  windowEnd: new Date(Date.now() - 0.5 * 3600000).toISOString(),
  generatedAt: new Date().toISOString(),
  timeline: Array.from({ length: 10 }, (_, i) => ({
    t: new Date(Date.now() - (2 - i * 0.166) * 3600000).toISOString(),
    n: [12, 21, 28, 35, 42, 40, 36, 34, 27, 19][i],
  })),
  funnel: { views: 820, reveals: 64, entries: 87, retained30: 49 },
  benchmark: { cohortSize: 23, peakPercentile: 71, sessionPercentile: 84, platformAvgSessionMin: 43 },
  forecast: {
    projectedJoins: [55, 70], projectedPeak: [38, 45], basedOnEvents: 4,
    recommendedStartLocal: new Date(Date.now() + 5 * 86400000).toISOString(),
  },
  momentum: { direction: "up", changePct: 18 },
  staff: {
    avgModResponseMin: 2.4,
    leaderboard: [
      { name: "Deputy_Marsh", commands: 18 }, { name: "Sgt_Okafor", commands: 14 },
      { name: "Trooper_Lane", commands: 11 }, { name: "Cpl_Vance", commands: 8 },
    ],
    idle: ["Cadet_Reyes"],
  },
  aiSummary: "This was your strongest border patrol in a month: 87 joins against a projected 55 to 70, with peak concurrency of 42 filling 84 percent of the server. Retention was the standout, with 49 players staying past 30 minutes and an average session of 61 minutes, 18 above the platform norm for this scenario. The weak point sits at the top of the funnel, where only 64 of 820 listing viewers revealed the join code, suggesting the banner or description is underselling the event. For the next session, hold the Friday 7pm slot and refresh the banner.",
};

// Check if the user has a real report, and show that instead of sample
let showingSample = true;
let me = null;

async function tryLoadRealReport() {
  try {
    me = (await api("/api/auth?action=me")).user;
    const { events } = await api("/api/events?action=mine");
    const withReports = events.filter((e) => e.lastReport);
    if (withReports.length > 0) {
      // User has real reports - show most recent instead of sample
      withReports.sort((a, b) => new Date(b.startsAt) - new Date(a.startsAt));
      const latestReport = withReports[0].lastReport;
      showingSample = false;
      document.getElementById("loading").hidden = true;
      const el = document.getElementById("report");
      el.hidden = false;

      // Add plan-gated notice if they're missing features
      const plan = me.plan || "patrol";
      if (plan === "patrol") {
        const notice = document.createElement("div");
        notice.className = "alert alert-ok";
        notice.style.cssText = "margin-bottom:18px";
        notice.innerHTML = `Showing your report from <b>${esc(withReports[0].title)}</b>. Upgrade to Sergeant or Commander for Health Score, funnel analysis, AI summaries, and more. <a href="/pricing">See plans</a>`;
        el.prepend(notice);
      } else if (plan === "sergeant") {
        const notice = document.createElement("div");
        notice.className = "alert alert-ok";
        notice.style.cssText = "margin-bottom:18px";
        notice.innerHTML = `Showing your most recent report. Upgrade to Commander for AI summaries, forecasting, and staff intelligence. <a href="/pricing">See plans</a>`;
        el.prepend(notice);
      }

      renderReport(el, latestReport);
      return true;
    }
  } catch { }
  return false;
}

// Try to load real report first
const hasReal = await tryLoadRealReport().catch(() => false);

if (!hasReal) {
  // Show sample after delay
  setTimeout(() => {
    document.getElementById("loading").hidden = true;
    const el = document.getElementById("report");
    el.hidden = false;

    // Add sample notice
    const notice = document.createElement("div");
    notice.className = "alert alert-ok";
    notice.style.cssText = "margin-bottom:18px";
    notice.innerHTML = `This is a sample report. <a href="/advertise">List your first event</a> and generate a real one - it will appear here automatically.`;
    el.prepend(notice);

    renderReport(el, PLAN_SAMPLE);
  }, 1100);
}
