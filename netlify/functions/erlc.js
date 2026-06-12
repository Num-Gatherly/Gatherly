// /api/erlc - official PRC ER:LC API integration + the Gatherly analytics engine.
//
// Auth header per PRC docs: "server-key: <key>" against
// https://api.policeroleplay.community/v1
// Gatherly only READS data - no command endpoints are ever called.
//
// Report pipeline: raw pull -> metrics -> Health Score -> funnel -> benchmark ->
// forecast -> staff intelligence -> momentum -> AI summary -> delivery.

import {
  json, requireUser, usersStore, eventsStore, decrypt, postDiscordWebhook, rateLimit,
} from "../lib/util.js";

const ERLC_BASE = "https://api.policeroleplay.community/v1";

// Common token bug: pasted keys carry whitespace, quotes, or zero-width chars.
const cleanKey = (k) => String(k || "").replace(/[\u200B-\u200D\uFEFF"'`]/g, "").trim();

async function erlcGet(path, key) {
  let r;
  try {
    r = await fetch(`${ERLC_BASE}${path}`, { headers: { "server-key": key, Accept: "application/json" } });
  } catch {
    throw new Error("Could not reach the ER:LC API. PRC may be down, try again shortly.");
  }
  if (r.status === 401 || r.status === 403) {
    throw new Error("ER:LC rejected the key (" + r.status + "). Re-copy it from in-game Server Settings then API (the server must own the ER:LC API Pack), with no spaces or quotes.");
  }
  if (r.status === 422) throw new Error("ER:LC says the server is offline or empty (422). Start the private server and try again.");
  if (r.status === 429) throw new Error("ER:LC rate limit hit (429). Wait about 60 seconds and try again.");
  if (!r.ok) throw new Error(`ER:LC API error on ${path} (HTTP ${r.status}).`);
  return r.json();
}

function getStoredKey(user) {
  if (!user.erlcKeyEnc) return null;
  try { return cleanKey(decrypt(user.erlcKeyEnc)); } catch { return null; }
}

// ---------------- Discord bot DM ----------------
async function sendBotDM(discordId, embed) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token || !discordId) return { ok: false, why: "Bot not configured." };
  const H = { Authorization: `Bot ${token}`, "Content-Type": "application/json" };
  const ch = await fetch("https://discord.com/api/v10/users/@me/channels", {
    method: "POST", headers: H, body: JSON.stringify({ recipient_id: discordId }),
  });
  if (!ch.ok) return { ok: false, why: "Could not open a DM channel." };
  const { id: channelId } = await ch.json();
  const msg = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST", headers: H, body: JSON.stringify({ embeds: [embed] }),
  });
  if (!msg.ok) return { ok: false, why: "DM blocked. The user must share a server with the Gatherly bot and allow DMs from server members." };
  return { ok: true };
}

// ---------------- analytics helpers ----------------
const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
const clamp01 = (x) => Math.max(0, Math.min(1, x));

// Session reconstruction from PRC join logs (Join:true / Join:false pairs).
function buildSessions(joinLogs, windowStart, windowEnd) {
  const byPlayer = new Map();
  const logs = (joinLogs || []).slice().sort((a, b) => a.Timestamp - b.Timestamp);
  for (const l of logs) {
    const p = l.Player;
    if (!byPlayer.has(p)) byPlayer.set(p, []);
    byPlayer.get(p).push(l);
  }
  const sessions = [];
  for (const [player, evs] of byPlayer) {
    let open = null;
    for (const l of evs) {
      if (l.Join) open = l.Timestamp;
      else if (open != null) { sessions.push({ player, start: open, end: l.Timestamp }); open = null; }
    }
    if (open != null) sessions.push({ player, start: open, end: windowEnd }); // still online at window end
  }
  // clip to the event window, drop sessions fully outside it
  return sessions
    .map((s) => ({ ...s, start: Math.max(s.start, windowStart), end: Math.min(s.end, windowEnd) }))
    .filter((s) => s.end > s.start);
}

