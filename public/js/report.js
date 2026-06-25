// Renders a full Gatherly engagement report into a container element.
import { esc, fmtLocal, planRank } from "/js/app.js";

const scoreColor = (s) => (s >= 70 ? "var(--good)" : s >= 45 ? "var(--signal)" : "var(--bad)");
const safeNum = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/* ---- plan gating ---- */
const PLAN_DISPLAY = { pro: "Gatherly Pro", ultra: "Gatherly Ultra" };
const lockSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;

/* ---- SVG icons for box headers (no emojis) ---- */
const I = {
  activity: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
  funnel:   `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>`,
  bar:      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
  trophy:   `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="8 21 12 21 16 21"/><line x1="12" y1="17" x2="12" y2="21"/><path d="M7 4h10l-1 7a5 5 0 0 1-10 0L5 4H2"/></svg>`,
  layers:   `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`,
  refresh:  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`,
  clock:    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  users:    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  alert:    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  grid:     `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`,
  send:     `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`,
  cpu:      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg>`,
  trending: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>`,
  shield:   `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
  userx:    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="18" y1="8" x2="23" y2="13"/><line x1="23" y1="8" x2="18" y2="13"/></svg>`,
  zap:      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
  star:     `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  map:      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>`,
  calendar: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
  message:  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  list:     `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`,
};

const BOX_ICON = {
  "Health Score": I.activity,
  "Player lifecycle funnel": I.funnel,
  "Players over the window": I.bar,
  "Scenario benchmark": I.trophy,
  "Scenario DNA": I.layers,
  "Scenario fatigue index": I.refresh,
  "Dead hour detection": I.clock,
  "Loyalty tracker": I.users,
  "Staff ratio alerts": I.alert,
  "Best-time-to-host heatmap": I.grid,
  "Discord webhook delivery": I.send,
  "AI-generated report summary": I.cpu,
  "Predictive forecasting": I.trending,
  "Villain detection": I.shield,
  "Ghost staff detection": I.userx,
  "Staff fatigue score": I.zap,
  "Queue intelligence": I.list,
  "Golden hour analysis": I.star,
  "Moderation pressure map": I.map,
  "Server health trend line": I.activity,
  "Tipping point analysis": I.zap,
  "Weekly performance report": I.calendar,
  "Bot DM report delivery": I.message,
};

/* ---- box() — collapsible analytics card with blur-gate for locked tiers ---- */
function box(title, bodyHtml, opts = {}) {
  const { tier, userPlan, accent, kicker } = opts;
  const locked = tier && planRank(userPlan) < planRank(tier);
  const name = PLAN_DISPLAY[tier] || "Gatherly Pro";
  const accentStyle = accent ? `border-left:3px solid ${accent};` : "";
  const icon = BOX_ICON[title] || I.activity;
  const tierClass = tier === "ultra" ? "rep-tier-ultra" : "rep-tier-pro";

  const summaryHead = `
    <div class="rep-sum-left">
      ${kicker ? `<div class="rep-kick">${esc(kicker)}</div>` : ""}
      <h3>${title}${locked ? `<span class="rep-tier-badge ${tierClass}">${lockSvg} ${esc(name)}</span>` : ""}</h3>
    </div>
    <span class="rep-sum-icon">${icon}</span>
    <span class="rep-sum-arrow">&#9660;</span>`;

  if (!locked) {
    return `<details class="card rep-box" style="${accentStyle}">
      <summary>${summaryHead}</summary>
      <div class="rep-box-body">${bodyHtml}</div>
    </details>`;
  }

  /* blurred with overlay upgrade prompt */
  return `<details class="card rep-box rep-box-locked" style="${accentStyle}">
    <summary>${summaryHead}</summary>
    <div class="rep-box-body">
      <div class="rep-blur-content">${bodyHtml}</div>
      <div class="rep-unlock-gate">
        <b>${lockSvg} ${esc(name)} feature</b>
        <p>Upgrade once — fills in on every future report automatically.</p>
        <a class="btn btn-primary btn-sm" href="/pricing" style="margin-top:4px">Level up to ${esc(name)} →</a>
      </div>
    </div>
  </details>`;
}

const sectionHeader = (label, sub) => `
  <div class="rep-section-head-v2">
    <h2>${esc(label)}</h2>
    ${sub ? `<p>${esc(sub)}</p>` : ""}
  </div>`;

/* ---- WHOOP ring ---- */
function whoopRing(value, max, color, label, unit = "") {
  const r = 52, sw = 9, c = 2 * Math.PI * r;
  const pct = Math.min(1, Math.max(0, value / max));
  const off = c * (1 - pct);
  const size = 128;
  const gId = `rg-${Math.random().toString(36).slice(2, 7)}`;
  return `<div class="whoop-ring-item">
    <div class="whoop-ring-svg" style="width:${size}px;height:${size}px">
      <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" style="transform:rotate(-90deg)">
        <defs>
          <filter id="${gId}" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3.5" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="rgba(180,180,210,0.1)" stroke-width="${sw}"/>
        <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}"
          stroke-linecap="round" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}"
          filter="url(#${gId})"/>
      </svg>
      <div class="whoop-ring-center">
        <b style="color:${color}">${value}${unit}</b>
        <span>${label}</span>
      </div>
    </div>
  </div>`;
}

