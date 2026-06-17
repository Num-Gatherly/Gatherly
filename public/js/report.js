// Renders a full Gatherly engagement report into a container.
//
// Every report renders ALL analytics + ultra-intelligence boxes. Boxes above the
// viewer's plan are blurred with an upgrade prompt that links to /pricing, so a
// free or pro host always sees the full Ultra report and exactly what they unlock
// by upgrading. The /reports sample is rendered as the exemplar Ultra Report.
import { esc, fmtLocal, planRank } from "/js/app.js";

const scoreColor = (s) => (s >= 70 ? "var(--good,#69d99c)" : s >= 45 ? "var(--signal)" : "var(--bad,#ff7a7a)");
const safeNum = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/* --------------------------------------------------------------------------
   Plan gating. Each box declares the tier it belongs to; if the viewer's plan
   is below that tier we blur the box and drop an upgrade prompt over it.
   -------------------------------------------------------------------------- */
const PLAN_DISPLAY = { pro: "Gatherly Pro", ultra: "Gatherly Ultra" };
const lockIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`;

function box(title, bodyHtml, opts = {}) {
  const { tier, userPlan, accent, kicker } = opts;
  const head = `${kicker ? `<div class="rep-kick">${esc(kicker)}</div>` : ""}${title ? `<h3>${title}</h3>` : ""}`;
  const styleAttr = accent ? ` style="border-left:3px solid ${accent}"` : "";
  const locked = tier && planRank(userPlan) < planRank(tier);
  if (!locked) return `<div class="card rep-box"${styleAttr}>${head}${bodyHtml}</div>`;
  const name = PLAN_DISPLAY[tier] || "Gatherly Pro";
  return `<div class="card rep-box locked"${styleAttr}>
    <div class="locked-inner">${head}${bodyHtml}</div>
    <div class="locked-overlay">
      <span class="lock-badge">${lockIcon} ${esc(name)}</span>
      <div class="lock-title">Unlock ${esc((title || "this insight").replace(/<[^>]+>/g, ""))}</div>
      <div class="lock-sub">Part of your ${esc(name)} analytics. Upgrade once and it's filled in on every report you run from now on.</div>
      <a class="btn btn-primary btn-sm" href="/pricing">Unlock with ${esc(name)}</a>
    </div>
  </div>`;
}

const sectionHeader = (label, sub) => `
  <div class="rep-section-head">
    <h2 class="rep-section-title">${esc(label)}</h2>
    ${sub ? `<p class="rep-section-sub">${esc(sub)}</p>` : ""}
  </div>`;

/* ------------------------------- visuals --------------------------------- */
function dial(score) {
  const r = 70, c = 2 * Math.PI * r, off = c * (1 - score / 100);
  return `
  <div class="score-dial">
    <svg viewBox="0 0 170 170" width="170" height="170">
      <circle cx="85" cy="85" r="${r}" fill="none" stroke="var(--line-strong)" stroke-width="10"/>
      <circle cx="85" cy="85" r="${r}" fill="none" stroke="${scoreColor(score)}" stroke-width="10"
        stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${off}"/>
    </svg>
    <div class="val"><b style="color:${scoreColor(score)}">${score}</b><span>Health Score</span></div>
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
  return `
    <div style="overflow:hidden;width:100%">
      <div style="display:flex;align-items:flex-end;gap:4px;height:120px;padding-bottom:24px;box-sizing:border-box;overflow:hidden">
        ${points.map((p) => {
          const h = Math.max(4, (safeNum(p.n) / max) * 96);
          const label = new Date(p.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;min-width:0">
            <div style="width:100%;height:${h}px;background:linear-gradient(180deg,var(--signal),var(--signal-deep,#3e6ce0));border-radius:4px 4px 0 0" title="${safeNum(p.n)} players"></div>
            <div style="font-size:.55rem;color:var(--muted);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;text-align:center">${label}</div>
          </div>`;
        }).join("")}
      </div>
    </div>`;
}

// Best-time-to-host heatmap: 7 days x 24 hours, hotter = better historical turnout.
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
function genHeat() {
  // Plausible "evenings + weekends are hottest" pattern for the sample / locked teaser.
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
          return `<i style="background:rgba(127,168,255,${(0.06 + a * 0.94).toFixed(2)})" title="${DAYS[d]} ${hourLbl(h)} — ${Math.round(a * 100)}% turnout index"></i>`;
        }).join("")}
      </div>
    </div>`).join("");
  return `
    <div class="heatmap-7">${rows}
      <div class="heat-row heat-axis"><span class="heat-day"></span><div class="heat-cells">
        ${[0, 6, 12, 18, 23].map((h) => `<span style="grid-column:${h + 1}">${hourLbl(h)}</span>`).join("")}
      </div></div>
    </div>
    <p class="note" style="margin-top:12px">Hottest slot: <b style="color:var(--signal)">${DAYS[best.d]} ${hourLbl(best.h)}</b>. Listing in this window historically fills fastest.</p>`;
}