// Peak concurrent + 15-min timeline from sessions.
function concurrency(sessions, windowStart, windowEnd) {
  const step = 5 * 60;
  const points = [];
  let peak = 0;
  for (let t = windowStart; t <= windowEnd; t += step) {
    const n = sessions.filter((s) => s.start <= t && s.end >= t).length;
    peak = Math.max(peak, n);
    points.push({ t, n });
  }
  // thin to ~12 points for the chart
  const keep = Math.max(1, Math.floor(points.length / 12));
  return { peak, timeline: points.filter((_, i) => i % keep === 0 || i === points.length - 1) };
}

function healthScore(m) {
  // Weighted composite, each component normalised 0..1.
  const fill = clamp01(m.peakConcurrent / Math.max(1, m.maxPlayers));            // 25%
  const retention = clamp01(m.retained30 / Math.max(1, m.uniquePlayers));        // 25%
  const growth = m.prevJoins == null ? 0.5
    : clamp01(0.5 + (m.joinsInWindow - m.prevJoins) / Math.max(4, m.prevJoins * 2)); // 20%
  const conversion = clamp01((m.conversionPct / 8));                              // 15% (8%+ view->join = full marks)
  const staffRatio = m.uniquePlayers === 0 ? 0
    : clamp01((m.staffOnline / Math.max(1, m.uniquePlayers)) / 0.15);             // 15% (1 staff per ~7 players = full marks)
  const score = 100 * (0.25 * fill + 0.25 * retention + 0.20 * growth + 0.15 * conversion + 0.15 * staffRatio);
  return Math.round(score);
}

// Percentile of x within arr.
const percentile = (arr, x) => {
  if (!arr.length) return null;
  const below = arr.filter((v) => v < x).length;
  return Math.round((below / arr.length) * 100);
};

