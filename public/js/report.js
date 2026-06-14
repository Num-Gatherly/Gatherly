// Renders a full Gatherly engagement report into a container.
import { esc, fmtLocal } from "/js/app.js";

const scoreColor = (s) => (s >= 70 ? "var(--good,#69d99c)" : s >= 45 ? "var(--signal)" : "var(--bad,#ff7a7a)");
const safeNum = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

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

// Bar chart - fixed: container clips overflow, labels sit inside padding below bars.
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

const momentumBadge = (m) => !m ? "" : m.direction === "up"
  ? `<span class="badge badge-good">Trending up +${m.changePct}%</span>`
  : m.direction === "down" ? `<span class="badge badge-bad">Declining ${m.changePct}%</span>` : `<span class="badge">Stable</span>`;

function insightCard(title, content, color = "var(--signal)") {
  return `<div class="card" style="margin-bottom:14px;border-left:3px solid ${color}">
    <h4 style="margin-bottom:8px;font-size:.95rem">${title}</h4>
    ${content}
  </div>`;
}

function advicePill(text) {
  return `<p class="note" style="margin-top:8px;padding:8px 12px;background:rgba(127,168,255,.07);border-radius:8px">${esc(text)}</p>`;
}

export function renderReport(el, r) {
  const hasStaff = r.staff?.online?.length > 0 || safeNum(r.staff?.totalModerations) > 0;
  const staffLeaderboard = r.staff?.leaderboard || [];

  // New analytics flags.
  const hasPro = r.plan === "pro" || r.plan === "ultra";
  const hasUltra = r.plan === "ultra";

  let newFeaturesHtml = "";

  // PRO features.
  if (hasPro) {
    if (r.deadHour) {
      newFeaturesHtml += insightCard("Dead Hour Warning",
        `<p style="font-size:.88rem">A period of near-zero activity was detected.</p>${advicePill(r.deadHour.advice)}`,
        "var(--yellow,#ffcf5c)");
    }
    if (r.scenarioDNA) {
      const rows = r.scenarioDNA.scenarios.slice(0, 5).map((s) =>
        `<tr><td>${esc(s.scenario)}</td><td>${s.runs}</td><td>${s.avgScore}/100</td><td>${s.avgRetention}%</td></tr>`
      ).join("");
      newFeaturesHtml += insightCard("Scenario DNA",
        `<table class="tbl"><thead><tr><th>Scenario</th><th>Runs</th><th>Avg score</th><th>Avg retention</th></tr></thead><tbody>${rows}</tbody></table>${advicePill(r.scenarioDNA.advice)}`);
    }
    if (r.loyaltyTracker) {
      newFeaturesHtml += insightCard("Loyalty Tracker",
        `<div class="grid grid-3" style="margin-bottom:8px">
          <div class="stat"><b>${r.loyaltyTracker.returningPlayers}</b><span>Returning players</span></div>
          <div class="stat"><b>${r.loyaltyTracker.newPlayers}</b><span>New players</span></div>
          <div class="stat"><b>${r.loyaltyTracker.returningRate}%</b><span>Return rate</span></div>
        </div>${advicePill(r.loyaltyTracker.advice)}`);
    }
    if (r.staffRatioAlert) {
      newFeaturesHtml += insightCard("Staff vs Player Ratio Alert",
        `${advicePill(r.staffRatioAlert.advice)}`,
        "var(--yellow,#ffcf5c)");
    }
    if (r.scenarioFatigue) {
      newFeaturesHtml += insightCard("Scenario Fatigue Index",
        `<div class="grid grid-2" style="margin-bottom:8px">
          <div class="stat"><b>${r.scenarioFatigue.avgScoreEarly}/100</b><span>Early avg score</span></div>
          <div class="stat"><b>${r.scenarioFatigue.avgScoreRecent}/100</b><span>Recent avg score</span></div>
        </div>${advicePill(r.scenarioFatigue.advice)}`,
        r.scenarioFatigue.fatigued ? "var(--bad,#ff7a7a)" : "var(--good,#69d99c)");
    }
  }

  // ULTRA features.
  if (hasUltra) {
    if (r.villainDetection) {
      const rows = r.villainDetection.disruptors.map((d) =>
        `<tr><td>${esc(d.player)}</td><td>${d.timesKilled}</td><td>${d.staffActed ? "Yes" : "No"}</td></tr>`
      ).join("");
      newFeaturesHtml += insightCard("Villain Detection",
        `<table class="tbl"><thead><tr><th>Player</th><th>Times killed</th><th>Staff acted</th></tr></thead><tbody>${rows}</tbody></table>${advicePill(r.villainDetection.advice)}`,
        "var(--bad,#ff7a7a)");
    }
    if (r.ghostStaff) {
      const names = r.ghostStaff.ghosts.map((g) => esc(g.name)).join(", ");
      newFeaturesHtml += insightCard("Ghost Staff Detection",
        `<p style="font-size:.88rem">Staff online with zero commands: <b>${names}</b></p>${advicePill(r.ghostStaff.advice)}`,
        "var(--yellow,#ffcf5c)");
    }
    if (r.staffFatigue) {
      newFeaturesHtml += insightCard("Staff Fatigue Score",
        `<div class="grid grid-2" style="margin-bottom:8px">
          <div class="stat"><b>${r.staffFatigue.firstHalfAvgResponseMin}m</b><span>First half response</span></div>
          <div class="stat"><b>${r.staffFatigue.secondHalfAvgResponseMin}m</b><span>Second half response</span></div>
        </div>${advicePill(r.staffFatigue.advice)}`,
        r.staffFatigue.fatigued ? "var(--bad,#ff7a7a)" : "var(--good,#69d99c)");
    }
    if (r.queueIntelligence) {
      newFeaturesHtml += insightCard("Queue Intelligence",
        `<div class="grid grid-2" style="margin-bottom:8px">
          <div class="stat"><b>${r.queueIntelligence.peakQueue}</b><span>Peak queue</span></div>
          <div class="stat"><b>${r.queueIntelligence.estimatedLost}</b><span>Est. players lost to queue</span></div>
        </div>${advicePill(r.queueIntelligence.advice)}`);
    }
    if (r.goldenHour) {
      newFeaturesHtml += insightCard("The Golden Hour",
        `<p style="font-size:.88rem">Best join window: minute <b>${r.goldenHour.bestWindowStart}</b> to <b>${r.goldenHour.bestWindowEnd}</b> - <b>${r.goldenHour.retentionRate}%</b> retention rate.</p>${advicePill(r.goldenHour.advice)}`,
        "var(--good,#69d99c)");
    }
    if (r.moderationPressureMap) {
      newFeaturesHtml += insightCard("Moderation Pressure Map",
        `<div class="grid grid-3" style="margin-bottom:8px">
          <div class="stat"><b>${r.moderationPressureMap.early}</b><span>Early mod calls</span></div>
          <div class="stat"><b>${r.moderationPressureMap.mid}</b><span>Mid mod calls</span></div>
          <div class="stat"><b>${r.moderationPressureMap.late}</b><span>Late mod calls</span></div>
        </div>${advicePill(r.moderationPressureMap.advice)}`);
    }
    if (r.healthTrend) {
      const dots = r.healthTrend.scores.map((s, i) =>
        `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px">
          <div style="width:10px;height:10px;border-radius:50%;background:${scoreColor(s)}"></div>
          <span style="font-size:.65rem;color:var(--muted)">${s}</span>
        </div>`
      ).join("");
      newFeaturesHtml += insightCard("Server Health Trend",
        `<div style="display:flex;align-items:center;gap:2px;margin-bottom:8px">${dots}</div>${advicePill(r.healthTrend.advice)}`,
        r.healthTrend.trend === "declining" ? "var(--bad,#ff7a7a)" : r.healthTrend.trend === "improving" ? "var(--good,#69d99c)" : "var(--signal)");
    }
    if (r.tippingPoint) {
      newFeaturesHtml += insightCard("The Tipping Point",
        `<div class="grid grid-2" style="margin-bottom:8px">
          <div class="stat"><b>${r.tippingPoint.avgSessionBelow}m</b><span>Avg session below 20 players</span></div>
          <div class="stat"><b>${r.tippingPoint.avgSessionAbove}m</b><span>Avg session above 20 players</span></div>
        </div>${advicePill(r.tippingPoint.advice)}`,
        "var(--signal)");
    }
  }

  el.innerHTML = `
  <div class="card" style="margin-bottom:18px">
    <div style="display:flex;justify-content:space-between;gap:18px;flex-wrap:wrap;align-items:center">
      <div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <h3 style="font-size:1.5rem">${esc(r.eventTitle || "Event")}</h3>${momentumBadge(r.momentum)}
        </div>
        <p style="font-size:.88rem;margin-top:6px">${esc(r.serverName || "Server")} &middot; ${esc(r.scenario || "")} &middot; ${fmtLocal(r.windowStart)} - ${new Date(r.windowEnd).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
      </div>
      ${dial(safeNum(r.score))}
    </div>
  </div>

  ${r.aiSummary ? `
  <div class="ai-summary" style="margin-bottom:18px">
    <div class="tag">Gatherly insight &middot; generated by Gatherly API</div>
    <p>${esc(r.aiSummary)}</p>
  </div>` : ""}

  <div class="grid grid-4" style="margin-bottom:18px">
    <div class="stat"><b>${safeNum(r.joinsInWindow)}</b><span>Joins in window</span></div>
    <div class="stat"><b>${safeNum(r.peakConcurrent)}</b><span>Peak concurrent</span></div>
    <div class="stat"><b>${safeNum(r.avgSessionMin)}m</b><span>Avg session length</span></div>
    <div class="stat"><b>${safeNum(r.retained30)}</b><span>Retained 30m+</span></div>
  </div>

  <div class="grid grid-2" style="margin-bottom:18px">
    <div class="card">
      <h3>Player lifecycle funnel</h3>
      <p style="font-size:.85rem;margin-bottom:14px">Where players were won and lost across the event.</p>
      ${funnel(r.funnel || { views: 0, reveals: 0, entries: 0, retained30: 0 })}
      <p class="note" style="margin-top:14px">View-to-entry conversion: <b style="color:var(--text)">${safeNum(r.conversionPct)}%</b></p>
    </div>
    <div class="card">
      <h3>Players over the window</h3>
      <p style="font-size:.85rem;margin-bottom:14px">Concurrent players rebuilt from verified join and leave logs.</p>
      ${timeline(r.timeline)}
    </div>
  </div>

  <div class="grid grid-2" style="margin-bottom:18px">
    <div class="card">
      <h3>Join timeline</h3>
      <p style="font-size:.85rem;margin-bottom:14px">Joins per 5-minute bucket across the event window.</p>
      ${timeline(r.joinTimeline)}
    </div>
    <div class="card">
      <h3>Scenario benchmark</h3>
      ${r.benchmark ? `
        <p style="font-size:.9rem;margin-top:8px">Against <b style="color:var(--text)">${r.benchmark.cohortSize}</b> ${esc(r.scenario || "same-scenario")} events on Gatherly:</p>
        <div class="grid grid-2" style="margin-top:14px">
          <div class="stat"><b>${r.benchmark.peakPercentile != null ? r.benchmark.peakPercentile + "th" : "N/A"}</b><span>Percentile peak concurrent</span></div>
          <div class="stat"><b>${r.benchmark.sessionPercentile != null ? r.benchmark.sessionPercentile + "th" : "N/A"}</b><span>Percentile session length</span></div>
        </div>
        <p class="note" style="margin-top:12px">Platform avg session: ${safeNum(r.benchmark.platformAvgSessionMin)}m. Yours: ${safeNum(r.avgSessionMin)}m.</p>`
      : `<p style="margin-top:8px;color:var(--muted);font-size:.88rem">${r.plan === "free" ? "Upgrade to Gatherly Pro to unlock benchmarking." : "Benchmarks appear once 3+ events with this scenario have been reported on the platform."}</p>`}
    </div>
  </div>

  <div class="grid grid-2" style="margin-bottom:18px">
    <div class="card">
      <h3>Next event forecast</h3>
      ${r.forecast ? `
        <p style="font-size:.9rem;margin-top:8px">Projected from your last ${r.forecast.basedOnEvents} reported events:</p>
        <div class="grid grid-2" style="margin-top:14px">
          <div class="stat"><b>${r.forecast.projectedJoins[0]}-${r.forecast.projectedJoins[1]}</b><span>Projected joins</span></div>
          <div class="stat"><b>${r.forecast.projectedPeak[0]}-${r.forecast.projectedPeak[1]}</b><span>Projected peak</span></div>
        </div>
        <p class="note" style="margin-top:10px">Confidence: ${esc(r.forecast.confidence || "low")}.</p>`
      : `<p style="margin-top:8px;color:var(--muted);font-size:.88rem">${r.plan !== "ultra" ? "Upgrade to Gatherly Ultra to unlock forecasting." : "Forecasting unlocks after your third reported event."}</p>`}
    </div>
    <div class="card">
      <h3>Queue intelligence</h3>
      ${r.queueIntelligence ? `
        <div class="grid grid-2" style="margin-top:8px">
          <div class="stat"><b>${safeNum(r.queueIntelligence.peakQueue)}</b><span>Peak queue size</span></div>
          <div class="stat"><b>${safeNum(r.queueIntelligence.estimatedLost)}</b><span>Est. players lost</span></div>
        </div>
        <p class="note" style="margin-top:10px">${esc(r.queueIntelligence.advice)}</p>`
      : `<p style="margin-top:8px;color:var(--muted);font-size:.88rem">${r.plan !== "ultra" ? "Upgrade to Gatherly Ultra for queue intelligence." : "Queue data will appear here when a queue is detected."}</p>`}
    </div>
  </div>

  <div class="card" style="margin-bottom:18px">
    <h3>Staff intelligence</h3>
    <div class="grid grid-4" style="margin:14px 0 18px">
      <div class="stat"><b>${safeNum(r.staff?.online?.length ?? r.staffOnline)}</b><span>Staff online</span></div>
      <div class="stat"><b>${r.staff?.estimatedResponseMin != null && r.staff?.estimatedResponseMin !== "N/A" ? r.staff.estimatedResponseMin + "m" : "N/A"}</b><span>Avg mod response</span></div>
      <div class="stat"><b>${safeNum(r.staff?.modCalls ?? r.modCalls)}</b><span>Mod calls</span></div>
      <div class="stat"><b>${safeNum(r.staff?.kills ?? r.kills)}</b><span>Kills in window</span></div>
    </div>
    ${staffLeaderboard.length ? `
      <table class="tbl"><thead><tr><th>Staff member</th><th>Permission</th><th>Team</th><th>Commands</th></tr></thead>
      <tbody>${staffLeaderboard.map((s) => `<tr>
        <td>${esc(s.name || "Unknown")}</td>
        <td>${esc(s.permission || "Staff")}</td>
        <td>${esc(s.team || "Unknown")}</td>
        <td>${safeNum(s.moderations)}</td>
      </tr>`).join("")}</tbody></table>`
    : `<p class="note">No staff commands recorded in the window. Staff are detected by Moderator permissions or above.</p>`}
  </div>

  ${newFeaturesHtml ? `
  <div style="margin-bottom:18px">
    <h3 style="margin-bottom:14px">Advanced analytics</h3>
    ${newFeaturesHtml}
  </div>` : ""}

  ${r.funnelInsights?.length ? `
  <div class="card" style="margin-bottom:18px">
    <h3>Funnel insights</h3>
    ${r.funnelInsights.map((i) => `<p style="font-size:.88rem;margin-top:8px">${esc(i)}</p>`).join("")}
  </div>` : ""}

  ${r.growthAdvice?.length ? `
  <div class="card" style="margin-bottom:18px">
    <h3>Growth advice</h3>
    ${r.growthAdvice.map((a) => advicePill(a)).join("")}
  </div>` : ""}

  ${r.nextForecastTease ? `
  <div class="card" style="margin-bottom:18px;border:1px solid rgba(127,168,255,.2);background:rgba(127,168,255,.04)">
    <p style="font-size:.88rem;color:var(--muted)">${esc(r.nextForecastTease)}</p>
  </div>` : ""}

  <div class="card" style="margin-bottom:18px;font-size:.78rem;color:var(--muted);border:1px solid rgba(148,170,205,.1)">
    <b>Disclaimer:</b> ${esc(r.disclaimer || "Some data points rely on ER:LC API logs which may have a short delay. Staff detection includes all players with Moderator permissions or above.")}
  </div>

  <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">
    <button class="btn btn-ghost btn-sm" id="shareCardBtn">Download share card</button>
    <span class="badge">Verified via the official ER:LC API</span>
    ${r.delivery?.dm ? `<span class="badge badge-good">DM delivered</span>` : ""}
    ${r.delivery?.webhook ? `<span class="badge badge-good">Webhook delivered</span>` : ""}
    ${r.delivery?.recipient ? `<span class="badge badge-good">Recipient DM delivered</span>` : ""}
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