function dial(score) {
  const r = 68, c = 2 * Math.PI * r, off = c * (1 - score / 100);
  const col = scoreColor(score);
  return `
  <div class="score-dial">
    <svg viewBox="0 0 160 160" width="160" height="160" style="transform:rotate(-90deg)">
      <circle cx="80" cy="80" r="${r}" fill="none" stroke="rgba(180,180,210,0.1)" stroke-width="11"/>
      <circle cx="80" cy="80" r="${r}" fill="none" stroke="${col}" stroke-width="11"
        stroke-linecap="round" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}"/>
    </svg>
    <div class="val"><b style="color:${col}">${score}</b><span>Health Score</span></div>
  </div>`;
}

function funnel(f) {
  const max = Math.max(safeNum(f.views), 1);
  const rows = [["Listing views", safeNum(f.views)], ["Code reveals", safeNum(f.reveals)], ["Server entries", safeNum(f.entries)], ["Retained 30m+", safeNum(f.retained30)]];
  let html = `<div class="funnel">`;
  rows.forEach(([label, v], i) => {
    html += `<div class="funnel-row"><span>${label}</span>
      <div class="funnel-bar" style="width:${Math.max(2, (v / max) * 100)}%"></div>
      <b style="font-variant-numeric:tabular-nums">${v}</b></div>`;
    if (i < rows.length - 1) {
      const next = rows[i + 1][1];
      const drop = v > 0 ? Math.round((1 - next / v) * 100) : 0;
      if (drop > 0) html += `<div class="funnel-drop">&minus;${drop}% drop-off</div>`;
    }
  });
  return html + `</div>`;
}