export default async (req) => {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  // ---- public: is the PRC API reachable? (status dot in the footer) ----
  if (action === "status") {
    try {
      const r = await fetch(ERLC_BASE + "/server", { headers: { "server-key": "status-probe" } });
      // 401/403 means the API answered (our probe key is fake) -> service is up.
      return json({ up: r.status !== 502 && r.status !== 503 && r.status !== 504 });
    } catch { return json({ up: false }); }
  }

  const user = await requireUser(req);
  if (!user) return json({ error: "Log in first." }, 401);

  // ---- diagnostics ----
  if (action === "diag") {
    const checks = {
      loggedIn: true,
      keySaved: Boolean(user.erlcKeyEnc),
      keyDecrypts: Boolean(getStoredKey(user)),
      dmOptIn: Boolean(user.dmOptIn),
      botConfigured: Boolean(process.env.DISCORD_BOT_TOKEN),
      webhookSaved: Boolean(user.discordWebhook),
      aiConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    };
    let prcReachable = false, prcMessage = null;
    const key = getStoredKey(user);
    if (key) {
      try { const s = await erlcGet("/server", key); prcReachable = true; prcMessage = `Connected: ${s.Name}`; }
      catch (e) { prcMessage = e.message; }
    }
    return json({ checks, prcReachable, prcMessage });
  }

  // ---- test a key ----
  if (action === "test" && req.method === "POST") {
    if (!(await rateLimit(`erlctest:${user.id}`, 10, 300))) return json({ error: "Too many tests. Wait a few minutes." }, 429);
    const body = await req.json().catch(() => ({}));
    const key = cleanKey(body.erlcKey) || getStoredKey(user);
    if (!key) return json({ error: "No API key provided or saved yet. Paste your key from in-game Server Settings then API." }, 400);
    try {
      const server = await erlcGet("/server", key);
      return json({ ok: true, serverName: server.Name, players: server.CurrentPlayers, maxPlayers: server.MaxPlayers });
    } catch (e) { return json({ error: e.message }, 502); }
  }

  // ---- full engagement report ----
  if (action === "report" && req.method === "POST") {
    if (!(await rateLimit(`report:${user.id}`, 6, 600))) return json({ error: "Report rate limit hit. Wait a few minutes." }, 429);

    const evStoreRef = eventsStore();
    const ev = await evStoreRef.get(url.searchParams.get("eventId") || "", { type: "json" });
    if (!ev) return json({ error: "Event not found." }, 404);
    if (ev.hostId !== user.id) return json({ error: "You can only report on your own events." }, 403);

    const key = getStoredKey(user);
    if (!key) return json({ error: "Connect your ER:LC API key in Settings first." }, 400);

    const windowStart = Math.floor(new Date(ev.startsAt).getTime() / 1000);
    const windowEnd = windowStart + (ev.durationMin || 60) * 60;
    const inWindow = (t) => t >= windowStart && t <= windowEnd;

    try {
      // sequential to be gentle on PRC rate limits
      const server = await erlcGet("/server", key);
      const players = await erlcGet("/server/players", key).catch(() => []);
      const joinLogs = await erlcGet("/server/joinlogs", key).catch(() => []);
      const modCalls = await erlcGet("/server/modcalls", key).catch(() => []);
      const commandLogs = await erlcGet("/server/commandlogs", key).catch(() => []);
      const queue = await erlcGet("/server/queue", key).catch(() => []);

      // ---------- core metrics ----------
      const joins = (joinLogs || []).filter((l) => l.Join && inWindow(l.Timestamp));
      const uniquePlayers = new Set(joins.map((l) => l.Player)).size;
      const sessions = buildSessions(joinLogs, windowStart, windowEnd);
      const { peak: peakConcurrent, timeline } = concurrency(sessions, windowStart, windowEnd);
      const avgSessionMin = sessions.length
        ? Math.round(sessions.reduce((a, s) => a + (s.end - s.start), 0) / sessions.length / 60) : 0;
      const retained30 = new Set(sessions.filter((s) => s.end - s.start >= 30 * 60).map((s) => s.player)).size;
      const staffNow = (players || []).filter((p) => p.Permission && p.Permission !== "Normal");
      const staffOnline = staffNow.length;
      const modCallsW = (modCalls || []).filter((m) => inWindow(m.Timestamp));
      const cmdsW = (commandLogs || []).filter((c) => inWindow(c.Timestamp));

      // ---------- staff intelligence ----------
      const cmdsByStaff = {};
      for (const c of cmdsW) cmdsByStaff[c.Player] = (cmdsByStaff[c.Player] || 0) + 1;
      const staffLeaderboard = Object.entries(cmdsByStaff)
        .sort((a, b) => b[1] - a[1]).slice(0, 8)
        .map(([name, commands]) => ({ name, commands }));
      const idleStaff = staffNow
        .filter((p) => !cmdsByStaff[`${p.Player}`] && !cmdsByStaff[p.Player?.split(":")[0]])
        .map((p) => String(p.Player).split(":")[0]).slice(0, 8);
      // Mod call response: minutes from each call to the next staff command after it.
      const sortedCmdTimes = cmdsW.map((c) => c.Timestamp).sort((a, b) => a - b);
      const responseTimes = modCallsW.map((m) => {
        const next = sortedCmdTimes.find((t) => t >= m.Timestamp);
        return next ? (next - m.Timestamp) / 60 : null;
      }).filter((v) => v != null && v < 30);
      const avgModResponseMin = responseTimes.length
        ? Math.round((responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) * 10) / 10 : null;

      // ---------- funnel ----------
      const views = ev.views || 0;
      const reveals = ev.reveals || 0;
      const conversionPct = pct(joins.length, Math.max(views, 1));

      // ---------- previous events for growth / forecast / momentum ----------
      const { blobs } = await evStoreRef.list();
      const all = (await Promise.all(blobs.map((b) => evStoreRef.get(b.key, { type: "json" })))).filter(Boolean);
      const myPast = all
        .filter((e) => e.hostId === user.id && e.lastReport && e.id !== ev.id)
        .sort((a, b) => new Date(b.startsAt) - new Date(a.startsAt));
      const prevSame = myPast.find((e) => e.scenario === ev.scenario);
      const prevJoins = prevSame?.lastReport?.joinsInWindow ?? null;

      const m = {
        joinsInWindow: joins.length, uniquePlayers, peakConcurrent, avgSessionMin, retained30,
        staffOnline, maxPlayers: server.MaxPlayers || 40, conversionPct, prevJoins,
      };
      const score = healthScore(m);

      // ---------- platform benchmarking (same scenario, last 30 days) ----------
      const cohort = all.filter((e) =>
        e.lastReport && e.scenario === ev.scenario && e.id !== ev.id &&
        Date.now() - new Date(e.startsAt).getTime() < 30 * 86400000);
      const benchmark = cohort.length >= 3 ? {
        cohortSize: cohort.length,
        peakPercentile: percentile(cohort.map((e) => e.lastReport.peakConcurrent || 0), peakConcurrent),
        sessionPercentile: percentile(cohort.map((e) => e.lastReport.avgSessionMin || 0), avgSessionMin),
        platformAvgSessionMin: Math.round(cohort.reduce((a, e) => a + (e.lastReport.avgSessionMin || 0), 0) / cohort.length),
      } : null;

      // ---------- forecast (3+ past reports for this host) ----------
      let forecast = null;
      if (myPast.length >= 3) {
        const recent = myPast.slice(0, 5);
        const w = recent.map((_, i) => recent.length - i); // newer = heavier
        const wavg = (sel) => {
          const num = recent.reduce((a, e, i) => a + sel(e.lastReport) * w[i], 0);
          const den = w.reduce((a, b) => a + b, 0);
          return num / den;
        };
        const j = wavg((r) => r.joinsInWindow || 0);
        const p = wavg((r) => r.peakConcurrent || 0);
        const bestHour = recent.slice().sort((a, b) =>
          (b.lastReport.peakConcurrent || 0) - (a.lastReport.peakConcurrent || 0))[0];
        forecast = {
          projectedJoins: [Math.max(0, Math.round(j * 0.8)), Math.round(j * 1.2)],
          projectedPeak: [Math.max(0, Math.round(p * 0.8)), Math.round(p * 1.2)],
          recommendedStartLocal: bestHour ? new Date(bestHour.startsAt).toISOString() : null,
          basedOnEvents: recent.length,
        };
      }

      // ---------- momentum (5+ past reports) ----------
      let momentum = null;
      if (myPast.length >= 5) {
        const last4w = myPast.filter((e) => Date.now() - new Date(e.startsAt).getTime() < 28 * 86400000);
        const older = myPast.filter((e) => {
          const age = Date.now() - new Date(e.startsAt).getTime();
          return age >= 28 * 86400000 && age < 56 * 86400000;
        });
        const avg = (list) => list.length ? list.reduce((a, e) => a + (e.lastReport.peakConcurrent || 0), 0) / list.length : null;
        const nowAvg = avg(last4w), prevAvg = avg(older);
        let dir = "stable", changePct = 0;
        if (nowAvg != null && prevAvg != null && prevAvg > 0) {
          changePct = Math.round(((nowAvg - prevAvg) / prevAvg) * 100);
          dir = changePct > 8 ? "up" : changePct < -8 ? "down" : "stable";
        }
        momentum = { direction: dir, changePct };
      }

      const report = {
        eventId: ev.id, eventTitle: ev.title, scenario: ev.scenario, serverName: server.Name,
        maxPlayers: server.MaxPlayers, currentPlayers: server.CurrentPlayers,
        score,
        joinsInWindow: joins.length, uniquePlayers, peakConcurrent, avgSessionMin, retained30,
        staffOnline, modCalls: modCallsW.length, commands: cmdsW.length,
        queue: Array.isArray(queue) ? queue.length : 0,
        timeline: timeline.map((p) => ({ t: new Date(p.t * 1000).toISOString(), n: p.n })),
        funnel: { views, reveals, entries: joins.length, retained30 },
        conversionPct,
        benchmark, forecast, momentum,
        staff: { leaderboard: staffLeaderboard, idle: idleStaff, avgModResponseMin },
        windowStart: new Date(windowStart * 1000).toISOString(),
        windowEnd: new Date(windowEnd * 1000).toISOString(),
        generatedAt: new Date().toISOString(),
      };

      // ---------- AI summary (Anthropic API, optional) ----------
      report.aiSummary = null;
      if (process.env.ANTHROPIC_API_KEY) {
        try {
          const r = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": process.env.ANTHROPIC_API_KEY,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model: "claude-sonnet-4-6",
              max_tokens: 400,
              messages: [{
                role: "user",
                content:
                  "You are the analytics voice of Gatherly, an ER:LC roleplay event platform. " +
                  "Write a 4-6 sentence plain-English summary of this event report for the host. " +
                  "Cover: what happened overall, the standout metric, the biggest weakness, one trend versus their past events if data allows, and one concrete recommendation for the next event. " +
                  "No headings, no bullet points, no markdown. Be specific with numbers.\n\nREPORT JSON:\n" +
                  JSON.stringify({ ...report, timeline: undefined }) +
                  "\n\nHOST PAST EVENTS (newest first): " +
                  JSON.stringify(myPast.slice(0, 5).map((e) => ({
                    title: e.title, scenario: e.scenario, startsAt: e.startsAt,
                    joins: e.lastReport.joinsInWindow, peak: e.lastReport.peakConcurrent, score: e.lastReport.score,
                  }))),
              }],
            }),
          });
          if (r.ok) {
            const d = await r.json();
            report.aiSummary = (d.content || []).map((c) => c.text || "").join("").trim() || null;
          }
        } catch { /* AI summary is best-effort */ }
      }

      await evStoreRef.setJSON(ev.id, { ...ev, lastReport: report });

      // ---------- delivery ----------
      const embed = {
        title: `Engagement report - ${report.eventTitle}`,
        description: `Server: **${report.serverName}**\nHealth Score: **${report.score}/100**` +
          (report.aiSummary ? `\n\n${report.aiSummary.slice(0, 900)}` : ""),
        color: 0x7fa8ff,
        fields: [
          { name: "Joins", value: String(report.joinsInWindow), inline: true },
          { name: "Peak concurrent", value: String(report.peakConcurrent), inline: true },
          { name: "Avg session", value: `${report.avgSessionMin}m`, inline: true },
          { name: "Retained 30m+", value: String(report.retained30), inline: true },
          { name: "Staff online", value: String(report.staffOnline), inline: true },
          { name: "Mod calls", value: String(report.modCalls), inline: true },
        ],
        footer: { text: "Verified via the official ER:LC API · Gatherly" },
        timestamp: report.generatedAt,
      };

      let dmDelivered = false, dmNote = null, webhookDelivered = false, recipientDelivered = false;
      if (user.dmOptIn) {
        const dm = await sendBotDM(user.discordId, embed);
        dmDelivered = dm.ok; if (!dm.ok) dmNote = dm.why;
      }
      if (!dmDelivered && user.discordWebhook) {
        webhookDelivered = await postDiscordWebhook(user.discordWebhook, { username: "Gatherly Reports", embeds: [embed] });
      }
      if (ev.reportRecipientId) {
        const extra = await sendBotDM(ev.reportRecipientId, embed);
        recipientDelivered = extra.ok;
      }

      return json({ ok: true, report: { ...report, dmDelivered, dmNote, webhookDelivered, recipientDelivered } });
    } catch (e) {
      return json({ error: e.message }, 502);
    }
  }

  return json({ error: "Unknown action." }, 404);
};
