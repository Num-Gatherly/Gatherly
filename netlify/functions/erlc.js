// /api/erlc - ER:LC API integration + Gatherly analytics engine (v2).
//
// Key changes:
//  - Peak in-server players is clamped to the real 40 cap; the queue is reported
//    separately and may exceed it (that is normal).
//  - Real staff + moderation analytics from command logs and mod calls.
//  - Positive funnel framing + concrete growth advice instead of a scary drop-off %.
//  - Per-event join timeline, busiest window, forecasting, and a "next forecast" tease.
//  - Ultra-only weekly report aggregating the last 7 days with a day/hour heatmap.
//  - Stronger AI summary via the shared aiText helper.
import {
  json, requireUser, usersStore, eventsStore, decrypt, encrypt, postDiscordWebhook,
  auditError, audit, effectivePlan, effectiveLevel,
  aiText, dmUserEmbed, BRAND, PLAYER_CAP, guard,
} from "../lib/util.js";

const ERLC_BASE = "https://api.erlc.gg/v1";
const cleanKey = (k) => String(k || "").replace(/[\u200B-\u200D\uFEFF"'`]/g, "").trim();

async function fetchT(url, opts = {}, ms = 8000) { return fetch(url, { ...opts, signal: AbortSignal.timeout(ms) }); }

async function erlcGet(path, key) {
  let r;
  try {
    r = await fetchT(`${ERLC_BASE}${path}`, { headers: { "server-key": key, Accept: "application/json" } });
  } catch (e) {
    if (e.name === "TimeoutError") throw new Error("The ER:LC API did not respond in time. PRC may be slow or your server is offline. Try again shortly.");
    throw new Error("Could not reach the ER:LC API. PRC may be down, try again shortly.");
  }
  if (r.status === 401 || r.status === 403) throw new Error("ER:LC rejected the key (" + r.status + "). Re-copy it from in-game Server Settings then API (the server must own the ER:LC API Pack), with no spaces or quotes.");
  if (r.status === 422) throw new Error("ER:LC says the server is offline or empty (422). Start the private server and try again.");
  if (r.status === 429) throw new Error("ER:LC rate limit hit (429). Wait about 60 seconds and try again.");
  if (!r.ok) throw new Error(`ER:LC API error on ${path} (HTTP ${r.status}).`);
  return r.json();
}

function getStoredKey(user) {
  if (!user || !user.erlcKeyEnc) return null;
  try { return cleanKey(decrypt(user.erlcKeyEnc)); } catch { return null; }
}

/* ------------------------------- math ----------------------------------- */
const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

function buildSessions(joinLogs, windowStart, windowEnd) {
  const byPlayer = new Map();
  const logs = (joinLogs || []).slice().sort((a, b) => a.Timestamp - b.Timestamp);
  for (const l of logs) { if (!byPlayer.has(l.Player)) byPlayer.set(l.Player, []); byPlayer.get(l.Player).push(l); }
  const sessions = [];
  for (const [player, evs] of byPlayer) {
    let open = null;
    for (const l of evs) {
      if (l.Join) open = l.Timestamp;
      else if (open != null) { sessions.push({ player, start: open, end: l.Timestamp }); open = null; }
    }
    if (open != null) sessions.push({ player, start: open, end: windowEnd });
  }
  return sessions.map((s) => ({ ...s, start: Math.max(s.start, windowStart), end: Math.min(s.end, windowEnd) })).filter((s) => s.end > s.start);
}

// Concurrency, clamped to the 40-player in-server cap so peak is never reported above it.
function concurrency(sessions, windowStart, windowEnd, cap) {
  const step = 300, points = [];
  let peak = 0, peakAt = windowStart;
  for (let t = windowStart; t <= windowEnd; t += step) {
    const n = Math.min(cap, sessions.filter((s) => s.start <= t && s.end >= t).length);
    if (n > peak) { peak = n; peakAt = t; }
    points.push({ t, n });
  }
  const keep = Math.max(1, Math.floor(points.length / 12));
  return { peak, peakAt, timeline: points.filter((_, i) => i % keep === 0 || i === points.length - 1) };
}

// Joins per 5-minute bucket across the window (for the in-report distribution chart).
function joinDistribution(joinLogs, windowStart, windowEnd) {
  const step = 300, buckets = [];
  for (let t = windowStart; t < windowEnd; t += step) {
    const n = (joinLogs || []).filter((l) => l.Join && l.Timestamp >= t && l.Timestamp < t + step).length;
    buckets.push({ t, n });
  }
  return buckets;
}

function healthScore(m) {
  const fill = clamp01(m.peakConcurrent / Math.max(1, m.maxPlayers));
  const retention = clamp01(m.retained30 / Math.max(1, m.uniquePlayers));
  const growth = m.prevJoins == null ? 0.5 : clamp01(0.5 + (m.joinsInWindow - m.prevJoins) / Math.max(4, m.prevJoins * 2));
  const conversion = clamp01(m.conversionPct / 8);
  const staffRatio = m.uniquePlayers === 0 ? 0 : clamp01((m.staffOnline / Math.max(1, m.uniquePlayers)) / 0.15);
  return Math.round(100 * (0.25 * fill + 0.25 * retention + 0.20 * growth + 0.15 * conversion + 0.15 * staffRatio));
}

const percentile = (arr, x) => { if (!arr.length) return null; return Math.round((arr.filter((v) => v < x).length / arr.length) * 100); };
const isStaffPerm = (p) => p && p !== "Normal";

// Estimate how quickly staff acted after a mod call: time to the next staff command.
function estimateModResponse(modcalls, commands, windowStart, windowEnd) {
  const calls = (modcalls || []).filter((m) => m.Timestamp >= windowStart && m.Timestamp <= windowEnd).map((m) => m.Timestamp).sort((a, b) => a - b);
  const cmds = (commands || []).map((c) => c.Timestamp).sort((a, b) => a - b);
  if (!calls.length || !cmds.length) return null;
  const deltas = [];
  for (const call of calls) {
    const next = cmds.find((t) => t >= call && t - call <= 900); // within 15 min
    if (next != null) deltas.push((next - call) / 60);
  }
  return deltas.length ? Math.round(avg(deltas) * 10) / 10 : null;
}

/* ----------------------- funnel + growth narrative ---------------------- */
function funnelInsights(m) {
  const out = [];
  if (m.views === 0) out.push("No views yet. Share your listing link and boost it so it sits at the top of the board.");
  else out.push(`${m.views} people viewed the listing and ${m.entries} joined, a ${m.conversionPct}% conversion.`);
  if (m.views > 0 && m.conversionPct < 3) out.push("A stronger title and banner, or a boost, usually lifts conversion.");
  if (m.entries > 0 && m.retained30 / m.entries < 0.4) out.push("Players left fairly quickly. Tighter scenario pacing and visible active staff help retention.");
  if (m.entries > 0 && m.retained30 / m.entries >= 0.6) out.push("Strong retention. Whatever you ran here is working, keep this format.");
  return out;
}

function growthAdvice(m) {
  const out = [];
  const fill = m.peakConcurrent / Math.max(1, m.maxPlayers);
  if (fill < 0.5) out.push("Your server was under half full at peak. List in more communities and boost this event to pull a bigger crowd.");
  if (fill >= 0.9) out.push("You hit near-capacity. Consider a second linked server or staggered sessions so you stop turning players away.");
  if (m.views > 20 && m.conversionPct < 4) out.push("Plenty of eyes, fewer joins. Test a punchier title and a clearer scenario line.");
  if (m.staffOnline === 0) out.push("No staff were detected online. Even one visible moderator improves retention and trust.");
  if (!out.length) out.push("Healthy event across the board. Repeat this start time and scenario to build a regular audience.");
  return out;
}

function recommendStartHour(pastReports) {
  const byHour = {};
  for (const r of pastReports) {
    const h = new Date(r.windowStart).getUTCHours();
    byHour[h] = byHour[h] || [];
    byHour[h].push(r.joinsInWindow || 0);
  }
  let best = null, bestAvg = -1;
  for (const h of Object.keys(byHour)) { const a = avg(byHour[h]); if (a > bestAvg) { bestAvg = a; best = Number(h); } }
  return best;
}

async function aiSummaryFor(metrics, kind = "event") {
  const prompt = `You are Gatherly's analytics engine for ER:LC (Roblox roleplay) ${kind === "weekly" ? "weekly server performance" : "post-event"} reports. Write a sharp, data-driven summary of 4 to 5 sentences for the server host.
Cover: what happened, the single most notable signal, one specific thing to improve, and one thing to keep doing. Be concrete and reference the numbers. No fluff, no greeting.

Data (JSON):
${JSON.stringify(metrics).slice(0, 3500)}`;
  return (await aiText(prompt, { max_tokens: 360 })) || null;
}

/* ------------------------------ delivery -------------------------------- */
async function deliverReport(user, ev, report) {
  const color = report.score >= 70 ? BRAND.green : report.score >= 45 ? BRAND.color : BRAND.red;
  const embed = {
    title: `Report ready: ${ev.title}`,
    color, thumbnail: { url: BRAND.logo },
    description: [
      `### ${report.serverName}`,
      `> ${report.aiSummary ? report.aiSummary.slice(0, 600) : "Your event has been analysed."}`,
      "",
      `- Health score: ${report.score}/100`,
      `- Players joined: ${report.uniquePlayers}`,
      `- Peak in-server: ${report.peakConcurrent}/${report.maxPlayers}`,
      `- Retained 30 min: ${report.retained30}`,
    ].join("\n"),
    timestamp: new Date().toISOString(), footer: { text: "Gatherly" },
  };
  let dm = { ok: false }, hook = false, rec = { ok: false };
  if (ev.reportRecipientId) rec = await dmUserEmbed(ev.reportRecipientId, embed);
  if (user.dmOptIn && user.discordId) dm = await dmUserEmbed(user.discordId, embed);
  if (user.discordWebhook) hook = await postDiscordWebhook(user.discordWebhook, { username: "Gatherly Reports", embeds: [embed] });
  return { dm: dm.ok, webhook: hook, recipient: rec.ok };
}

/* ------------------------------- handler -------------------------------- */
export default async (req) => {
  try { return await handler(req); }
  catch (e) { try { await auditError(null, "erlc.crash", e?.message || "unknown"); } catch {} return json({ error: "Server error: " + (e?.message || "unknown") }, 500); }
};

async function handler(req) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  if (action === "status") {
    try { const r = await fetchT(ERLC_BASE + "/server", { headers: { "server-key": "status-probe" } }, 5000); return json({ up: r.status !== 502 && r.status !== 503 && r.status !== 504 }); }
    catch { return json({ up: false }); }
  }

  const user = await requireUser(req);
  if (!user) return json({ error: "Log in first." }, 401);

  if (action === "diagnostics" || action === "diag") {
    const checks = {
      loggedIn: { ok: true },
      keySaved: { ok: Boolean(user.erlcKeyEnc), detail: user.erlcKeyEnc ? "" : "No ER:LC key saved yet" },
      keyDecrypts: { ok: Boolean(getStoredKey(user)) },
      dmOptIn: { ok: Boolean(user.dmOptIn) },
      botConfigured: { ok: Boolean(process.env.DISCORD_BOT_TOKEN), detail: process.env.DISCORD_BOT_TOKEN ? "" : "DISCORD_BOT_TOKEN not set in Netlify env vars" },
      webhookSaved: { ok: Boolean(user.discordWebhook) },
      aiConfigured: { ok: Boolean(process.env.ANTHROPIC_API_KEY), detail: process.env.ANTHROPIC_API_KEY ? "" : "ANTHROPIC_API_KEY not set in Netlify env vars" },
    };
    const key = getStoredKey(user);
    if (key) { try { const s = await erlcGet("/server", key); checks.erlcConnection = { ok: true, detail: `Connected: ${s.Name}` }; } catch (e) { checks.erlcConnection = { ok: false, detail: e.message }; } }
    else checks.erlcConnection = { ok: false, detail: "No ER:LC key saved yet" };
    return json({ checks });
  }

  if (action === "save-key" && req.method === "POST") {
    const blocked = await guard(req, user, `savekey:${user.id}`, 6, 120, { kind: "key-spam", what: "Rapid ER:LC key saves." });
    if (blocked) return blocked;
    const b = await req.json().catch(() => ({}));
    const key = cleanKey(b.key);
    if (!key) return json({ error: "No key provided." }, 400);
    await usersStore().setJSON(user.id, { ...user, erlcKeyEnc: encrypt(key), updatedAt: new Date().toISOString() });
    return json({ ok: true });
  }

  if (action === "test-key") {
    const key = getStoredKey(user);
    if (!key) return json({ error: "No key saved. Paste your key and save it first." }, 400);
    try { const s = await erlcGet("/server", key); return json({ ok: true, serverName: s.Name }); }
    catch (e) { await auditError(user, "erlc.test-key", e.message); return json({ ok: false, error: e.message }); }
  }

  if (action === "remove-key" && req.method === "POST") {
    const { erlcKeyEnc: _, ...rest } = user;
    await usersStore().setJSON(user.id, { ...rest, updatedAt: new Date().toISOString() });
    return json({ ok: true });
  }

  if (action === "delivery") return json({ webhook: user.discordWebhook || "", dmOptIn: Boolean(user.dmOptIn) });

  if (action === "save-delivery" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    await usersStore().setJSON(user.id, { ...user, discordWebhook: String(b.webhook || "").slice(0, 300), dmOptIn: Boolean(b.dmOptIn), updatedAt: new Date().toISOString() });
    return json({ ok: true });
  }

  if (action === "live-data") {
    const key = getStoredKey(user);
    if (!key) return json({ data: null });
    try {
      const [server, players, queue] = await Promise.all([
        erlcGet("/server", key), erlcGet("/server/players", key), erlcGet("/server/queue", key).catch(() => ({ Queue: [] })),
      ]);
      const staffList = Array.isArray(players) ? players.filter((p) => isStaffPerm(p.Permission)) : [];
      return json({ data: {
        serverName: server.Name,
        playerCount: Math.min(PLAYER_CAP, Array.isArray(players) ? players.length : 0),
        maxPlayers: Math.min(PLAYER_CAP, server.MaxPlayers || PLAYER_CAP),
        queueCount: Array.isArray(queue?.Queue) ? queue.Queue.length : (Array.isArray(queue) ? queue.length : 0),
        staffOnline: staffList.length,
      } });
    } catch (e) { return json({ data: null, error: e.message }); }
  }

  /* ----------------------- single-event report ----------------------- */
  if (action === "report" && req.method === "POST") {
    const eventId = url.searchParams.get("eventId");
    if (!eventId) return json({ error: "eventId is required." }, 400);
    const eventStore = eventsStore();
    const ev = await eventStore.get(eventId, { type: "json" });
    if (!ev) return json({ error: "Event not found." }, 404);
    if (ev.userId !== user.id) return json({ error: "Not your event." }, 403);

    const key = getStoredKey(user);
    if (!key) return json({ error: "No ER:LC key saved. Go to Settings and add your server key first." }, 400);

    const lvl = effectiveLevel(user);
    const hasFullAnalytics = lvl >= 1;
    const hasAI = lvl >= 2;
    const hasForecast = lvl >= 2;

    const windowStart = Math.floor(new Date(ev.startsAt).getTime() / 1000);
    const windowEnd = Math.floor(windowStart + (ev.durationMin || 60) * 60);
    if (Math.floor(Date.now() / 1000) < windowStart) return json({ error: "The event has not started yet." }, 400);

    let serverData, playersData, joinLogs, commandLogs, modCallData, queueData, killLogs;
    try {
      [serverData, playersData] = await Promise.all([erlcGet("/server", key), erlcGet("/server/players", key)]);
      [joinLogs, commandLogs, modCallData, queueData, killLogs] = await Promise.allSettled([
        erlcGet("/server/joinlogs", key), erlcGet("/server/commandlogs", key),
        erlcGet("/server/modcalls", key), erlcGet("/server/queue", key), erlcGet("/server/killlogs", key),
      ]).then((rs) => rs.map((r) => (r.status === "fulfilled" ? r.value : [])));
    } catch (e) { await auditError(user, "erlc.report", e.message); return json({ error: e.message }, 502); }

    const maxPlayers = Math.min(PLAYER_CAP, serverData?.MaxPlayers || PLAYER_CAP);
    const windowJoinLogs = (joinLogs || []).filter((l) => l.Timestamp >= windowStart && l.Timestamp <= windowEnd);
    const sessions = buildSessions(windowJoinLogs, windowStart, windowEnd);
    const uniquePlayers = new Set(windowJoinLogs.map((l) => l.Player)).size;
    const { peak: peakConcurrent, peakAt, timeline } = concurrency(sessions, windowStart, windowEnd, maxPlayers);
    const joinTimeline = joinDistribution(windowJoinLogs, windowStart, windowEnd);
    const retained30 = sessions.filter((s) => (s.end - s.start) >= 1800).length;
    const retained60 = sessions.filter((s) => (s.end - s.start) >= 3600).length;
    const avgSessionMin = sessions.length ? Math.round(avg(sessions.map((s) => (s.end - s.start))) / 60) : 0;

    const commandsInWindow = Array.isArray(commandLogs) ? commandLogs.filter((c) => c.Timestamp >= windowStart && c.Timestamp <= windowEnd) : [];
    const modCalls = Array.isArray(modCallData) ? modCallData.filter((m) => m.Timestamp >= windowStart && m.Timestamp <= windowEnd) : [];
    const killsInWindow = Array.isArray(killLogs) ? killLogs.filter((k) => k.Timestamp >= windowStart && k.Timestamp <= windowEnd).length : 0;
    const peakQueue = Array.isArray(queueData?.Queue) ? queueData.Queue.length : (Array.isArray(queueData) ? queueData.length : 0);

    const onlineStaff = (Array.isArray(playersData) ? playersData : []).filter((p) => isStaffPerm(p.Permission))
      .map((p) => ({ name: p.Player, permission: p.Permission, team: p.Team || null }));
    const permByName = Object.fromEntries(onlineStaff.map((s) => [s.name, s.permission]));
    const modCounts = {};
    for (const c of commandsInWindow) modCounts[c.Player] = (modCounts[c.Player] || 0) + 1;
    const staffLeaderboard = Object.entries(modCounts)
      .map(([name, moderations]) => ({ name, moderations, permission: permByName[name] || "Staff" }))
      .sort((a, b) => b.moderations - a.moderations);
    const estimatedResponseMin = estimateModResponse(modCalls, commandsInWindow, windowStart, windowEnd);

    const views = ev.views || 0;
    const conversionPct = pct(uniquePlayers, views);

    let prevJoins = null, pastReports = [];
    try {
      const { blobs } = await eventStore.list();
      const all = await Promise.all(blobs.map((b) => eventStore.get(b.key, { type: "json" })));
      pastReports = all.filter((e) => e && e.userId === user.id && e.id !== eventId && e.lastReport).map((e) => e.lastReport).sort((a, b) => new Date(b.windowStart) - new Date(a.windowStart));
      if (pastReports.length) prevJoins = pastReports[0].joinsInWindow;
    } catch {}

    const metrics = {
      eventTitle: ev.title, serverName: serverData?.Name || "Your server", scenario: ev.scenario,
      joinsInWindow: uniquePlayers, uniquePlayers, peakConcurrent, peakQueue, avgSessionMin,
      retained30, retained60, staffOnline: onlineStaff.length, modCalls: modCalls.length,
      commands: commandsInWindow.length, kills: killsInWindow, maxPlayers, conversionPct, prevJoins, views,
    };
    const score = healthScore(metrics);

    let benchmark = null;
    if (hasFullAnalytics) {
      try {
        const { blobs } = await eventStore.list();
        const all = await Promise.all(blobs.map((b) => eventStore.get(b.key, { type: "json" })));
        const cohort = all.filter((e) => e && e.scenario === ev.scenario && e.lastReport && e.id !== eventId).map((e) => e.lastReport);
        if (cohort.length >= 3) benchmark = {
          cohortSize: cohort.length,
          peakPercentile: percentile(cohort.map((e) => e.peakConcurrent), peakConcurrent),
          sessionPercentile: percentile(cohort.map((e) => e.avgSessionMin), avgSessionMin),
          platformAvgSessionMin: Math.round(avg(cohort.map((e) => e.avgSessionMin || 0))),
        };
      } catch {}
    }

    let forecast = null;
    if (hasForecast && pastReports.length >= 2) {
      const recent = pastReports.slice(0, 4).map((e) => e.joinsInWindow || 0);
      const base = avg(recent);
      const recHour = recommendStartHour(pastReports.concat([{ windowStart: new Date(windowStart * 1000).toISOString(), joinsInWindow: uniquePlayers }]));
      forecast = {
        projectedJoins: [Math.round(base * 0.85), Math.round(base * 1.15)],
        projectedPeak: [Math.max(1, Math.round(peakConcurrent * 0.85)), Math.min(maxPlayers, Math.round(peakConcurrent * 1.2))],
        basedOnEvents: recent.length,
        recommendedStartHourUTC: recHour,
        confidence: recent.length >= 4 ? "medium" : "low",
      };
    }

    let momentum = null;
    if (prevJoins != null) {
      const changePct = Math.round(((uniquePlayers - prevJoins) / Math.max(1, prevJoins)) * 100);
      momentum = { direction: changePct >= 0 ? "up" : "down", changePct: Math.abs(changePct) };
    }

    const aiSummary = hasAI ? await aiSummaryFor({ ...metrics, score, benchmark, forecast }) : null;

    const nextForecastTease = hasForecast
      ? `In your next forecast we will pinpoint your single best start time and project your peak by day of week, using your most recent ${Math.min(8, pastReports.length + 1)} events.`
      : "Upgrade to Ultra to unlock forecasting that learns from every event you run.";

    const report = {
      eventTitle: ev.title, serverName: serverData?.Name || "Your server", scenario: ev.scenario, score, plan: effectivePlan(user),
      uniquePlayers, joinsInWindow: uniquePlayers, peakConcurrent, peakAt: new Date(peakAt * 1000).toISOString(),
      avgSessionMin, retained30, retained60, maxPlayers, fillPct: pct(peakConcurrent, maxPlayers),
      queue: { peak: peakQueue, note: `In-server players are capped at ${maxPlayers}. The queue can go higher and is counted separately.` },
      conversionPct,
      windowStart: new Date(windowStart * 1000).toISOString(), windowEnd: new Date(windowEnd * 1000).toISOString(), generatedAt: new Date().toISOString(),
      timeline: timeline.map((p) => ({ t: new Date(p.t * 1000).toISOString(), n: p.n })),
      joinTimeline: joinTimeline.map((p) => ({ t: new Date(p.t * 1000).toISOString(), n: p.n })),
      funnel: { views, reveals: ev.reveals || 0, entries: uniquePlayers, retained30 },
      funnelInsights: funnelInsights({ views, entries: uniquePlayers, conversionPct, retained30 }),
      growthAdvice: growthAdvice({ peakConcurrent, maxPlayers, views, conversionPct, staffOnline: onlineStaff.length }),
      staff: {
        online: onlineStaff, totalModerations: commandsInWindow.length, modCalls: modCalls.length,
        leaderboard: staffLeaderboard.slice(0, 8), bestStaff: staffLeaderboard[0] || null,
        estimatedResponseMin, kills: killsInWindow,
      },
      benchmark, forecast, momentum, nextForecastTease, aiSummary,
      generatedBy: "Gatherly API v2",
    };

    const delivery = await deliverReport(user, ev, report).catch(() => ({}));
    report.delivery = delivery;

    await eventStore.setJSON(eventId, { ...ev, lastReport: report });
    await audit(user, "erlc.report", { eventId, score });
    return json({ ok: true, report });
  }

  /* --------------------- weekly report (Ultra only) -------------------- */
  if (action === "weekly-report") {
    if (effectiveLevel(user) < 2) return json({ error: "Weekly reports are a Gatherly Ultra feature.", needUltra: true }, 403);
    const eventStore = eventsStore();
    const { blobs } = await eventStore.list();
    const all = (await Promise.all(blobs.map((b) => eventStore.get(b.key, { type: "json" })))).filter(Boolean);
    const weekAgo = Date.now() - 7 * 86400000;
    const mine = all.filter((e) => e.userId === user.id && e.lastReport && new Date(e.lastReport.windowStart).getTime() >= weekAgo);
    if (!mine.length) return json({ ok: true, report: null, message: "No reported events in the last 7 days yet." });

    const reps = mine.map((e) => e.lastReport);
    const totalJoins = reps.reduce((s, r) => s + (r.joinsInWindow || 0), 0);
    const peak = Math.max(...reps.map((r) => r.peakConcurrent || 0));
    const avgSession = Math.round(avg(reps.map((r) => r.avgSessionMin || 0)));
    const avgScore = Math.round(avg(reps.map((r) => r.score || 0)));
    const totalMods = reps.reduce((s, r) => s + (r.staff?.totalModerations || 0), 0);

    const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const r of reps) { const d = new Date(r.windowStart); grid[d.getUTCDay()][d.getUTCHours()] += r.joinsInWindow || 0; }
    const best = reps.slice().sort((a, b) => (b.score || 0) - (a.score || 0))[0];

    const summary = await aiSummaryFor({
      kind: "weekly", events: reps.length, totalJoins, peak, avgSession, avgScore, totalModerations: totalMods,
      bestEvent: best ? { title: best.eventTitle, score: best.score } : null,
    }, "weekly");

    const report = {
      plan: "ultra", periodDays: 7, events: reps.length, totalJoins, peakConcurrent: peak,
      avgSessionMin: avgSession, avgScore, totalModerations: totalMods,
      heatmap: grid, bestEvent: best ? { title: best.eventTitle, score: best.score, joins: best.joinsInWindow } : null,
      trend: reps.map((r) => ({ at: r.windowStart, joins: r.joinsInWindow, score: r.score })).reverse(),
      forecastNextWeek: { projectedJoins: [Math.round(totalJoins * 0.9), Math.round(totalJoins * 1.2)], note: "Based on this week's volume. Keep your strongest start times to land at the top of the range." },
      aiSummary: summary, generatedAt: new Date().toISOString(), generatedBy: "Gatherly Weekly (Ultra)",
    };
    await audit(user, "erlc.weekly-report", { events: reps.length });
    return json({ ok: true, report });
  }

  return json({ error: "Unknown action." }, 404);
}
