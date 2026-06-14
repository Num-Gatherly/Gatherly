// /api/erlc - ER:LC API integration + Gatherly analytics engine (v3).
//
// Key fixes in v3:
//  - Staff detection uses Sheriff team + Moderator/Admin/Owner permissions (not just permission field).
//  - Report regeneration MERGES with prior session data, never resets it.
//  - Every field guaranteed to return a value - no more undefined.
//  - Tiered analytics: Pro unlocks benchmarking, scenario DNA, dead hour, loyalty tracker.
//  - Ultra unlocks villain detection, ghost staff, staff fatigue, queue intelligence,
//    golden hour, moderation pressure map, tipping point, health trend line.
//  - Report DM uses embeds v2 with a big blue "View Full Report" button.
import {
  json, requireUser, usersStore, eventsStore, decrypt, encrypt, postDiscordWebhook,
  auditError, audit, effectivePlan, effectiveLevel,
  aiText, dmUserEmbed, BRAND, PLAYER_CAP, guard, discordBotFetch,
} from "../lib/util.js";
import { reportDmPayload } from "../lib/support.js";

const ERLC_BASE = "https://api.erlc.gg/v1";
const SITE_URL = process.env.SITE_URL || "https://gatherly-erlc.xyz";
const cleanKey = (k) => String(k || "").replace(/[\u200B-\u200D\uFEFF"'`]/g, "").trim();

async function fetchT(url, opts = {}, ms = 8000) {
  return fetch(url, { ...opts, signal: AbortSignal.timeout(ms) });
}

async function erlcGet(path, key) {
  let r;
  try {
    r = await fetchT(`${ERLC_BASE}${path}`, {
      headers: { "server-key": key, Accept: "application/json" },
    });
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
const safeNum = (v, fallback = 0) => (Number.isFinite(v) ? v : fallback);
const safeStr = (v, fallback = "Unknown") => (v != null && String(v).trim() ? String(v).trim() : fallback);

/* ----------------------- staff detection -------------------------------- */
// Staff = Sheriff team OR has Moderator/Admin/Owner/Co-Owner permission level.
const STAFF_PERMISSIONS = new Set(["Moderator", "Admin", "Owner", "Co-Owner", "Server Owner"]);
const STAFF_TEAMS = new Set(["Sheriff", "Fire", "DOT", "Mountain Rescue"]);

function isStaffMember(player) {
  if (!player) return false;
  const perm = String(player.Permission || "");
  const team = String(player.Team || "");
  return STAFF_PERMISSIONS.has(perm) || perm !== "Normal" && perm !== "";
}

function isCommandStaff(player) {
  // Command staff = Moderator permission and above (for leaderboard / ghost staff).
  const perm = String(player?.Permission || "");
  return STAFF_PERMISSIONS.has(perm);
}

/* ----------------------- session building ------------------------------- */
function buildSessions(joinLogs, windowStart, windowEnd) {
  const byPlayer = new Map();
  const logs = (joinLogs || []).slice().sort((a, b) => a.Timestamp - b.Timestamp);
  for (const l of logs) {
    if (!byPlayer.has(l.Player)) byPlayer.set(l.Player, []);
    byPlayer.get(l.Player).push(l);
  }
  const sessions = [];
  for (const [player, evs] of byPlayer) {
    let open = null;
    for (const l of evs) {
      if (l.Join) open = l.Timestamp;
      else if (open != null) { sessions.push({ player, start: open, end: l.Timestamp }); open = null; }
    }
    if (open != null) sessions.push({ player, start: open, end: windowEnd });
  }
  return sessions
    .map((s) => ({ ...s, start: Math.max(s.start, windowStart), end: Math.min(s.end, windowEnd) }))
    .filter((s) => s.end > s.start);
}

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

function joinDistribution(joinLogs, windowStart, windowEnd) {
  const step = 300, buckets = [];
  for (let t = windowStart; t < windowEnd; t += step) {
    const n = (joinLogs || []).filter((l) => l.Join && l.Timestamp >= t && l.Timestamp < t + step).length;
    buckets.push({ t, n });
  }
  return buckets;
}

/* ----------------------- health score ----------------------------------- */
function healthScore(m) {
  const fill = clamp01(safeNum(m.peakConcurrent) / Math.max(1, safeNum(m.maxPlayers)));
  const retention = clamp01(safeNum(m.retained30) / Math.max(1, safeNum(m.uniquePlayers)));
  const growth = m.prevJoins == null ? 0.5 : clamp01(0.5 + (safeNum(m.joinsInWindow) - safeNum(m.prevJoins)) / Math.max(4, safeNum(m.prevJoins) * 2));
  const conversion = clamp01(safeNum(m.conversionPct) / 8);
  const staffRatio = m.uniquePlayers === 0 ? 0 : clamp01((safeNum(m.staffOnline) / Math.max(1, safeNum(m.uniquePlayers))) / 0.15);
  return Math.round(100 * (0.25 * fill + 0.25 * retention + 0.20 * growth + 0.15 * conversion + 0.15 * staffRatio));
}

const percentile = (arr, x) => {
  if (!arr.length) return null;
  return Math.round((arr.filter((v) => v < x).length / arr.length) * 100);
};

/* ----------------------- mod response estimate -------------------------- */
function estimateModResponse(modcalls, commands, windowStart, windowEnd) {
  const calls = (modcalls || [])
    .filter((m) => m.Timestamp >= windowStart && m.Timestamp <= windowEnd)
    .map((m) => m.Timestamp).sort((a, b) => a - b);
  const cmds = (commands || []).map((c) => c.Timestamp).sort((a, b) => a - b);
  if (!calls.length || !cmds.length) return null;
  const deltas = [];
  for (const call of calls) {
    const next = cmds.find((t) => t >= call && t - call <= 900);
    if (next != null) deltas.push((next - call) / 60);
  }
  return deltas.length ? Math.round(avg(deltas) * 10) / 10 : null;
}

/* ----------------------- funnel + growth narrative ---------------------- */
function funnelInsights(m) {
  const out = [];
  const views = safeNum(m.views);
  const entries = safeNum(m.entries);
  const conversionPct = safeNum(m.conversionPct);
  const retained30 = safeNum(m.retained30);
  if (views === 0) out.push("No views recorded. Share your listing link and boost it so it appears at the top of the discovery feed.");
  else out.push(`${views} people viewed the listing and ${entries} joined, a ${conversionPct}% conversion rate.`);
  if (views > 0 && conversionPct < 3) out.push("A stronger title and banner image, or a boost, usually lifts conversion significantly.");
  if (entries > 0 && retained30 / entries < 0.4) out.push("Players left fairly quickly. Tighter scenario pacing and visible active staff help retention.");
  if (entries > 0 && retained30 / entries >= 0.6) out.push("Strong retention. Whatever you ran here is working - keep this format.");
  if (!out.length) out.push("No listing data available yet for this event.");
  return out;
}

function growthAdvice(m) {
  const out = [];
  const peakConcurrent = safeNum(m.peakConcurrent);
  const maxPlayers = safeNum(m.maxPlayers, 40);
  const fill = peakConcurrent / Math.max(1, maxPlayers);
  const views = safeNum(m.views);
  const conversionPct = safeNum(m.conversionPct);
  const staffOnline = safeNum(m.staffOnline);
  if (fill < 0.5) out.push("Your server was under half full at peak. List in more communities and boost this event to pull a bigger crowd.");
  if (fill >= 0.9) out.push("You hit near-capacity. Consider a second linked server or staggered sessions so you stop turning players away.");
  if (views > 20 && conversionPct < 4) out.push("Plenty of eyes but fewer joins. Test a punchier title and a clearer scenario description.");
  if (staffOnline === 0) out.push("No staff were detected online. Even one visible moderator improves retention and trust.");
  if (!out.length) out.push("Healthy event across the board. Repeat this start time and scenario to build a regular audience.");
  return out;
}

function recommendStartHour(pastReports) {
  const byHour = {};
  for (const r of pastReports) {
    const h = new Date(r.windowStart).getUTCHours();
    byHour[h] = byHour[h] || [];
    byHour[h].push(safeNum(r.joinsInWindow));
  }
  let best = null, bestAvg = -1;
  for (const h of Object.keys(byHour)) {
    const a = avg(byHour[h]);
    if (a > bestAvg) { bestAvg = a; best = Number(h); }
  }
  return best;
}

/* ======================== NEW ANALYTICS FEATURES ======================== */

// PRO: Dead Hour Warning - find 20+ min windows with near-zero joins.
function detectDeadHours(joinTimeline, windowStart) {
  if (!joinTimeline || !joinTimeline.length) return null;
  const DEAD_THRESHOLD = 1; // joins per 5-min bucket
  const DEAD_WINDOW_BUCKETS = 4; // 4 x 5min = 20 min
  let deadStart = null, deadPeriods = [];
  for (let i = 0; i < joinTimeline.length; i++) {
    const bucket = joinTimeline[i];
    if (bucket.n <= DEAD_THRESHOLD) {
      if (deadStart === null) deadStart = i;
      if (i - deadStart + 1 >= DEAD_WINDOW_BUCKETS) {
        const startMin = Math.round((joinTimeline[deadStart].t - windowStart) / 60);
        const endMin = Math.round((bucket.t - windowStart) / 60);
        // Avoid duplicates.
        if (!deadPeriods.find((d) => d.startMin === startMin)) {
          deadPeriods.push({ startMin, endMin, durationMin: endMin - startMin });
        }
      }
    } else {
      deadStart = null;
    }
  }
  if (!deadPeriods.length) return null;
  const worst = deadPeriods.sort((a, b) => b.durationMin - a.durationMin)[0];
  return {
    periods: deadPeriods,
    worstPeriod: worst,
    advice: `Dead period detected: minute ${worst.startMin} to ${worst.endMin} (${worst.durationMin} min with near-zero joins). Consider restructuring your scenario so activity peaks in this window.`,
  };
}

// PRO: Scenario DNA - what works best for this server.
function buildScenarioDNA(pastReports) {
  if (!pastReports || pastReports.length < 3) return null;
  const byScenario = {};
  for (const r of pastReports) {
    const s = safeStr(r.scenario, "Unknown");
    if (!byScenario[s]) byScenario[s] = [];
    byScenario[s].push({
      score: safeNum(r.score),
      retention: safeNum(r.retained30) / Math.max(1, safeNum(r.uniquePlayers)),
      kills: safeNum(r.staff?.kills),
      joins: safeNum(r.joinsInWindow),
    });
  }
  const summary = Object.entries(byScenario)
    .filter(([, runs]) => runs.length >= 2)
    .map(([scenario, runs]) => ({
      scenario,
      runs: runs.length,
      avgScore: Math.round(avg(runs.map((r) => r.score))),
      avgRetention: Math.round(avg(runs.map((r) => r.retention)) * 100),
      avgKills: Math.round(avg(runs.map((r) => r.kills))),
      avgJoins: Math.round(avg(runs.map((r) => r.joins))),
    }))
    .sort((a, b) => b.avgScore - a.avgScore);
  if (!summary.length) return null;
  const best = summary[0];
  return {
    scenarios: summary,
    bestScenario: best.scenario,
    advice: `Your best-performing scenario is "${best.scenario}" (avg health score ${best.avgScore}/100, ${best.avgRetention}% retention). Run this when you need a strong event.`,
  };
}

// PRO: Loyalty Tracker - returning player rate.
function buildLoyaltyTracker(currentJoinLogs, pastReports, windowStart, windowEnd) {
  if (!pastReports || !pastReports.length) return null;
  const currentPlayers = new Set(
    (currentJoinLogs || [])
      .filter((l) => l.Join && l.Timestamp >= windowStart && l.Timestamp <= windowEnd)
      .map((l) => l.Player)
  );
  if (!currentPlayers.size) return null;
  // Collect all players from past events (stored in report join logs if available).
  const pastPlayerSets = pastReports
    .filter((r) => r.playerNames && r.playerNames.length)
    .map((r) => new Set(r.playerNames));
  if (!pastPlayerSets.length) return null;
  const returning = [...currentPlayers].filter((p) => pastPlayerSets.some((s) => s.has(p)));
  const returningRate = Math.round((returning.length / currentPlayers.size) * 100);
  return {
    totalPlayers: currentPlayers.size,
    returningPlayers: returning.length,
    returningRate,
    newPlayers: currentPlayers.size - returning.length,
    advice: returningRate >= 30
      ? `${returningRate}% of players have attended a previous event. You have a growing loyal community.`
      : returningRate > 0
      ? `Only ${returningRate}% returning players. Focus on community building between events to improve loyalty.`
      : "No returning players detected yet. Build a Discord community to convert one-time attendees into regulars.",
  };
}

// PRO: Staff vs Player Ratio Alert.
function buildStaffRatioAlert(sessions, windowStart, windowEnd, staffNames) {
  if (!sessions.length || !staffNames.size) return null;
  const step = 300;
  const alerts = [];
  for (let t = windowStart; t <= windowEnd; t += step) {
    const totalActive = sessions.filter((s) => s.start <= t && s.end >= t).length;
    const staffActive = sessions.filter((s) => staffNames.has(s.player) && s.start <= t && s.end >= t).length;
    if (totalActive >= 5 && staffActive === 0) {
      const minIntoEvent = Math.round((t - windowStart) / 60);
      alerts.push({ minuteIntoEvent: minIntoEvent, playerCount: totalActive, staffCount: 0 });
    } else if (totalActive >= 10 && staffActive > 0 && totalActive / staffActive > 10) {
      const minIntoEvent = Math.round((t - windowStart) / 60);
      alerts.push({ minuteIntoEvent: minIntoEvent, playerCount: totalActive, staffCount: staffActive, ratio: Math.round(totalActive / staffActive) });
    }
  }
  if (!alerts.length) return null;
  const worst = alerts[0];
  return {
    alerts: alerts.slice(0, 5),
    worstMoment: worst,
    advice: worst.staffCount === 0
      ? `No staff online at minute ${worst.worstMoment?.minuteIntoEvent ?? worst.minuteIntoEvent} with ${worst.playerCount} players in-server. This is when disruptions are most likely.`
      : `Staff-to-player ratio dropped below 1:10 at minute ${worst.minuteIntoEvent} (1 staff per ${worst.ratio} players). Have an extra moderator ready from the start.`,
  };
}

// ULTRA: Villain Detection - repeat disruptors across kill logs, mod calls, commands.
function detectVillains(killLogs, modCalls, commandLogs, windowStart, windowEnd) {
  const kills = (killLogs || []).filter((k) => k.Timestamp >= windowStart && k.Timestamp <= windowEnd);
  const calls = (modCalls || []).filter((m) => m.Timestamp >= windowStart && m.Timestamp <= windowEnd);
  const cmds = (commandLogs || []).filter((c) => c.Timestamp >= windowStart && c.Timestamp <= windowEnd);

  // Find players who were killed 2+ times.
  const killCounts = {};
  for (const k of kills) {
    if (k.Killed) killCounts[k.Killed] = (killCounts[k.Killed] || 0) + 1;
  }
  const repeatedlyKilled = new Set(Object.keys(killCounts).filter((p) => killCounts[p] >= 2));

  // Find players who triggered a mod call (caller names in mod call logs).
  const modCallNames = new Set(calls.map((m) => m.Caller || m.Player || m.Username).filter(Boolean));

  // Cross-reference: players who appear in mod calls AND were repeatedly killed.
  const villains = [...repeatedlyKilled].filter((p) => modCallNames.has(p));

  // Check if a staff command followed within 10 min of a kill involving them.
  const flagged = villains.map((name) => {
    const playerKills = kills.filter((k) => k.Killed === name);
    const latestKill = Math.max(...playerKills.map((k) => k.Timestamp));
    const staffActed = cmds.some((c) => c.Timestamp >= latestKill && c.Timestamp - latestKill <= 600);
    return {
      player: name,
      timesKilled: killCounts[name],
      triggeredModCall: true,
      staffActed,
    };
  });

  if (!flagged.length) return null;
  return {
    disruptors: flagged,
    count: flagged.length,
    advice: `${flagged.length} repeat disruptor${flagged.length > 1 ? "s" : ""} detected. Consider pre-emptive blacklisting for future events.`,
  };
}

// ULTRA: Staff Fatigue Score - response time degradation over the event.
function buildStaffFatigue(modCalls, commandLogs, windowStart, windowEnd) {
  const totalDuration = windowEnd - windowStart;
  if (totalDuration <= 0) return null;
  const midpoint = windowStart + totalDuration / 2;

  const firstHalfCalls = (modCalls || []).filter((m) => m.Timestamp >= windowStart && m.Timestamp < midpoint);
  const secondHalfCalls = (modCalls || []).filter((m) => m.Timestamp >= midpoint && m.Timestamp <= windowEnd);
  const cmds = (commandLogs || []).filter((c) => c.Timestamp >= windowStart && c.Timestamp <= windowEnd);

  const responseTime = (calls) => {
    const deltas = [];
    for (const call of calls) {
      const next = cmds.find((c) => c.Timestamp >= call.Timestamp && c.Timestamp - call.Timestamp <= 900);
      if (next) deltas.push((next.Timestamp - call.Timestamp) / 60);
    }
    return deltas.length ? avg(deltas) : null;
  };

  const first = responseTime(firstHalfCalls);
  const second = responseTime(secondHalfCalls);
  if (first == null || second == null) return null;

  const degradation = second - first;
  const fatigued = degradation > 3; // >3 min slower in second half = fatigue

  return {
    firstHalfAvgResponseMin: Math.round(first * 10) / 10,
    secondHalfAvgResponseMin: Math.round(second * 10) / 10,
    degradationMin: Math.round(degradation * 10) / 10,
    fatigued,
    advice: fatigued
      ? `Staff fatigue detected: response time increased by ${Math.round(degradation)} min in the final hour. Rotate moderators or reduce event duration.`
      : "Staff response time was consistent throughout the event. Good stamina.",
  };
}

// ULTRA: Queue Intelligence - estimated lost players.
function buildQueueIntelligence(peakQueue, maxPlayers, uniquePlayers) {
  if (!peakQueue || peakQueue === 0) return { peakQueue: 0, estimatedLost: 0, advice: "No queue detected during this event." };
  const overCapacity = peakQueue + maxPlayers;
  const overPct = ((overCapacity - maxPlayers) / maxPlayers) * 100;
  // Estimate: ~40% of queue players give up if queue > 20% of capacity.
  const estimatedLost = overPct > 20 ? Math.round(peakQueue * 0.4) : 0;
  return {
    peakQueue,
    overCapacityDemand: overCapacity,
    estimatedLost,
    advice: estimatedLost > 0
      ? `An estimated ${estimatedLost} players likely left the queue before joining. Consider running a second server when queue exceeds ${Math.round(maxPlayers * 0.2)} players.`
      : `Queue of ${peakQueue} players detected but drop-off was likely minimal.`,
  };
}

// ULTRA: Golden Hour - which join window had the best retention.
function buildGoldenHour(sessions, joinTimeline, windowStart) {
  if (!sessions.length || !joinTimeline.length) return null;
  const buckets = joinTimeline.map((bucket) => {
    const bucketStart = bucket.t;
    const bucketEnd = bucketStart + 300;
    // Players who joined in this 5-min window.
    const joinedHere = sessions.filter((s) => s.start >= bucketStart && s.start < bucketEnd);
    if (!joinedHere.length) return null;
    // Of those, how many stayed 30+ min.
    const retained = joinedHere.filter((s) => (s.end - s.start) >= 1800).length;
    const retentionRate = retained / joinedHere.length;
    const minuteIntoEvent = Math.round((bucketStart - windowStart) / 60);
    return { minuteIntoEvent, joinCount: joinedHere.length, retained, retentionRate };
  }).filter(Boolean);

  if (!buckets.length) return null;
  const best = buckets.sort((a, b) => b.retentionRate - a.retentionRate)[0];
  const endMin = best.minuteIntoEvent + 5;
  return {
    bestWindowStart: best.minuteIntoEvent,
    bestWindowEnd: endMin,
    retentionRate: Math.round(best.retentionRate * 100),
    joinCount: best.joinCount,
    advice: `Players who joined between minute ${best.minuteIntoEvent} and ${endMin} had the highest retention (${Math.round(best.retentionRate * 100)}%). That is when your scenario hit its stride - replicate that opening structure.`,
  };
}

// ULTRA: Moderation Pressure Map - when do mod calls cluster.
function buildModerationPressureMap(modCalls, windowStart, windowEnd) {
  if (!modCalls || !modCalls.length) return null;
  const calls = modCalls.filter((m) => m.Timestamp >= windowStart && m.Timestamp <= windowEnd);
  if (!calls.length) return null;
  const duration = windowEnd - windowStart;
  const firstThird = windowStart + duration / 3;
  const lastThird = windowStart + (2 * duration) / 3;
  const early = calls.filter((m) => m.Timestamp < firstThird).length;
  const mid = calls.filter((m) => m.Timestamp >= firstThird && m.Timestamp < lastThird).length;
  const late = calls.filter((m) => m.Timestamp >= lastThird).length;
  const total = calls.length;
  let pressureWindow, advice;
  if (early / total >= 0.6) {
    pressureWindow = "opening";
    advice = `${Math.round((early / total) * 100)}% of mod calls happened in the first third of your event. This suggests an onboarding problem - consider a clearer briefing at the start.`;
  } else if (late / total >= 0.6) {
    pressureWindow = "closing";
    advice = `${Math.round((late / total) * 100)}% of mod calls happened in the final third. Players get restless as the scenario winds down - end on a high note or add a structured conclusion.`;
  } else {
    pressureWindow = "spread";
    advice = "Mod calls were spread throughout the event. No single pressure window detected.";
  }
  return { early, mid, late, total, pressureWindow, advice };
}

// ULTRA: Ghost Staff Detection.
function detectGhostStaff(onlineStaff, commandsInWindow) {
  if (!onlineStaff || !onlineStaff.length) return null;
  const commanders = new Set(commandsInWindow.map((c) => c.Player).filter(Boolean));
  const ghosts = onlineStaff
    .filter((s) => isCommandStaff(s) && !commanders.has(s.name))
    .map((s) => ({ name: s.name, permission: s.permission || s.Permission }));
  if (!ghosts.length) return null;
  return {
    ghosts,
    count: ghosts.length,
    advice: `${ghosts.length} staff member${ghosts.length > 1 ? "s" : ""} with elevated permissions ran zero commands during the event. Review whether they were actively moderating.`,
  };
}

// ULTRA: Tipping Point - player count where retention drops.
function buildTippingPoint(pastReports) {
  if (!pastReports || pastReports.length < 5) return null;
  // Group events by peak player count range.
  const low = pastReports.filter((r) => safeNum(r.peakConcurrent) <= 20);
  const high = pastReports.filter((r) => safeNum(r.peakConcurrent) > 20);
  if (!low.length || !high.length) return null;
  const avgSessionLow = avg(low.map((r) => safeNum(r.avgSessionMin)));
  const avgSessionHigh = avg(high.map((r) => safeNum(r.avgSessionMin)));
  const diff = avgSessionLow - avgSessionHigh;
  if (diff < 5) return null; // Not a meaningful difference.
  return {
    optimalRange: "15-20",
    avgSessionBelow: Math.round(avgSessionLow),
    avgSessionAbove: Math.round(avgSessionHigh),
    dropOffMin: Math.round(diff),
    advice: `Your sessions run ${Math.round(diff)} min longer when player count stays below 20. Your optimal server size for quality events is 15-20 players.`,
  };
}

// ULTRA: Health Trend Line over last 10 events.
function buildHealthTrend(pastReports) {
  if (!pastReports || pastReports.length < 3) return null;
  const recent = pastReports.slice(0, 10).reverse();
  const scores = recent.map((r) => safeNum(r.score));
  // Simple moving average.
  const movingAvg = scores.map((_, i) => {
    const window = scores.slice(Math.max(0, i - 2), i + 1);
    return Math.round(avg(window));
  });
  const trend = scores.length >= 3
    ? scores[scores.length - 1] > scores[0] ? "improving" : scores[scores.length - 1] < scores[0] ? "declining" : "stable"
    : "stable";
  return {
    scores,
    movingAvg,
    trend,
    advice: trend === "declining"
      ? "Your health score is trending down over recent events. Review what changed - staffing, scenario choice, and timing are the most common culprits."
      : trend === "improving"
      ? "Your health score is improving event-on-event. Keep the current format."
      : "Your health score is stable. Consistent is good - look for one variable to test for improvement.",
  };
}

/* ----------------------- Scenario Fatigue Index (PRO) ------------------- */
function buildScenarioFatigue(scenario, pastReports) {
  if (!scenario || !pastReports || pastReports.length < 3) return null;
  const sameScenario = pastReports
    .filter((r) => safeStr(r.scenario, "") === scenario)
    .slice(0, 8)
    .reverse();
  if (sameScenario.length < 3) return null;
  const scores = sameScenario.map((r) => safeNum(r.score));
  const first = avg(scores.slice(0, Math.ceil(scores.length / 2)));
  const second = avg(scores.slice(Math.floor(scores.length / 2)));
  const fatigued = first - second > 10;
  return {
    runs: sameScenario.length,
    avgScoreEarly: Math.round(first),
    avgScoreRecent: Math.round(second),
    fatigued,
    advice: fatigued
      ? `"${scenario}" is showing fatigue - scores have dropped ${Math.round(first - second)} points over recent runs. Rotate to a different scenario for 2-3 events.`
      : `"${scenario}" is still performing well. No fatigue detected.`,
  };
}

/* ----------------------- AI summary ------------------------------------- */
async function aiSummaryFor(metrics, kind = "event") {
  const prompt = `You are Gatherly's analytics engine for ER:LC (Roblox roleplay) ${kind === "weekly" ? "weekly server performance" : "post-event"} reports. Write a sharp, data-driven summary of 4 to 5 sentences for the server host.
Cover: what happened, the single most notable signal, one specific thing to improve, and one thing to keep doing. Be concrete and reference the numbers. No fluff, no greeting. Do not use em dashes.

Data (JSON):
${JSON.stringify(metrics).slice(0, 3500)}`;
  return (await aiText(prompt, { max_tokens: 360 })) || "Analytics summary unavailable. All data below is still accurate.";
}

/* ------------------------------ delivery -------------------------------- */
async function deliverReport(user, ev, report, eventId) {
  const SITE_URL = process.env.SITE_URL || "https://gatherly-erlc.xyz";
  let dm = { ok: false }, hook = false, rec = { ok: false };

  // Send v2 report DM.
  const dmPayload = reportDmPayload(ev, report, eventId);

  if (ev.reportRecipientId) {
    try {
      const ch = await discordBotFetch("/users/@me/channels", {
        method: "POST", body: JSON.stringify({ recipient_id: ev.reportRecipientId }),
      });
      if (ch.ok) {
        const { id: channelId } = await ch.json();
        const r = await discordBotFetch(`/channels/${channelId}/messages`, {
          method: "POST", body: JSON.stringify(dmPayload),
        });
        rec = { ok: r.ok };
      }
    } catch {}
  }

  if (user.dmOptIn && user.discordId) {
    try {
      const ch = await discordBotFetch("/users/@me/channels", {
        method: "POST", body: JSON.stringify({ recipient_id: user.discordId }),
      });
      if (ch.ok) {
        const { id: channelId } = await ch.json();
        const r = await discordBotFetch(`/channels/${channelId}/messages`, {
          method: "POST", body: JSON.stringify(dmPayload),
        });
        dm = { ok: r.ok };
      }
    } catch {}
  }

  if (user.discordWebhook) {
    // Webhook delivery uses standard embed (webhooks don't support components v2).
    const scoreColor = report.score >= 70 ? BRAND.green : report.score >= 45 ? BRAND.color : BRAND.red;
    const webhookPayload = {
      username: "Gatherly Reports",
      embeds: [{
        title: `Report ready: ${ev.title}`,
        color: scoreColor,
        description: [
          `### ${safeStr(report.serverName, "Your server")}`,
          `> ${(report.aiSummary || "Your event has been analysed.").slice(0, 600)}`,
          "",
          `**Health score:** ${report.score}/100`,
          `**Players joined:** ${report.uniquePlayers}`,
          `**Peak in-server:** ${report.peakConcurrent}/${report.maxPlayers}`,
          `**Retained 30 min:** ${report.retained30}`,
          "",
          `[View Full Report](${SITE_URL}/reports?event=${eventId})`,
        ].join("\n"),
        timestamp: new Date().toISOString(),
        footer: { text: "Gatherly Analytics" },
      }],
    };
    hook = await postDiscordWebhook(user.discordWebhook, webhookPayload);
  }

  return { dm: dm.ok, webhook: hook, recipient: rec.ok };
}

/* ------------------------------- handler -------------------------------- */
export default async (req) => {
  try { return await handler(req); }
  catch (e) {
    try { await auditError(null, "erlc.crash", e?.message || "unknown"); } catch {}
    return json({ error: "Server error: " + (e?.message || "unknown") }, 500);
  }
};

async function handler(req) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  if (action === "status") {
    try {
      const r = await fetchT(ERLC_BASE + "/server", { headers: { "server-key": "status-probe" } }, 5000);
      return json({ up: r.status !== 502 && r.status !== 503 && r.status !== 504 });
    } catch { return json({ up: false }); }
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
    if (key) {
      try {
        const s = await erlcGet("/server", key);
        checks.erlcConnection = { ok: true, detail: `Connected: ${safeStr(s.Name, "Server")}` };
      } catch (e) { checks.erlcConnection = { ok: false, detail: e.message }; }
    } else {
      checks.erlcConnection = { ok: false, detail: "No ER:LC key saved yet" };
    }
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
    try {
      const s = await erlcGet("/server", key);
      return json({ ok: true, serverName: safeStr(s.Name, "Server") });
    } catch (e) {
      await auditError(user, "erlc.test-key", e.message);
      return json({ ok: false, error: e.message });
    }
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
        erlcGet("/server", key),
        erlcGet("/server/players", key),
        erlcGet("/server/queue", key).catch(() => ({ Queue: [] })),
      ]);
      const playerList = Array.isArray(players) ? players : [];
      const staffList = playerList.filter((p) => isStaffMember(p));
      return json({
        data: {
          serverName: safeStr(server.Name, "Server"),
          playerCount: Math.min(PLAYER_CAP, playerList.length),
          maxPlayers: Math.min(PLAYER_CAP, safeNum(server.MaxPlayers, PLAYER_CAP)),
          queueCount: Array.isArray(queue?.Queue) ? queue.Queue.length : (Array.isArray(queue) ? queue.length : 0),
          staffOnline: staffList.length,
        },
      });
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
    const hasPro = lvl >= 1;
    const hasUltra = lvl >= 2;

    const windowStart = Math.floor(new Date(ev.startsAt).getTime() / 1000);
    const windowEnd = Math.floor(windowStart + (ev.durationMin || 60) * 60);
    if (Math.floor(Date.now() / 1000) < windowStart) return json({ error: "The event has not started yet." }, 400);

    // Fetch all ER:LC data. Every endpoint is attempted independently so one failure
    // does not wipe the rest of the report.
    let serverData, playersData, joinLogs, commandLogs, modCallData, queueData, killLogs;
    try {
      [serverData, playersData] = await Promise.all([
        erlcGet("/server", key),
        erlcGet("/server/players", key),
      ]);
    } catch (e) {
      await auditError(user, "erlc.report", e.message);
      return json({ error: e.message }, 502);
    }

    [joinLogs, commandLogs, modCallData, queueData, killLogs] = await Promise.allSettled([
      erlcGet("/server/joinlogs", key),
      erlcGet("/server/commandlogs", key),
      erlcGet("/server/modcalls", key),
      erlcGet("/server/queue", key),
      erlcGet("/server/killlogs", key),
    ]).then((rs) => rs.map((r) => (r.status === "fulfilled" ? r.value : [])));

    // Ensure all are arrays.
    joinLogs = Array.isArray(joinLogs) ? joinLogs : [];
    commandLogs = Array.isArray(commandLogs) ? commandLogs : [];
    modCallData = Array.isArray(modCallData) ? modCallData : [];
    killLogs = Array.isArray(killLogs) ? killLogs : [];

    const maxPlayers = Math.min(PLAYER_CAP, safeNum(serverData?.MaxPlayers, PLAYER_CAP));
    const playerList = Array.isArray(playersData) ? playersData : [];

    // Window-filtered logs.
    const windowJoinLogs = joinLogs.filter((l) => l.Timestamp >= windowStart && l.Timestamp <= windowEnd);
    const commandsInWindow = commandLogs.filter((c) => c.Timestamp >= windowStart && c.Timestamp <= windowEnd);
    const modCalls = modCallData.filter((m) => m.Timestamp >= windowStart && m.Timestamp <= windowEnd);
    const killsInWindow = killLogs.filter((k) => k.Timestamp >= windowStart && k.Timestamp <= windowEnd);

    // Sessions and concurrency.
    const sessions = buildSessions(windowJoinLogs, windowStart, windowEnd);
    const uniquePlayers = new Set(windowJoinLogs.map((l) => l.Player)).size;
    const { peak: peakConcurrent, peakAt, timeline } = concurrency(sessions, windowStart, windowEnd, maxPlayers);
    const joinTimeline = joinDistribution(windowJoinLogs, windowStart, windowEnd);
    const retained30 = sessions.filter((s) => (s.end - s.start) >= 1800).length;
    const retained60 = sessions.filter((s) => (s.end - s.start) >= 3600).length;
    const avgSessionMin = sessions.length ? Math.round(avg(sessions.map((s) => (s.end - s.start))) / 60) : 0;

    // Queue.
    const peakQueue = Array.isArray(queueData?.Queue) ? queueData.Queue.length : (Array.isArray(queueData) ? queueData.length : 0);

    // Staff - include anyone with non-Normal permission.
    const onlineStaff = playerList
      .filter((p) => isStaffMember(p))
      .map((p) => ({
        name: safeStr(p.Player, "Unknown"),
        permission: safeStr(p.Permission, "Staff"),
        team: safeStr(p.Team, "Unknown"),
      }));

    const staffNames = new Set(onlineStaff.map((s) => s.name));

    // Staff moderation counts from command logs.
    const modCounts = {};
    for (const c of commandsInWindow) {
      const player = c.Player || c.Username || c.Name;
      if (player) modCounts[player] = (modCounts[player] || 0) + 1;
    }

    const staffLeaderboard = onlineStaff
      .map((s) => ({ name: s.name, permission: s.permission, team: s.team, moderations: safeNum(modCounts[s.name]) }))
      .sort((a, b) => b.moderations - a.moderations);

    const estimatedResponseMin = estimateModResponse(modCalls, commandsInWindow, windowStart, windowEnd);

    const views = safeNum(ev.views);
    const conversionPct = pct(uniquePlayers, views);

    // --- Merge with previous report data to avoid resetting on regeneration ---
    const prevReport = ev.lastReport || null;
    let prevJoins = prevReport ? safeNum(prevReport.joinsInWindow) : null;

    // Load past reports for trend analysis.
    let pastReports = [];
    try {
      const { blobs } = await eventStore.list();
      const all = await Promise.all(blobs.map((b) => eventStore.get(b.key, { type: "json" })));
      pastReports = all
        .filter((e) => e && e.userId === user.id && e.id !== eventId && e.lastReport)
        .map((e) => e.lastReport)
        .sort((a, b) => new Date(b.windowStart) - new Date(a.windowStart));
      if (pastReports.length && prevJoins === null) prevJoins = safeNum(pastReports[0].joinsInWindow);
    } catch {}

    const metrics = {
      eventTitle: safeStr(ev.title, "Event"),
      serverName: safeStr(serverData?.Name, "Your server"),
      scenario: safeStr(ev.scenario, "Not specified"),
      joinsInWindow: uniquePlayers,
      uniquePlayers,
      peakConcurrent,
      peakQueue,
      avgSessionMin,
      retained30,
      retained60,
      staffOnline: onlineStaff.length,
      modCalls: modCalls.length,
      commands: commandsInWindow.length,
      kills: killsInWindow.length,
      maxPlayers,
      conversionPct,
      prevJoins,
      views,
    };

    const score = healthScore(metrics);

    // --- Tier-gated analytics ---
    let benchmark = null;
    let scenarioDNA = null;
    let deadHour = null;
    let loyaltyTracker = null;
    let staffRatioAlert = null;
    let scenarioFatigue = null;

    let villainDetection = null;
    let staffFatigue = null;
    let queueIntelligence = null;
    let goldenHour = null;
    let moderationPressureMap = null;
    let ghostStaff = null;
    let tippingPoint = null;
    let healthTrend = null;

    if (hasPro) {
      // Benchmarking.
      try {
        const { blobs } = await eventStore.list();
        const all = await Promise.all(blobs.map((b) => eventStore.get(b.key, { type: "json" })));
        const cohort = all
          .filter((e) => e && e.scenario === ev.scenario && e.lastReport && e.id !== eventId)
          .map((e) => e.lastReport);
        if (cohort.length >= 3) {
          benchmark = {
            cohortSize: cohort.length,
            peakPercentile: percentile(cohort.map((e) => safeNum(e.peakConcurrent)), peakConcurrent),
            sessionPercentile: percentile(cohort.map((e) => safeNum(e.avgSessionMin)), avgSessionMin),
            platformAvgSessionMin: Math.round(avg(cohort.map((e) => safeNum(e.avgSessionMin)))),
          };
        }
      } catch {}

      scenarioDNA = buildScenarioDNA(pastReports);
      deadHour = detectDeadHours(joinTimeline, windowStart);
      loyaltyTracker = buildLoyaltyTracker(windowJoinLogs, pastReports, windowStart, windowEnd);
      staffRatioAlert = buildStaffRatioAlert(sessions, windowStart, windowEnd, staffNames);
      scenarioFatigue = buildScenarioFatigue(ev.scenario, pastReports);
    }

    if (hasUltra) {
      villainDetection = detectVillains(killsInWindow, modCalls, commandsInWindow, windowStart, windowEnd);
      staffFatigue = buildStaffFatigue(modCalls, commandsInWindow, windowStart, windowEnd);
      queueIntelligence = buildQueueIntelligence(peakQueue, maxPlayers, uniquePlayers);
      goldenHour = buildGoldenHour(sessions, joinTimeline, windowStart);
      moderationPressureMap = buildModerationPressureMap(modCalls, windowStart, windowEnd);
      ghostStaff = detectGhostStaff(onlineStaff, commandsInWindow);
      tippingPoint = buildTippingPoint(pastReports);
      healthTrend = buildHealthTrend(pastReports);
    }

    // Forecast (Ultra only, needs 2+ past reports).
    let forecast = null;
    if (hasUltra && pastReports.length >= 2) {
      const recent = pastReports.slice(0, 4).map((e) => safeNum(e.joinsInWindow));
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

    const aiSummary = await aiSummaryFor({ ...metrics, score, benchmark, forecast });

    const nextForecastTease = hasUltra
      ? `In your next forecast we will pinpoint your single best start time and project your peak by day of week, using your most recent ${Math.min(8, pastReports.length + 1)} events.`
      : hasPro
      ? "Upgrade to Gatherly Ultra to unlock predictive forecasting, villain detection, and ghost staff analysis."
      : "Upgrade to Gatherly Pro to unlock benchmarking, scenario DNA, and dead hour detection.";

    // Store player names for loyalty tracking in future events.
    const playerNames = [...new Set(windowJoinLogs.map((l) => l.Player))];

    const report = {
      eventTitle: safeStr(ev.title, "Event"),
      serverName: safeStr(serverData?.Name, "Your server"),
      scenario: safeStr(ev.scenario, "Not specified"),
      score,
      plan: effectivePlan(user),
      uniquePlayers,
      joinsInWindow: uniquePlayers,
      peakConcurrent,
      peakAt: new Date(peakAt * 1000).toISOString(),
      avgSessionMin,
      retained30,
      retained60,
      maxPlayers,
      fillPct: pct(peakConcurrent, maxPlayers),
      queue: {
        peak: peakQueue,
        note: `In-server players are capped at ${maxPlayers}. The queue can go higher and is counted separately.`,
      },
      conversionPct,
      windowStart: new Date(windowStart * 1000).toISOString(),
      windowEnd: new Date(windowEnd * 1000).toISOString(),
      generatedAt: new Date().toISOString(),
      timeline: timeline.map((p) => ({ t: new Date(p.t * 1000).toISOString(), n: p.n })),
      joinTimeline: joinTimeline.map((p) => ({ t: new Date(p.t * 1000).toISOString(), n: p.n })),
      funnel: { views, reveals: safeNum(ev.reveals), entries: uniquePlayers, retained30 },
      funnelInsights: funnelInsights({ views, entries: uniquePlayers, conversionPct, retained30 }),
      growthAdvice: growthAdvice({ peakConcurrent, maxPlayers, views, conversionPct, staffOnline: onlineStaff.length }),
      staff: {
        online: onlineStaff,
        totalModerations: commandsInWindow.length,
        modCalls: modCalls.length,
        leaderboard: staffLeaderboard.slice(0, 8),
        bestStaff: staffLeaderboard[0] || null,
        estimatedResponseMin: estimatedResponseMin ?? "N/A",
        kills: killsInWindow.length,
      },
      playerNames,
      benchmark,
      scenarioDNA,
      deadHour,
      loyaltyTracker,
      staffRatioAlert,
      scenarioFatigue,
      villainDetection,
      staffFatigue,
      queueIntelligence,
      goldenHour,
      moderationPressureMap,
      ghostStaff,
      tippingPoint,
      healthTrend,
      forecast,
      momentum,
      nextForecastTease,
      aiSummary,
      disclaimer: "Some data points rely on ER:LC API logs which may have a short delay or be incomplete for very short events. Staff detection includes all players with Moderator permissions or above. Data is accurate to within one polling cycle.",
      generatedBy: "Gatherly API v3",
    };

    const delivery = await deliverReport(user, ev, report, eventId).catch(() => ({}));
    report.delivery = delivery;

    // MERGE with previous report data - never reset, always accumulate.
    const merged = {
      ...prevReport,
      ...report,
      // Keep the highest unique player count seen across all generations.
      uniquePlayers: Math.max(safeNum(prevReport?.uniquePlayers), uniquePlayers),
      joinsInWindow: Math.max(safeNum(prevReport?.joinsInWindow), uniquePlayers),
      peakConcurrent: Math.max(safeNum(prevReport?.peakConcurrent), peakConcurrent),
      retained30: Math.max(safeNum(prevReport?.retained30), retained30),
    };

    await eventStore.setJSON(eventId, { ...ev, lastReport: merged });
    await audit(user, "erlc.report", { eventId, score });
    return json({ ok: true, report: merged });
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
    const totalJoins = reps.reduce((s, r) => s + safeNum(r.joinsInWindow), 0);
    const peak = Math.max(...reps.map((r) => safeNum(r.peakConcurrent)));
    const avgSession = Math.round(avg(reps.map((r) => safeNum(r.avgSessionMin))));
    const avgScore = Math.round(avg(reps.map((r) => safeNum(r.score))));
    const totalMods = reps.reduce((s, r) => s + safeNum(r.staff?.totalModerations), 0);

    const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const r of reps) {
      const d = new Date(r.windowStart);
      grid[d.getUTCDay()][d.getUTCHours()] += safeNum(r.joinsInWindow);
    }
    const best = reps.slice().sort((a, b) => safeNum(b.score) - safeNum(a.score))[0];

    const summary = await aiSummaryFor({
      kind: "weekly", events: reps.length, totalJoins, peak, avgSession, avgScore,
      totalModerations: totalMods,
      bestEvent: best ? { title: best.eventTitle, score: best.score } : null,
    }, "weekly");

    const report = {
      plan: "ultra",
      periodDays: 7,
      events: reps.length,
      totalJoins,
      peakConcurrent: peak,
      avgSessionMin: avgSession,
      avgScore,
      totalModerations: totalMods,
      heatmap: grid,
      bestEvent: best ? { title: best.eventTitle, score: best.score, joins: best.joinsInWindow } : null,
      trend: reps.map((r) => ({ at: r.windowStart, joins: r.joinsInWindow, score: r.score })).reverse(),
      forecastNextWeek: {
        projectedJoins: [Math.round(totalJoins * 0.9), Math.round(totalJoins * 1.2)],
        note: "Based on this week's volume. Keep your strongest start times to land at the top of the range.",
      },
      aiSummary: summary,
      generatedAt: new Date().toISOString(),
      generatedBy: "Gatherly Weekly (Ultra)",
    };
    await audit(user, "erlc.weekly-report", { events: reps.length });
    return json({ ok: true, report });
  }

  return json({ error: "Unknown action." }, 404);
}