const momentumBadge = (m) => !m ? "" : m.direction === "up"
  ? `<span class="badge badge-good">Trending up +${m.changePct}%</span>`
  : m.direction === "down" ? `<span class="badge badge-bad">Declining ${m.changePct}%</span>` : `<span class="badge">Stable</span>`;

function advicePill(text) {
  return `<p class="note" style="margin-top:8px;padding:8px 12px;background:rgba(127,168,255,.07);border-radius:8px;border-left-color:var(--signal)">${esc(text)}</p>`;
}
const miniStat = (v, l) => `<div class="stat"><b>${v}</b><span>${esc(l)}</span></div>`;
const deliveryRow = (on, label, sub) => `
  <div class="delivery-row">
    <span class="del-dot ${on ? "on" : ""}"></span>
    <div><b style="color:var(--text)">${esc(label)}</b><div class="note" style="margin:2px 0 0;border:0;padding:0">${esc(sub)}</div></div>
    <span class="badge ${on ? "badge-good" : ""}" style="margin-left:auto">${on ? "Delivered" : "Ready"}</span>
  </div>`;

/* ----------------------- teaser fallbacks (for blurred boxes) ------------- */
const T = {
  scenarioDNA: { scenarios: [{ scenario: "Border patrol", runs: 9, avgScore: 74, avgRetention: 61 }, { scenario: "Bank heist", runs: 6, avgScore: 68, avgRetention: 54 }, { scenario: "Traffic enforcement", runs: 5, avgScore: 71, avgRetention: 58 }], advice: "Border patrol is your strongest format — schedule it on your highest-traffic night." },
  scenarioFatigue: { avgScoreEarly: 79, avgScoreRecent: 64, fatigued: true, advice: "Scores are sliding over repeats. Rotate in a fresh scenario before the next run." },
  deadHour: { advice: "A near-empty 18 minute stretch was detected mid-event. Pre-announce the join code 10 minutes earlier next time." },
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

/* =========================================================================
   MAIN RENDER
   ========================================================================= */
export function renderReport(el, r) {
  const plan = r.plan || "free";
  const staffLeaderboard = r.staff?.leaderboard || [];
  const f = r.forecast || (planRank(plan) < 2 ? T.forecast : null);
  const bm = r.benchmark || (planRank(plan) < 1 ? T.benchmark : null);

  /* ---- ANALYTICS section (Pro tier) ---- */
  const analytics = [
    box("Health Score", `
      <div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap">
        ${dial(safeNum(r.score, 78))}
        <div style="flex:1;min-width:180px">
          <p style="font-size:.9rem">One number scoring fill rate, retention, growth, conversion and staffing. ${momentumBadge(r.momentum)}</p>
          ${advicePill("This is the number hosts compete on — and the headline of every share card.")}
        </div>
      </div>`, { tier: "pro", userPlan: plan, kicker: "Post-event analytics report" }),

    box("Player lifecycle funnel", `
      <p style="font-size:.85rem;margin-bottom:14px">Where players were won and lost across the event.</p>
      ${funnel(r.funnel || { views: 820, reveals: 64, entries: 87, retained30: 49 })}
      <p class="note" style="margin-top:14px">View-to-entry conversion: <b style="color:var(--text)">${safeNum(r.conversionPct, 4.2)}%</b></p>`,
      { tier: "pro", userPlan: plan, kicker: "Funnel analytics" }),

    box("Players over the window", `
      <p style="font-size:.85rem;margin-bottom:14px">Concurrent players rebuilt from verified join and leave logs.</p>
      ${timeline(r.timeline)}`, { tier: "pro", userPlan: plan }),

    box("Scenario benchmark", `
      <p style="font-size:.9rem;margin-top:4px">Against <b style="color:var(--text)">${bm?.cohortSize ?? 23}</b> ${esc(r.scenario || "same-scenario")} events on Gatherly:</p>
      <div class="grid grid-2" style="margin-top:14px">
        ${miniStat((bm?.peakPercentile ?? 71) + "th", "Percentile peak concurrent")}
        ${miniStat((bm?.sessionPercentile ?? 84) + "th", "Percentile session length")}
      </div>
      <p class="note" style="margin-top:12px">Platform avg session: ${bm?.platformAvgSessionMin ?? 43}m. Yours: ${safeNum(r.avgSessionMin, 61)}m.</p>`,
      { tier: "pro", userPlan: plan, kicker: "Scenario benchmarking" }),

    box("Scenario DNA", (() => {
      const d = r.scenarioDNA || T.scenarioDNA;
      const rows = d.scenarios.slice(0, 5).map((s) => `<tr><td>${esc(s.scenario)}</td><td>${s.runs}</td><td>${s.avgScore}/100</td><td>${s.avgRetention}%</td></tr>`).join("");
      return `<table class="tbl"><thead><tr><th>Scenario</th><th>Runs</th><th>Avg score</th><th>Avg retention</th></tr></thead><tbody>${rows}</tbody></table>${advicePill(d.advice)}`;
    })(), { tier: "pro", userPlan: plan, kicker: "Scenario DNA + fatigue index" }),

    box("Scenario fatigue index", (() => {
      const d = r.scenarioFatigue || T.scenarioFatigue;
      return `<div class="grid grid-2" style="margin-bottom:8px">${miniStat(d.avgScoreEarly + "/100", "Early avg score")}${miniStat(d.avgScoreRecent + "/100", "Recent avg score")}</div>${advicePill(d.advice)}`;
    })(), { tier: "pro", userPlan: plan, accent: (r.scenarioFatigue || T.scenarioFatigue).fatigued ? "var(--bad)" : "var(--good)" }),

    box("Dead hour detection", `<p style="font-size:.88rem">A period of near-zero activity was scanned for across the window.</p>${advicePill((r.deadHour || T.deadHour).advice)}`,
      { tier: "pro", userPlan: plan, accent: "var(--live)" }),

    box("Loyalty tracker", (() => {
      const d = r.loyaltyTracker || T.loyaltyTracker;
      return `<div class="grid grid-3" style="margin-bottom:8px">${miniStat(d.returningPlayers, "Returning")}${miniStat(d.newPlayers, "New")}${miniStat(d.returningRate + "%", "Return rate")}</div>${advicePill(d.advice)}`;
    })(), { tier: "pro", userPlan: plan }),

    box("Staff ratio alerts", `<p style="font-size:.88rem">Live player-to-staff ratio is tracked across the event.</p>${advicePill((r.staffRatioAlert || T.staffRatioAlert).advice)}`,
      { tier: "pro", userPlan: plan, accent: "var(--live)" }),

    box("Best-time-to-host heatmap", heatmap(r.bestTimeHeatmap), { tier: "pro", userPlan: plan }),

    box("Discord webhook delivery", deliveryRow(!!r.delivery?.webhook, "Report posted to your server webhook", "Auto-delivered to your staff channel the moment the report compiles."),
      { tier: "pro", userPlan: plan }),
  ].join("");

  /* ---- ULTRA INTELLIGENCE section (Ultra tier) ---- */
  const ultra = [
    box("AI-generated report summary", `<div class="ai-summary" style="margin:0"><div class="tag">Gatherly insight &middot; generated by Gatherly API</div><p>${esc(r.aiSummary || "This was your strongest border patrol in a month: 87 joins against a projected 55 to 70, peak concurrency of 42 filling 84% of the server, and 49 players retained past 30 minutes. The weak point sits at the top of the funnel — only 64 of 820 viewers revealed the code. Hold the Friday 7pm slot and refresh the banner.")}</p></div>`,
      { tier: "ultra", userPlan: plan }),

    box("Predictive forecasting", `
      <p style="font-size:.9rem;margin-top:4px">Projected from your last ${f?.basedOnEvents ?? 4} reported events:</p>
      <div class="grid grid-2" style="margin-top:14px">
        ${miniStat(`${(f?.projectedJoins || [55, 70])[0]}-${(f?.projectedJoins || [55, 70])[1]}`, "Projected joins")}
        ${miniStat(`${(f?.projectedPeak || [38, 45])[0]}-${(f?.projectedPeak || [38, 45])[1]}`, "Projected peak")}
      </div>
      <p class="note" style="margin-top:10px">Confidence: ${esc(f?.confidence || "medium")}.</p>`,
      { tier: "ultra", userPlan: plan }),

    box("Villain detection", (() => {
      const d = r.villainDetection || T.villainDetection;
      const rows = d.disruptors.map((x) => `<tr><td>${esc(x.player)}</td><td>${x.timesKilled}</td><td>${x.staffActed ? "Yes" : "<span style='color:var(--bad)'>No</span>"}</td></tr>`).join("");
      return `<table class="tbl"><thead><tr><th>Player</th><th>Times killed</th><th>Staff acted</th></tr></thead><tbody>${rows}</tbody></table>${advicePill(d.advice)}`;
    })(), { tier: "ultra", userPlan: plan, accent: "var(--bad)" }),

    box("Ghost staff detection", (() => {
      const d = r.ghostStaff || T.ghostStaff;
      return `<p style="font-size:.88rem">Staff online with zero commands: <b>${d.ghosts.map((g) => esc(g.name)).join(", ")}</b></p>${advicePill(d.advice)}`;
    })(), { tier: "ultra", userPlan: plan, accent: "var(--live)" }),

    box("Staff fatigue score", (() => {
      const d = r.staffFatigue || T.staffFatigue;
      return `<div class="grid grid-2" style="margin-bottom:8px">${miniStat(d.firstHalfAvgResponseMin + "m", "First-half response")}${miniStat(d.secondHalfAvgResponseMin + "m", "Second-half response")}</div>${advicePill(d.advice)}`;
    })(), { tier: "ultra", userPlan: plan, accent: (r.staffFatigue || T.staffFatigue).fatigued ? "var(--bad)" : "var(--good)" }),

    box("Queue intelligence", (() => {
      const d = r.queueIntelligence || T.queueIntelligence;
      return `<div class="grid grid-2" style="margin-bottom:8px">${miniStat(d.peakQueue, "Peak queue")}${miniStat(d.estimatedLost, "Est. lost to queue")}</div>${advicePill(d.advice)}`;
    })(), { tier: "ultra", userPlan: plan }),

    box("Golden hour analysis", (() => {
      const d = r.goldenHour || T.goldenHour;
      return `<p style="font-size:.88rem">Best join window: minute <b>${d.bestWindowStart}</b> to <b>${d.bestWindowEnd}</b> — <b>${d.retentionRate}%</b> retention.</p>${advicePill(d.advice)}`;
    })(), { tier: "ultra", userPlan: plan, accent: "var(--good)" }),

    box("Moderation pressure map", (() => {
      const d = r.moderationPressureMap || T.moderationPressureMap;
      return `<div class="grid grid-3" style="margin-bottom:8px">${miniStat(d.early, "Early")}${miniStat(d.mid, "Mid")}${miniStat(d.late, "Late")}</div>${advicePill(d.advice)}`;
    })(), { tier: "ultra", userPlan: plan }),

    box("Server health trend line", (() => {
      const d = r.healthTrend || T.healthTrend;
      const dots = d.scores.map((s) => `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px"><div style="width:11px;height:11px;border-radius:50%;background:${scoreColor(s)}"></div><span style="font-size:.65rem;color:var(--muted)">${s}</span></div>`).join("");
      return `<div style="display:flex;align-items:center;gap:3px;margin-bottom:8px">${dots}</div>${advicePill(d.advice)}`;
    })(), { tier: "ultra", userPlan: plan, accent: (r.healthTrend || T.healthTrend).trend === "declining" ? "var(--bad)" : "var(--good)" }),

    box("Tipping point analysis", (() => {
      const d = r.tippingPoint || T.tippingPoint;
      return `<div class="grid grid-2" style="margin-bottom:8px">${miniStat(d.avgSessionBelow + "m", "Avg session < 20 players")}${miniStat(d.avgSessionAbove + "m", "Avg session > 20 players")}</div>${advicePill(d.advice)}`;
    })(), { tier: "ultra", userPlan: plan }),

    box("Weekly performance report", (() => {
      const d = r.weeklyReport || T.weekly;
      return `<div class="grid grid-3" style="margin-bottom:8px">${miniStat(d.events, "Events")}${miniStat(d.totalJoins, "Total joins")}${miniStat(d.avgScore + "/100", "Avg score")}</div><p class="note" style="margin-top:6px">Best event: <b style="color:var(--text)">${esc(d.bestEvent)}</b></p>${advicePill(d.advice)}`;
    })(), { tier: "ultra", userPlan: plan }),

    box("Bot DM report delivery", `${deliveryRow(!!r.delivery?.dm, "Report DM'd to you by the Gatherly bot", "A private copy lands in your Discord DMs.")}${deliveryRow(!!r.delivery?.recipient, "Extra recipient DM", "Send a copy to a co-owner or staff lead automatically.")}`,
      { tier: "ultra", userPlan: plan }),
  ].join("");

  /* ---- staff intelligence (always shown — it's part of the base report) ---- */
  const staffBlock = `
    <div class="card rep-box">
      <div class="rep-kick">Staff intelligence</div>
      <h3>Staff audit for this event</h3>
      <div class="grid grid-4" style="margin:14px 0 18px">
        ${miniStat(safeNum(r.staff?.online?.length ?? r.staffOnline, 9), "Staff online")}
        ${miniStat(r.staff?.estimatedResponseMin != null && r.staff?.estimatedResponseMin !== "N/A" ? r.staff.estimatedResponseMin + "m" : "2.4m", "Avg mod response")}
        ${miniStat(safeNum(r.staff?.modCalls ?? r.modCalls, 4), "Mod calls")}
        ${miniStat(safeNum(r.staff?.kills ?? r.kills, 11), "Kills in window")}
      </div>
      ${staffLeaderboard.length ? `
        <table class="tbl"><thead><tr><th>Staff member</th><th>Permission</th><th>Team</th><th>Commands</th></tr></thead>
        <tbody>${staffLeaderboard.map((s) => `<tr><td>${esc(s.name || "Unknown")}</td><td>${esc(s.permission || "Staff")}</td><td>${esc(s.team || "Unknown")}</td><td>${safeNum(s.moderations ?? s.commands)}</td></tr>`).join("")}</tbody></table>`
      : `<p class="note">No staff commands recorded in the window. Staff are detected by Moderator permissions or above.</p>`}
    </div>`;

  /* ---- retention / win-back band ---- */
  const upsell = planRank(plan) < 2 ? `
    <div class="card rep-upsell">
      <div>
        <div class="rep-kick">${planRank(plan) === 0 ? "You're seeing the full Ultra report" : "One tier from the full picture"}</div>
        <h3 style="margin:4px 0 6px">${planRank(plan) === 0 ? "Every blurred box above unlocks the moment you upgrade" : "Unlock AI summaries, forecasting and the full intelligence suite"}</h3>
        <p style="font-size:.9rem">Hosts on ${planRank(plan) === 0 ? "Gatherly Pro and Ultra" : "Gatherly Ultra"} run better events week after week. Upgrade once and it applies to every future report automatically.</p>
      </div>
      <a class="btn btn-primary" href="/pricing" style="white-space:nowrap">See plans &amp; unlock</a>
    </div>` : `
    <div class="card rep-upsell">
      <div>
        <div class="rep-kick">Keep the streak going</div>
        <h3 style="margin:4px 0 6px">Your next event already has a forecast</h3>
        <p style="font-size:.9rem">${esc(r.nextForecastTease || "List your next session to keep your health-trend climbing and your forecasting sharp.")}</p>
      </div>
      <a class="btn btn-primary" href="/advertise" style="white-space:nowrap">List your next event</a>
    </div>`;

  /* ---- assemble ---- */
  const planBadge = plan === "ultra" ? `<span class="badge badge-boost">Ultra Report</span>` : plan === "pro" ? `<span class="badge badge-boost">Pro Report</span>` : `<span class="badge">Free preview</span>`;
  el.innerHTML = `
  <div class="card rep-box" style="margin-bottom:18px">
    <div style="display:flex;justify-content:space-between;gap:18px;flex-wrap:wrap;align-items:center">
      <div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <h3 style="font-size:1.5rem">${esc(r.eventTitle || "Event")}</h3>${planBadge}${momentumBadge(r.momentum)}
        </div>
        <p style="font-size:.88rem;margin-top:6px">${esc(r.serverName || "Server")} &middot; ${esc(r.scenario || "")} &middot; ${fmtLocal(r.windowStart)} - ${new Date(r.windowEnd).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
      </div>
      <div class="grid grid-2" style="gap:12px;min-width:280px">
        ${miniStat(safeNum(r.joinsInWindow, 87), "Joins in window")}
        ${miniStat(safeNum(r.peakConcurrent, 42), "Peak concurrent")}
        ${miniStat(safeNum(r.avgSessionMin, 61) + "m", "Avg session")}
        ${miniStat(safeNum(r.retained30, 49), "Retained 30m+")}
      </div>
    </div>
  </div>

  ${sectionHeader("Analytics", "Your full post-event analytics report. Included with Gatherly Pro and Ultra.")}
  <div class="grid grid-2 rep-grid">${analytics}</div>

  ${sectionHeader("Ultra intelligence", "The deep-signal layer. Included with Gatherly Ultra.")}
  <div class="grid grid-2 rep-grid">${ultra}</div>

  <div style="margin:26px 0 18px">${staffBlock}</div>

  ${upsell}

  <div class="card rep-box" style="margin-top:18px;font-size:.78rem;color:var(--muted);border:1px solid rgba(148,170,205,.1)">
    <b>Disclaimer:</b> ${esc(r.disclaimer || "Some data points rely on ER:LC API logs which may have a short delay. Staff detection includes all players with Moderator permissions or above. Locked panels show representative sample data until unlocked.")}
  </div>

  <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-top:16px">
    <button class="btn btn-ghost btn-sm" id="shareCardBtn">Download share card</button>
    <span class="badge">Verified via the official ER:LC API</span>
    ${r.delivery?.dm ? `<span class="badge badge-good">DM delivered</span>` : ""}
    ${r.delivery?.webhook ? `<span class="badge badge-good">Webhook delivered</span>` : ""}
    <span style="margin-left:auto;font-size:.75rem;color:var(--muted)">${esc(r.generatedBy || "Gatherly API")}</span>
  </div>`;

  el.querySelector("#shareCardBtn")?.addEventListener("click", () => downloadShareCard(r));
}

export function downloadShareCard(r) {
  const c = document.createElement("canvas");
  c.width = 1200; c.height = 630;
  const x = c.getContext("2d");
  x.fillStyle = "#090d13"; x.fillRect(0, 0, 1200, 630);
  x.strokeStyle = "rgba(148,170,205,.14)";
  [90, 180, 270].forEach((rr) => { x.beginPath(); x.arc(1010, 315, rr, 0, 7); x.stroke(); });
  x.fillStyle = "#7fa8ff"; x.font = "600 26px sans-serif";
  x.fillText("GATHERLY - ENGAGEMENT REPORT", 70, 90);
  x.fillStyle = "#e9eef6"; x.font = "600 54px sans-serif";
  x.fillText(String(r.eventTitle || "Event").slice(0, 30), 70, 170);
  x.fillStyle = "#8e9aac"; x.font = "400 26px sans-serif";
  x.fillText(`${r.serverName || "Server"} - ${r.scenario || ""}`, 70, 212);
  const col = safeNum(r.score) >= 70 ? "#69d99c" : safeNum(r.score) >= 45 ? "#7fa8ff" : "#ff7a7a";
  x.strokeStyle = "rgba(148,170,205,.28)"; x.lineWidth = 16;
  x.beginPath(); x.arc(1010, 315, 110, 0, 7); x.stroke();
  x.strokeStyle = col; x.lineCap = "round";
  x.beginPath(); x.arc(1010, 315, 110, -Math.PI / 2, -Math.PI / 2 + (safeNum(r.score) / 100) * 2 * Math.PI); x.stroke();
  x.fillStyle = col; x.font = "600 84px sans-serif"; x.textAlign = "center";
  x.fillText(String(safeNum(r.score)), 1010, 340);
  x.fillStyle = "#8e9aac"; x.font = "400 22px sans-serif";
  x.fillText("HEALTH SCORE", 1010, 380);
  x.textAlign = "left";
  const stats = [[safeNum(r.joinsInWindow), "Joins"], [safeNum(r.peakConcurrent), "Peak concurrent"], [`${safeNum(r.avgSessionMin)}m`, "Avg session"], [safeNum(r.retained30), "Retained 30m+"]];
  stats.forEach(([v, l], i) => {
    const sx = 70 + (i % 2) * 330, sy = 320 + Math.floor(i / 2) * 130;
    x.fillStyle = "#e9eef6"; x.font = "600 56px sans-serif"; x.fillText(String(v), sx, sy);
    x.fillStyle = "#8e9aac"; x.font = "400 24px sans-serif"; x.fillText(l, sx, sy + 36);
  });
  x.fillStyle = "#5d6a78"; x.font = "400 22px sans-serif";
  x.fillText("Powered by Gatherly - verified via the official ER:LC API", 70, 580);
  const a = document.createElement("a");
  a.download = `gatherly-report-${(r.eventTitle || "event").replace(/\W+/g, "-").toLowerCase()}.png`;
  a.href = c.toDataURL("image/png");
  a.click();
}
