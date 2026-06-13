// /api/events - listings CRUD, join-code reveal, funnel tracking, platform stats, boosting, search.
import {
  json, eventsStore, requireUser, usersStore, id, clampStr, rateLimit, audit, auditError, decrypt,
} from "../lib/util.js";

const MAX_DURATION_MIN = 90;
const MIN_DURATION_MIN = 15;
const DAILY_EVENT_CAP = 10;
const ERLC_BASE = "https://api.policeroleplay.community/v1";

const endMs = (ev) => new Date(ev.startsAt).getTime() + (ev.durationMin || 60) * 60000;
const isEnded = (ev) => Date.now() > endMs(ev);
const isLive = (ev) => { const s = new Date(ev.startsAt).getTime(); return Date.now() >= s && Date.now() <= endMs(ev); };

async function fetchT(url, opts = {}, ms = 4000) { return fetch(url, { ...opts, signal: AbortSignal.timeout(ms) }); }

const countCache = new Map();
async function getLivePlayerCount(ev) {
  const cached = countCache.get(ev.userId);
  if (cached && Date.now() - cached.at < 30000) return cached.count;
  try {
    const hostUser = await usersStore().get(ev.userId, { type: "json" });
    if (!hostUser || !hostUser.erlcKeyEnc) return null;
    const key = String(decrypt(hostUser.erlcKeyEnc) || "").replace(/[\u200B-\u200D\uFEFF"'`]/g, "").trim();
    if (!key) return null;
    const r = await fetchT(`${ERLC_BASE}/server/players`, { headers: { "server-key": key, Accept: "application/json" } });
    if (!r.ok) return null;
    const players = await r.json();
    const count = Array.isArray(players) ? players.length : null;
    countCache.set(ev.userId, { count, at: Date.now() });
    return count;
  } catch { return null; }
}

const PUBLIC_FIELDS = (ev, playerCount = null) => ({
  id: ev.id, title: ev.title, description: ev.description, scenario: ev.scenario,
  startsAt: ev.startsAt, durationMin: ev.durationMin, endsAt: new Date(endMs(ev)).toISOString(),
  bannerUrl: ev.bannerId ? `/api/image?id=${ev.bannerId}` : (ev.bannerUrl || null),
  hostUsername: ev.hostUsername, boosted: Boolean(ev.boosted), live: isLive(ev),
  views: ev.views || 0, playerCount: isLive(ev) ? playerCount : null,
});

async function allEvents() {
  const store = eventsStore();
  const { blobs } = await store.list();
  const events = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
  return events.filter(Boolean);
}

export default async (req) => {
  try { return await handler(req); }
  catch (e) { try { await auditError(null, "events.crash", e?.message || "unknown"); } catch {} return json({ error: "Server error: " + (e?.message || "unknown") }, 500); }
};

async function handler(req) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const store = eventsStore();

  if (action === "list") {
    const q = (url.searchParams.get("q") || "").toLowerCase().trim();
    const filter = url.searchParams.get("filter") || "all";
    let events = (await allEvents()).filter((e) => !isEnded(e));
    if (q) events = events.filter((e) => [e.title, e.scenario, e.description, e.hostUsername].filter(Boolean).join(" ").toLowerCase().includes(q));
    if (filter === "live") events = events.filter(isLive);
    if (filter === "upcoming") events = events.filter((e) => !isLive(e));
    if (filter === "boosted") events = events.filter((e) => e.boosted);

    const withCounts = await Promise.all(events.map(async (e) => {
      const count = isLive(e) ? await getLivePlayerCount(e).catch(() => null) : null;
      return PUBLIC_FIELDS(e, count);
    }));

    if (filter === "members") withCounts.sort((a, b) => (b.playerCount || 0) - (a.playerCount || 0));
    else withCounts.sort((a, b) => (Number(b.boosted) - Number(a.boosted)) || (Number(b.live) - Number(a.live)) || (new Date(a.startsAt) - new Date(b.startsAt)));
    return json({ events: withCounts });
  }

  if (action === "recent") {
    const live = (await allEvents()).filter(isLive).map((e) => ({ id: e.id, title: e.title, scenario: e.scenario, live: true, endedAt: null }));
    const recent = (await allEvents()).filter((e) => isEnded(e) && Date.now() - endMs(e) < 3600000).sort((a, b) => endMs(b) - endMs(a)).map((e) => ({ id: e.id, title: e.title, scenario: e.scenario, live: false, endedAt: new Date(endMs(e)).toISOString(), peak: e.lastReport?.peakConcurrent ?? null }));
    return json({ events: live.concat(recent).slice(0, 20) });
  }

  if (action === "pulse") {
    const events = await allEvents();
    const live = events.filter(isLive);
    const upcoming = events.filter((e) => !isEnded(e) && !isLive(e));
    return json({ live: live.length, upcoming: upcoming.length, blips: live.concat(upcoming.slice(0, 8)).slice(0, 12).map((e) => ({ id: e.id, title: e.title, scenario: e.scenario, live: isLive(e), startsAt: e.startsAt })) });
  }

  if (action === "heatmap") {
    const grid = Array.from({ length: 7 }, () => Array(24).fill(null).map(() => ({ n: 0, sum: 0 })));
    let reportedCount = 0;
    for (const e of await allEvents()) {
      if (!e.lastReport) continue;
      reportedCount++;
      const d = new Date(e.startsAt);
      const cell = grid[d.getUTCDay()][d.getUTCHours()];
      cell.n += 1; cell.sum += e.lastReport.joinsInWindow || 0;
    }
    return json({ grid: grid.map((row) => row.map((c) => (c.n ? Math.round(c.sum / c.n) : null))), reportedCount });
  }

  if (action === "view" && req.method === "POST") {
    const evId = url.searchParams.get("id");
    const ev = await store.get(evId, { type: "json" });
    if (ev) { ev.views = (ev.views || 0) + 1; await store.setJSON(evId, ev); }
    return json({ ok: true });
  }

  if (action === "join") {
    const evId = url.searchParams.get("id");
    const ev = await store.get(evId, { type: "json" });
    if (!ev) return json({ error: "Event not found." }, 404);
    if (isEnded(ev)) return json({ error: "This event has ended." }, 410);
    if (!isLive(ev)) return json({ error: "This event has not started yet." }, 400);
    ev.reveals = (ev.reveals || 0) + 1;
    await store.setJSON(evId, ev);
    return json({ joinCode: ev.joinCode });
  }

  const user = await requireUser(req);
  if (!user) return json({ error: "Log in first." }, 401);

  if (action === "boost" && req.method === "POST") {
    const evId = url.searchParams.get("id");
    const ev = await store.get(evId, { type: "json" });
    if (!ev) return json({ error: "Event not found." }, 404);
    if (ev.userId !== user.id) return json({ error: "Not your event." }, 403);
    if (isEnded(ev)) return json({ error: "Cannot boost an ended event." }, 400);
    if (ev.boosted) return json({ error: "This event is already boosted." }, 400);
    const credits = user.credits ?? 0;
    if (credits < 1) return json({ error: "You need at least 1 boost credit. Get more on the pricing page." }, 402);
    await usersStore().setJSON(user.id, { ...user, credits: credits - 1, updatedAt: new Date().toISOString() });
    ev.boosted = true; ev.boostedAt = new Date().toISOString(); ev.boostedBy = user.username;
    await store.setJSON(evId, ev);
    await audit(user, "event.boost-self", { eventId: evId, creditsRemaining: credits - 1 });
    return json({ ok: true, creditsRemaining: credits - 1 });
  }

  if (action === "mine") {
    const events = (await allEvents()).filter((e) => e.userId === user.id)
      .sort((a, b) => new Date(b.startsAt) - new Date(a.startsAt))
      .map((e) => ({ id: e.id, title: e.title, scenario: e.scenario, startsAt: e.startsAt, durationMin: e.durationMin, joinCode: e.joinCode, views: e.views || 0, live: isLive(e), ended: isEnded(e), boosted: Boolean(e.boosted), lastReport: e.lastReport || null }));
    return json({ events });
  }

  if (action === "create" && req.method === "POST") {
    if (!(await rateLimit(`create:${user.id}`, DAILY_EVENT_CAP, 86400))) return json({ error: "Daily event limit reached. You can list up to 10 events per day." }, 429);
    const b = await req.json().catch(() => ({}));
    if (b.website) return json({ ok: true });
    const startsAt = new Date(b.startsAt);
    if (isNaN(startsAt)) return json({ error: "Invalid start time." }, 400);
    const durationMin = Math.min(MAX_DURATION_MIN, Math.max(MIN_DURATION_MIN, parseInt(b.durationMin, 10) || 60));
    const wantsBoost = Boolean(b.boost);
    const credits = user.credits ?? 0;
    if (wantsBoost && credits < 1) return json({ error: "You chose to boost but have no credits. Uncheck boost or buy credits." }, 402);

    const ev = {
      id: id(), userId: user.id, hostUsername: user.username,
      title: clampStr(b.title, 80), description: clampStr(b.description, 400),
      scenario: clampStr(b.scenario, 60), joinCode: clampStr(b.joinCode, 32),
      startsAt: startsAt.toISOString(), durationMin,
      bannerId: b.bannerId || null, reportRecipientId: clampStr(b.reportRecipientId, 32) || null,
      views: 0, reveals: 0, boosted: false, createdAt: new Date().toISOString(),
    };
    if (!ev.title || !ev.scenario || !ev.joinCode) return json({ error: "Title, scenario, and join code are required." }, 400);

    if (wantsBoost) {
      ev.boosted = true; ev.boostedAt = new Date().toISOString(); ev.boostedBy = user.username;
      await usersStore().setJSON(user.id, { ...user, credits: credits - 1, updatedAt: new Date().toISOString() });
    }
    await store.setJSON(ev.id, ev);
    await audit(user, "event.create", { eventId: ev.id, boosted: wantsBoost });
    return json({ ok: true, event: ev, boosted: wantsBoost, creditsRemaining: wantsBoost ? credits - 1 : credits });
  }

  if (action === "delete" && req.method === "POST") {
    const evId = url.searchParams.get("id");
    const ev = await store.get(evId, { type: "json" });
    if (!ev) return json({ error: "Event not found." }, 404);
    if (ev.userId !== user.id) return json({ error: "Not your event." }, 403);
    await store.delete(evId);
    await audit(user, "event.delete", { eventId: evId });
    return json({ ok: true });
  }

  return json({ error: "Unknown action." }, 404);
}