function timeline(points) {
  if (!points?.length) return `<p class="note">No timeline data in this window.</p>`;
  const max = Math.max(...points.map((p) => safeNum(p.n)), 1);
  const bars = points.map((p) => {
    const h = Math.max(4, Math.round((safeNum(p.n) / max) * 78));
    const label = new Date(p.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return `<div class="wh-bar-wrap">
      <div class="wh-bar" style="height:${h}px" data-n="${safeNum(p.n)} players"></div>
      <div class="wh-bar-label">${label}</div>
    </div>`;
  }).join("");
  return `<div class="wh-timeline">${bars}</div>`;
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
function genHeat() {
  return DAYS.map((_, d) => Array.from({ length: 24 }, (_, h) => {
    const evening = Math.exp(-Math.pow(h - 20, 2) / 14);
    const weekend = d >= 4 ? 1.18 : 0.85;
    const noise = 0.82 + Math.sin((d * 24 + h) * 1.3) * 0.18;
    return Math.max(0, Math.min(1, evening * weekend * noise));
  }));
}
function heatmap(data) {
  const grid = Array.isArray(data) && data.length === 7 ? data : genHeat();
  let best = { v: -1, d: 0, h: 0 };
  grid.forEach((row, d) => row.forEach((v, h) => { if (v > best.v) best = { v, d, h }; }));
  const hourLbl = (h) => `${((h + 11) % 12) + 1}${h < 12 ? "am" : "pm"}`;
  const rows = grid.map((row, d) => `
    <div class="heat-row">
      <span class="heat-day">${DAYS[d]}</span>
      <div class="heat-cells">
        ${row.map((v, h) => {
          const a = Math.max(0, Math.min(1, v));
          return `<i style="background:rgba(129,140,248,${(0.06 + a * 0.94).toFixed(2)})" title="${DAYS[d]} ${hourLbl(h)} — ${Math.round(a * 100)}% turnout index"></i>`;
        }).join("")}
      </div>
    </div>`).join("");
  return `
    <div class="heatmap-7">${rows}
      <div class="heat-row heat-axis"><span class="heat-day"></span><div class="heat-cells">
        ${[0, 6, 12, 18, 23].map((h) => `<span style="grid-column:${h + 1}">${hourLbl(h)}</span>`).join("")}
      </div></div>
    </div>
    <p class="note" style="margin-top:12px">Hottest slot: <b style="color:var(--signal)">${DAYS[best.d]} ${hourLbl(best.h)}</b></p>`;
}

const momentumBadge = (m) => !m ? "" : m.direction === "up"
  ? `<span class="whoop-momentum up">+${m.changePct}% vs last</span>`
  : m.direction === "down" ? `<span class="whoop-momentum down">${m.changePct}% vs last</span>` : `<span class="whoop-momentum flat">Stable</span>`;

function advicePill(text) {
  return `<p class="note" style="margin-top:8px;padding:8px 12px;background:rgba(129,140,248,.07);border-radius:8px;border-left:2px solid var(--signal)">${esc(text)}</p>`;
}
const miniStat = (v, l) => `<div class="stat"><b>${v}</b><span>${esc(l)}</span></div>`;
const deliveryRow = (on, label, sub) => `
  <div class="delivery-row">
    <span class="del-dot ${on ? "on" : ""}"></span>
    <div><b style="color:var(--text)">${esc(label)}</b><div class="note" style="margin:2px 0 0;border:0;padding:0">${esc(sub)}</div></div>
    <span class="badge ${on ? "badge-good" : ""}" style="margin-left:auto">${on ? "Delivered" : "Ready"}</span>
  </div>`;

/* ---- teaser data for blurred locked boxes ---- */
const T = {
  scenarioDNA: { scenarios: [{ scenario: "Border patrol", runs: 9, avgScore: 74, avgRetention: 61 }, { scenario: "Bank heist", runs: 6, avgScore: 68, avgRetention: 54 }, { scenario: "Traffic enforcement", runs: 5, avgScore: 71, avgRetention: 58 }], advice: "Border patrol is your strongest format — schedule it on your highest-traffic night." },
  scenarioFatigue: { avgScoreEarly: 79, avgScoreRecent: 64, fatigued: true, advice: "Scores are sliding over repeats. Rotate in a fresh scenario before the next run." },
  deadHour: { advice: "A near-empty 18 minute stretch was detected mid-event. Pre-announce the join code earlier." },
  loyaltyTracker: { returningPlayers: 38, newPlayers: 33, returningRate: 54, advice: "Over half your room are returners. A weekly fixed slot keeps them coming back." },
  staffRatioAlert: { advice: "Player-to-staff ratio peaked at 14:1. One more moderator on deck would cut response times." },
  villainDetection: { disruptors: [{ player: "xX_Drift_Xx", timesKilled: 7, staffActed: true }, { player: "RandomCiv22", timesKilled: 4, staffActed: false }], advice: "One repeat disruptor was never actioned — flag them for your staff team." },
  ghostStaff: { ghosts: [{ name: "Cadet_Reyes" }], advice: "1 staff member was online with zero commands. Re-balance the roster." },
  staffFatigue: { firstHalfAvgResponseMin: 1.8, secondHalfAvgResponseMin: 4.6, fatigued: true, advice: "Response times more than doubled late-event — rotate staff for the back half." },
  queueIntelligence: { peakQueue: 6, estimatedLost: 4, advice: "Roughly 4 players left while queued. A higher slot cap recovers them." },
  goldenHour: { bestWindowStart: 12, bestWindowEnd: 34, retentionRate: 73, advice: "Minutes 12-34 retained best. Time your big set-piece for that window." },
  moderationPressureMap: { early: 1, mid: 5, late: 3, advice: "Mod calls spike mid-event. Brief staff to expect the surge." },
  healthTrend: { scores: [61, 66, 70, 68, 74, 78], trend: "improving", advice: "Six-event trend is climbing. Keep the current format and slot." },
  tippingPoint: { avgSessionBelow: 21, avgSessionAbove: 52, advice: "Above 20 concurrent, sessions more than double. Boost early to clear the threshold fast." },
  forecast: { projectedJoins: [55, 70], projectedPeak: [38, 45], basedOnEvents: 4, confidence: "medium" },
  benchmark: { cohortSize: 23, peakPercentile: 71, sessionPercentile: 84, platformAvgSessionMin: 43 },
  weekly: { events: 3, totalJoins: 214, bestEvent: "Friday Night Border Patrol", avgScore: 73, advice: "3 events, 214 joins, avg score 73 — your best week this month." },
};

/* ---- KPI color helper ---- */
function kpiClass(metric, value) {
  const v = safeNum(value);
  if (metric === "joins")   return v >= 30 ? "kpi-good" : v >= 10 ? "kpi-warn" : "kpi-bad";
  if (metric === "session") return v >= 40 ? "kpi-good" : v >= 20 ? "kpi-warn" : "kpi-bad";
  if (metric === "retPct")  return v >= 50 ? "kpi-good" : v >= 25 ? "kpi-warn" : "kpi-bad";
  if (metric === "staff")   return v >= 3  ? "kpi-good" : v >= 1  ? "kpi-warn" : "kpi-bad";
  return "";
}

/* =========================================================================
   MAIN RENDER
   ========================================================================= */
export function renderReport(el, r) {
  const plan = r.plan || "free";
  const rank = planRank(plan);
  const staffLeaderboard = r.staff?.leaderboard || [];
  const f = r.forecast || (rank < 2 ? T.forecast : null);
  const bm = r.benchmark || (rank < 1 ? T.benchmark : null);

  /* low-data threshold banner (real report with minimal player count) */
  const isLowData = !r.isExemplar && safeNum(r.joinsInWindow) < 5;
  const thresholdBanner = isLowData ? `
    <div class="rep-threshold-banner">
      <div>
        <b>Your server didn't reach the minimum session threshold</b>
        <p>At least 5 players are needed to generate a full report. The metrics below show what your report would look like with a fuller session — run another event to get live data.</p>
      </div>
    </div>` : "";

  /* ---- analytics section (Pro tier) ---- */
  const analytics = [
    box("Health Score", `
      <div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap">
        ${dial(safeNum(r.score, 78))}
        <div style="flex:1;min-width:180px">
          <p style="font-size:.9rem">One number combining fill rate, retention, growth, conversion and staffing. ${momentumBadge(r.momentum)}</p>
          ${advicePill("This is the number hosts compete on — and the headline of your share card.")}
        </div>
      </div>`, { tier: "pro", userPlan: plan, kicker: "Post-event analytics" }),

    box("Player lifecycle funnel", `
      <p style="font-size:.85rem;margin-bottom:14px;color:var(--muted)">Where players were won and lost across the event window.</p>
      ${funnel(r.funnel || { views: 820, reveals: 64, entries: 87, retained30: 49 })}
      <p class="note" style="margin-top:14px">View-to-entry conversion: <b style="color:var(--text)">${safeNum(r.conversionPct, 4.2)}%</b></p>`,
      { tier: "pro", userPlan: plan, kicker: "Funnel analytics" }),

    box("Players over the window", `
      <p style="font-size:.85rem;margin-bottom:14px;color:var(--muted)">Concurrent players rebuilt from verified join and leave logs.</p>
      ${timeline(r.timeline)}`, { tier: "pro", userPlan: plan }),

    box("Scenario benchmark", `
      <p style="font-size:.9rem;margin-top:4px;color:var(--muted)">Against <b style="color:var(--text)">${bm?.cohortSize ?? 23}</b> ${esc(r.scenario || "same-scenario")} events on Gatherly:</p>
      <div class="grid grid-2" style="margin-top:14px">
        ${miniStat((bm?.peakPercentile ?? 71) + "th", "Percentile — peak concurrent")}
        ${miniStat((bm?.sessionPercentile ?? 84) + "th", "Percentile — session length")}
      </div>
      <p class="note" style="margin-top:12px">Platform avg session: <b>${bm?.platformAvgSessionMin ?? 43}m</b>. Yours: <b style="color:var(--text)">${safeNum(r.avgSessionMin, 61)}m</b>.</p>`,
      { tier: "pro", userPlan: plan, kicker: "Scenario benchmarking" }),

    box("Scenario DNA", (() => {
      const d = r.scenarioDNA || T.scenarioDNA;
      const rows = d.scenarios.slice(0, 5).map((s) => `<tr><td>${esc(s.scenario)}</td><td>${s.runs}</td><td>${s.avgScore}/100</td><td>${s.avgRetention}%</td></tr>`).join("");
      return `<table class="tbl"><thead><tr><th>Scenario</th><th>Runs</th><th>Avg score</th><th>30m retention</th></tr></thead><tbody>${rows}</tbody></table>${advicePill(d.advice)}`;
    })(), { tier: "pro", userPlan: plan, kicker: "Scenario history" }),

    box("Scenario fatigue index", (() => {
      const d = r.scenarioFatigue || T.scenarioFatigue;
      return `<div class="grid grid-2" style="margin-bottom:8px">${miniStat(d.avgScoreEarly + "/100", "Early-run avg score")}${miniStat(d.avgScoreRecent + "/100", "Recent-run avg score")}</div>${advicePill(d.advice)}`;
    })(), { tier: "pro", userPlan: plan, accent: (r.scenarioFatigue || T.scenarioFatigue).fatigued ? "var(--bad)" : "var(--good)" }),

    box("Dead hour detection", `
      <p style="font-size:.88rem;color:var(--muted)">A period of near-zero activity is scanned for across the full window.</p>
      ${advicePill((r.deadHour || T.deadHour).advice)}`,
      { tier: "pro", userPlan: plan, accent: "var(--live)" }),

    box("Loyalty tracker", (() => {
      const d = r.loyaltyTracker || T.loyaltyTracker;
      return `<div class="grid grid-3" style="margin-bottom:8px">${miniStat(d.returningPlayers, "Returning players")}${miniStat(d.newPlayers, "New players")}${miniStat(d.returningRate + "%", "Return rate")}</div>${advicePill(d.advice)}`;
    })(), { tier: "pro", userPlan: plan }),

    box("Staff ratio alerts", `
      <p style="font-size:.88rem;color:var(--muted)">Live player-to-staff ratio tracked across the event.</p>
      ${advicePill((r.staffRatioAlert || T.staffRatioAlert).advice)}`,
      { tier: "pro", userPlan: plan, accent: "var(--live)" }),

    box("Best-time-to-host heatmap", heatmap(r.bestTimeHeatmap), { tier: "pro", userPlan: plan }),

    box("Discord webhook delivery", deliveryRow(!!r.delivery?.webhook, "Report posted to your server webhook", "Auto-delivered to your staff channel the moment the report compiles."),
      { tier: "pro", userPlan: plan }),
  ].join("");

  /* ---- ultra intelligence section ---- */
  const ultra = [
    box("AI-generated report summary", `
      <div class="ai-summary" style="margin:0">
        <div class="tag">Gatherly insight &middot; generated by Gatherly AI</div>
        <p>${esc(r.aiSummary || "This was your strongest border patrol in a month: 87 joins against a projected 55 to 70, peak concurrency of 42 filling 84% of the server, and 49 players retained past 30 minutes. The weak point sits at the top of the funnel — only 64 of 820 viewers revealed the code. Hold the Friday 7pm slot and refresh the banner.")}</p>
      </div>`,
      { tier: "ultra", userPlan: plan }),

    box("Predictive forecasting", `
      <p style="font-size:.9rem;color:var(--muted)">Projected from your last ${f?.basedOnEvents ?? 4} reported events:</p>
      <div class="grid grid-2" style="margin-top:14px">
        ${miniStat(`${(f?.projectedJoins || [55, 70])[0]}–${(f?.projectedJoins || [55, 70])[1]}`, "Projected joins next event")}
        ${miniStat(`${(f?.projectedPeak || [38, 45])[0]}–${(f?.projectedPeak || [38, 45])[1]}`, "Projected peak concurrent")}
      </div>
      <p class="note" style="margin-top:10px">Confidence: <b>${esc(f?.confidence || "medium")}</b></p>`,
      { tier: "ultra", userPlan: plan }),

    box("Villain detection", (() => {
      const d = r.villainDetection || T.villainDetection;
      const rows = d.disruptors.map((x) => `<tr><td>${esc(x.player)}</td><td>${x.timesKilled}</td><td>${x.staffActed ? `<span style="color:var(--good)">Actioned</span>` : `<span style="color:var(--bad)">Not actioned</span>`}</td></tr>`).join("");
      return `<table class="tbl"><thead><tr><th>Player</th><th>Times killed</th><th>Staff response</th></tr></thead><tbody>${rows}</tbody></table>${advicePill(d.advice)}`;
    })(), { tier: "ultra", userPlan: plan, accent: "var(--bad)" }),

    box("Ghost staff detection", (() => {
      const d = r.ghostStaff || T.ghostStaff;
      return `<p style="font-size:.88rem">Staff online with zero commands issued: <b style="color:var(--text)">${d.ghosts.map((g) => esc(g.name)).join(", ")}</b></p>${advicePill(d.advice)}`;
    })(), { tier: "ultra", userPlan: plan, accent: "var(--live)" }),

    box("Staff fatigue score", (() => {
      const d = r.staffFatigue || T.staffFatigue;
      return `<div class="grid grid-2" style="margin-bottom:8px">${miniStat(d.firstHalfAvgResponseMin + "m", "First-half avg response")}${miniStat(d.secondHalfAvgResponseMin + "m", "Second-half avg response")}</div>${advicePill(d.advice)}`;
    })(), { tier: "ultra", userPlan: plan, accent: (r.staffFatigue || T.staffFatigue).fatigued ? "var(--bad)" : "var(--good)" }),

    box("Queue intelligence", (() => {
      const d = r.queueIntelligence || T.queueIntelligence;
      return `<div class="grid grid-2" style="margin-bottom:8px">${miniStat(d.peakQueue, "Peak queue length")}${miniStat(d.estimatedLost, "Est. players lost to queue")}</div>${advicePill(d.advice)}`;
    })(), { tier: "ultra", userPlan: plan }),

    box("Golden hour analysis", (() => {
      const d = r.goldenHour || T.goldenHour;
      return `<p style="font-size:.88rem">Best retention window: minute <b style="color:var(--text)">${d.bestWindowStart}</b> to <b style="color:var(--text)">${d.bestWindowEnd}</b> — <b style="color:var(--good)">${d.retentionRate}%</b> retention rate.</p>${advicePill(d.advice)}`;
    })(), { tier: "ultra", userPlan: plan, accent: "var(--good)" }),

    box("Moderation pressure map", (() => {
      const d = r.moderationPressureMap || T.moderationPressureMap;
      return `<div class="grid grid-3" style="margin-bottom:8px">${miniStat(d.early, "Early mod calls")}${miniStat(d.mid, "Mid-event mod calls")}${miniStat(d.late, "Late mod calls")}</div>${advicePill(d.advice)}`;
    })(), { tier: "ultra", userPlan: plan }),

    box("Server health trend line", (() => {
      const d = r.healthTrend || T.healthTrend;
      const dots = d.scores.map((s) => `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px"><div style="width:10px;height:10px;border-radius:50%;background:${scoreColor(s)}"></div><span style="font-size:.65rem;color:var(--muted)">${s}</span></div>`).join("");
      return `<div style="display:flex;align-items:flex-end;gap:3px;margin-bottom:8px">${dots}</div>${advicePill(d.advice)}`;
    })(), { tier: "ultra", userPlan: plan, accent: (r.healthTrend || T.healthTrend).trend === "declining" ? "var(--bad)" : "var(--good)" }),

    box("Tipping point analysis", (() => {
      const d = r.tippingPoint || T.tippingPoint;
      return `<div class="grid grid-2" style="margin-bottom:8px">${miniStat(d.avgSessionBelow + "m", "Avg session below 20 players")}${miniStat(d.avgSessionAbove + "m", "Avg session above 20 players")}</div>${advicePill(d.advice)}`;
    })(), { tier: "ultra", userPlan: plan }),

    box("Weekly performance report", (() => {
      const d = r.weeklyReport || T.weekly;
      return `<div class="grid grid-3" style="margin-bottom:8px">${miniStat(d.events, "Events this week")}${miniStat(d.totalJoins, "Total joins")}${miniStat(d.avgScore + "/100", "Avg health score")}</div><p class="note" style="margin-top:6px">Best event: <b style="color:var(--text)">${esc(d.bestEvent)}</b></p>${advicePill(d.advice)}`;
    })(), { tier: "ultra", userPlan: plan }),

    box("Bot DM report delivery", `${deliveryRow(!!r.delivery?.dm, "Report DM'd to you by the Gatherly bot", "A private copy lands in your Discord DMs the moment the report compiles.")}${deliveryRow(!!r.delivery?.recipient, "Extra recipient DM", "Send a copy to a co-owner or staff lead automatically.")}`,
      { tier: "ultra", userPlan: plan }),
  ].join("");

  /* ---- staff intelligence block ---- */
  const staffInner = `
    <div class="grid grid-4" style="margin:14px 0 18px">
      ${miniStat(safeNum(r.staff?.online?.length ?? r.staffOnline, 9), "Staff online")}
      ${miniStat(r.staff?.estimatedResponseMin != null && r.staff?.estimatedResponseMin !== "N/A" ? r.staff.estimatedResponseMin + "m" : "2.4m", "Avg mod response")}
      ${miniStat(safeNum(r.staff?.modCalls ?? r.modCalls, 4), "Mod calls")}
      ${miniStat(safeNum(r.staff?.kills ?? r.kills, 11), "Kills in window")}
    </div>
    ${staffLeaderboard.length ? `
      <table class="tbl"><thead><tr><th>Staff member</th><th>Permission</th><th>Team</th><th>Commands</th></tr></thead>
      <tbody>${staffLeaderboard.map((s) => `<tr><td>${esc(s.name || "Unknown")}</td><td>${esc(s.permission || "Staff")}</td><td>${esc(s.team || "Unknown")}</td><td>${safeNum(s.moderations ?? s.commands)}</td></tr>`).join("")}</tbody></table>`
    : `<p class="note">No staff commands recorded in the window. Staff are detected by Moderator permissions or above.</p>`}`;

  const staffCollapsible = `
  <details class="card rep-box" style="margin-bottom:0">
    <summary>
      <div class="rep-sum-left"><h3>Staff intelligence</h3></div>
      <span class="rep-sum-icon">${I.users}</span>
      <span class="rep-sum-arrow">&#9660;</span>
    </summary>
    <div class="rep-box-body">${staffInner}</div>
  </details>`;

  /* ---- upsell band ---- */
  let upsell = "";
  if (rank === 0) {
    upsell = `<div class="rep-upsell-v2 pro-upsell">
      <div>
        <div class="upsell-eyebrow">You're on Gatherly Free</div>
        <h3 style="margin:4px 0 6px">Unlock every blurred section above</h3>
        <p style="font-size:.9rem">Upgrade once and all Pro &amp; Ultra analytics fill in on every future report automatically.</p>
      </div>
      <a class="btn btn-primary" href="/pricing" style="white-space:nowrap;flex-shrink:0">See plans &amp; unlock</a>
    </div>`;
  } else if (rank === 1) {
    upsell = `<div class="rep-upsell-v2 ultra-upsell">
      <div>
        <div class="upsell-eyebrow">One tier from the full picture</div>
        <h3 style="margin:4px 0 6px">Unlock AI summaries, forecasting &amp; the full intelligence suite</h3>
        <p style="font-size:.9rem">Gatherly Ultra fills in villain detection, staff fatigue, golden hour analysis and 8 more on every report.</p>
      </div>
      <a class="btn btn-primary" href="/pricing" style="white-space:nowrap;flex-shrink:0;background:linear-gradient(135deg,#d97706,#fbbf24);color:#0c0c0f">Unlock Ultra →</a>
    </div>`;
  } else {
    upsell = `<div class="rep-upsell-v2 streak-upsell">
      <div>
        <div class="upsell-eyebrow">Keep the streak going</div>
        <h3 style="margin:4px 0 6px">Your next event already has a forecast</h3>
        <p style="font-size:.9rem">${esc(r.nextForecastTease || "List your next session to keep your health trend climbing and your forecasting sharp.")}</p>
      </div>
      <a class="btn btn-primary" href="/advertise" style="white-space:nowrap;flex-shrink:0">List your next event</a>
    </div>`;
  }

  /* ---- hero ---- */
  const score = safeNum(r.score, 78);
  const peakConc = safeNum(r.peakConcurrent, 42);
  const maxPlayers = safeNum(r.maxPlayers, 50);
  const retained = safeNum(r.retained30, 49);
  const joins = safeNum(r.joinsInWindow, 87);
  const retPct = Math.min(100, Math.round((retained / Math.max(joins, 1)) * 100));
  const planBadge = rank === 2 ? `<span class="badge rep-tier-badge rep-tier-ultra">Ultra</span>` : rank === 1 ? `<span class="badge rep-tier-badge rep-tier-pro">Pro</span>` : `<span class="badge">Free</span>`;

  const hero = `
  <div class="whoop-hero">
    <div class="whoop-hero-top">
      <div class="whoop-event-meta">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
          ${planBadge}${momentumBadge(r.momentum)}
          <span class="badge">Verified via ER:LC API</span>
          ${r.delivery?.dm ? `<span class="badge badge-good">DM sent</span>` : ""}
          ${r.delivery?.webhook ? `<span class="badge badge-good">Webhook sent</span>` : ""}
        </div>
        <h3>${esc(r.eventTitle || "Event")}</h3>
        <p>${esc(r.serverName || "Server")} &middot; ${esc(r.scenario || "")} &middot; ${fmtLocal(r.windowStart)}&ndash;${new Date(r.windowEnd).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
      </div>
    </div>

    <div class="whoop-rings">
      ${whoopRing(score, 100, scoreColor(score), "Health Score")}
      ${whoopRing(peakConc, maxPlayers || 50, "var(--signal)", "Peak / Slots")}
      ${whoopRing(retPct, 100, "var(--live)", "30m Retention", "%")}
    </div>

    <div class="whoop-kpi-strip">
      <div class="whoop-kpi">
        <b class="${kpiClass("joins", joins)}">${joins}</b>
        <span>Joins in window</span>
        <div class="whoop-kpi-def">Players who entered during the session</div>
      </div>
      <div class="whoop-kpi">
        <b>${safeNum(r.uniquePlayers, 71)}</b>
        <span>Unique players</span>
        <div class="whoop-kpi-def">Individual accounts, no duplicates</div>
      </div>
      <div class="whoop-kpi">
        <b class="${kpiClass("session", safeNum(r.avgSessionMin, 61))}">${safeNum(r.avgSessionMin, 61)}m</b>
        <span>Avg session</span>
        <div class="whoop-kpi-def">Mean time each player stayed in-server</div>
      </div>
      <div class="whoop-kpi">
        <b class="${kpiClass("retPct", retPct)}">${retained}</b>
        <span>Retained 30m+</span>
        <div class="whoop-kpi-def">Players who stayed past the 30-min mark</div>
      </div>
      <div class="whoop-kpi">
        <b class="${kpiClass("staff", safeNum(r.staffOnline ?? r.staff?.online?.length, 9))}">${safeNum(r.staffOnline ?? r.staff?.online?.length, 9)}</b>
        <span>Staff online</span>
        <div class="whoop-kpi-def">Members with Mod+ permissions active</div>
      </div>
      <div class="whoop-kpi" style="padding-right:0">
        <button class="btn btn-ghost btn-sm" id="shareCardBtn" style="margin-top:4px">Share card</button>
      </div>
    </div>
  </div>`;

  /* ---- assemble ---- */
  el.innerHTML = `
  ${thresholdBanner}
  ${hero}

  ${sectionHeader("Analytics", "Post-event analytics · Gatherly Pro & Ultra")}
  <div class="rep-details-stack">${analytics}</div>

  ${sectionHeader("Ultra Intelligence", "Deep-signal layer · Gatherly Ultra")}
  <div class="rep-details-stack">${ultra}</div>

  <div style="margin:26px 0 18px">${staffCollapsible}</div>

  ${upsell}

  <div class="card rep-box" style="margin-top:18px;font-size:.78rem;color:var(--muted);border:1px solid rgba(180,180,210,.1)">
    <b>Disclaimer:</b> ${esc(r.disclaimer || "Some data points rely on ER:LC API logs which may have a short delay. Staff detection includes all players with Moderator permissions or above. Locked panels show representative sample data until unlocked.")}
  </div>

  <div style="margin-top:14px;font-size:.72rem;color:var(--faint);text-align:right">${esc(r.generatedBy || "Gatherly · gatherly.app")}</div>
  ${renderChatUI()}`;

  el.querySelector("#shareCardBtn")?.addEventListener("click", () => downloadShareCard(r));
  initChat(r);
}

/* ---- share card ---- */
export function downloadShareCard(r) {
  const c = document.createElement("canvas");
  c.width = 1200; c.height = 630;
  const x = c.getContext("2d");

  /* background */
  x.fillStyle = "#0b0b0f"; x.fillRect(0, 0, 1200, 630);
  const grd = x.createRadialGradient(200, 180, 0, 200, 180, 500);
  grd.addColorStop(0, "rgba(79,70,229,0.18)"); grd.addColorStop(1, "transparent");
  x.fillStyle = grd; x.fillRect(0, 0, 1200, 630);

  /* decorative rings (right side) */
  x.strokeStyle = "rgba(180,180,210,.1)";
  x.lineWidth = 1;
  [90, 170, 250].forEach((rr) => { x.beginPath(); x.arc(1010, 315, rr, 0, 7); x.stroke(); });

  /* Gatherly watermark — top right */
  x.fillStyle = "rgba(180,180,210,0.5)";
  x.font = "500 18px sans-serif";
  x.textAlign = "right";
  x.fillText("gatherly.app", 1180, 42);
  /* small dot before the URL */
  x.fillStyle = "#818cf8";
  x.beginPath(); x.arc(1180 - x.measureText("gatherly.app").width - 10, 36, 4, 0, 7); x.fill();

  /* header */
  x.fillStyle = "#818cf8"; x.font = "700 20px sans-serif"; x.textAlign = "left";
  x.fillText("ENGAGEMENT REPORT", 70, 72);

  /* title */
  x.fillStyle = "#eeeef2"; x.font = "600 52px sans-serif";
  x.fillText(String(r.eventTitle || "Event").slice(0, 28), 70, 150);

  /* subtitle */
  x.fillStyle = "#9090a8"; x.font = "400 24px sans-serif";
  x.fillText(`${r.serverName || "Server"} · ${r.scenario || ""}`, 70, 192);

  /* score ring */
  const col = safeNum(r.score) >= 70 ? "#4ade80" : safeNum(r.score) >= 45 ? "#818cf8" : "#f87171";
  x.strokeStyle = "rgba(180,180,210,.2)"; x.lineWidth = 16;
  x.beginPath(); x.arc(1010, 315, 110, 0, 7); x.stroke();
  x.strokeStyle = col; x.lineCap = "round"; x.lineWidth = 16;
  x.beginPath(); x.arc(1010, 315, 110, -Math.PI / 2, -Math.PI / 2 + (safeNum(r.score) / 100) * 2 * Math.PI); x.stroke();
  x.fillStyle = col; x.font = "600 82px sans-serif"; x.textAlign = "center";
  x.fillText(String(safeNum(r.score)), 1010, 338);
  x.fillStyle = "#9090a8"; x.font = "500 20px sans-serif";
  x.fillText("HEALTH SCORE", 1010, 375);

  /* stats grid */
  x.textAlign = "left";
  const stats = [
    [safeNum(r.joinsInWindow), "Joins in window"],
    [safeNum(r.peakConcurrent), "Peak concurrent"],
    [`${safeNum(r.avgSessionMin)}m`, "Avg session length"],
    [safeNum(r.retained30), "Retained 30m+"],
  ];
  stats.forEach(([v, l], i) => {
    const sx = 70 + (i % 2) * 340, sy = 310 + Math.floor(i / 2) * 120;
    x.fillStyle = "#eeeef2"; x.font = "600 54px sans-serif"; x.fillText(String(v), sx, sy);
    x.fillStyle = "#9090a8"; x.font = "400 22px sans-serif"; x.fillText(l, sx, sy + 34);
  });

  /* bottom bar */
  x.fillStyle = "rgba(180,180,210,0.08)"; x.fillRect(0, 590, 1200, 40);
  x.fillStyle = "#58586a"; x.font = "400 18px sans-serif"; x.textAlign = "left";
  x.fillText("Verified via the official ER:LC API · gatherly.app", 70, 614);
  x.textAlign = "right";
  x.fillStyle = "#818cf8";
  x.fillText("Gatherly Engagement Reports", 1130, 614);

  const a = document.createElement("a");
  a.download = `gatherly-report-${(r.eventTitle || "event").replace(/\W+/g, "-").toLowerCase()}.png`;
  a.href = c.toDataURL("image/png");
  a.click();
}

/* =========================================================================
   AI CHAT
   ========================================================================= */
function renderChatUI() {
  return `
  <button class="ai-fab" id="aiFab" title="Ask the AI analyst">
    <div class="ai-fab-badge"></div>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  </button>
  <div class="ai-panel" id="aiPanel">
    <div class="ai-panel-head">
      <div class="ai-orb">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>
        </svg>
      </div>
      <div class="ai-panel-head-text">
        <b>Gatherly AI</b>
        <span>Ask about your report data</span>
      </div>
      <button class="ai-panel-close" id="aiClose" aria-label="Close">&#10005;</button>
    </div>
    <div class="ai-messages" id="aiMessages">
      <div class="ai-msg ai-msg-bot">Hey — I have your full report loaded. Ask me anything about your session stats, staff, or what to improve next time.</div>
    </div>
    <div class="ai-input-row">
      <input class="ai-input" id="aiInput" placeholder="What should I improve next event?" autocomplete="off">
      <button class="ai-send" id="aiSend" aria-label="Send">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
      </button>
    </div>
  </div>`;
}

export function initChat(reportData) {
  const fab = document.getElementById("aiFab");
  const panel = document.getElementById("aiPanel");
  const closeBtn = document.getElementById("aiClose");
  const input = document.getElementById("aiInput");
  const sendBtn = document.getElementById("aiSend");
  const messages = document.getElementById("aiMessages");
  if (!fab || !panel) return;

  const history = [];

  fab.addEventListener("click", () => { panel.classList.toggle("open"); if (panel.classList.contains("open")) input?.focus(); });
  closeBtn?.addEventListener("click", () => panel.classList.remove("open"));

  async function send() {
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    appendMsg(text, "user");
    history.push({ role: "user", content: text });
    const thinking = appendMsg("…", "bot");
    sendBtn.disabled = true;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, report: reportData, history: history.slice(-8) }),
      });
      const d = await res.json();
      const reply = d.reply || d.error || "Something went wrong.";
      thinking.textContent = reply;
      history.push({ role: "assistant", content: reply });
    } catch { thinking.textContent = "Couldn't reach the AI — check your connection."; }
    sendBtn.disabled = false;
  }

  sendBtn?.addEventListener("click", send);
  input?.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });

  function appendMsg(text, who) {
    const d = document.createElement("div");
    d.className = `ai-msg ai-msg-${who}`;
    d.textContent = text;
    messages.appendChild(d);
    messages.scrollTop = messages.scrollHeight;
    return d;
  }
}
