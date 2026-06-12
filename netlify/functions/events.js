// /api/events - event listings CRUD, join-code reveal, funnel tracking, platform stats.
import {
  json, eventsStore, requireUser, id, clampStr, rateLimit, clientIp, audit,
} from "../lib/util.js";

const MAX_DURATION_MIN = 90;   // hard platform cap: 1.5 hours
const MIN_DURATION_MIN = 15;
const DAILY_EVENT_CAP = 10;    // per host, abuse protection

const endMs = (ev) => new Date(ev.startsAt).getTime() + (ev.durationMin || 60) * 60000;
const isEnded = (ev) => Date.now() > endMs(ev);
const isLive = (ev) => {
  const s = new Date(ev.startsAt).getTime();
  return Date.now() >= s && Date.now() <= endMs(ev);
};

const PUBLIC_FIELDS = (ev) => ({
  id: ev.id, title: ev.title, description: ev.description, scenario: ev.scenario,
  startsAt: ev.startsAt, durationMin: ev.durationMin, endsAt: new Date(endMs(ev)).toISOString(),
  bannerUrl: ev.bannerUrl, hostUsername: ev.hostUsername,
  boosted: Boolean(ev.boosted), live: isLive(ev),
  views: ev.views || 0,
});

async function allEvents() {
  const store = eventsStore();
  const { blobs } = await store.list();
  const events = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
  return events.filter(Boolean);
}

export default async (req) => {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const store = eventsStore();

  // ---- public feed: ended events disappear the moment they end ----
  if (action === "list") {
    const events = (await allEvents())
      .filter((e) => !isEnded(e))
      .map(PUBLIC_FIELDS)
      .sort((a, b) => (b.boosted - a.boosted) || (b.live - a.live) || (new Date(a.startsAt) - new Date(b.startsAt)));
    return json({ events });
  }

  // ---- recently completed ticker (titles + times only, last 24h) ----
  if (action === "recent") {
    const events = (await allEvents())
      .filter((e) => isEnded(e) && Date.now() - endMs(e) < 86400000)
      .sort((a, b) => endMs(b) - endMs(a))
      .slice(0, 12)
      .map((e) => ({ title: e.title, scenario: e.scenario, endedAt: new Date(endMs(e)).toISOString(), peak: e.lastReport?.peakConcurrent ?? null }));
    return json({ events });
  }

  // ---- live count for the homepage radar ----
  if (action === "pulse") {
    const events = await allEvents();
    const live = events.filter(isLive);
    const upcoming = events.filter((e) => !isEnded(e) && !isLive(e));
    return json({
      live: live.length,
      upcoming: upcoming.length,
      blips: live.concat(upcoming.slice(0, 8)).slice(0, 12).map((e) => ({
        title: e.title, scenario: e.scenario, live: isLive(e), startsAt: e.startsAt,
      })),
    });
  }

  // ---- platform heatmap: avg report joins by day-of-week x start hour ----
  if (action === "heatmap") {
    const grid = Array.from({ length: 7 }, () => Array(24).fill(null).map(() => ({ n: 0, sum: 0 })));
    for (const e of await allEvents()) {
      if (!e.lastReport) continue;
      const d = new Date(e.startsAt);
      const cell = grid[d.getUTCDay()][d.getUTCHours()];
      cell.n += 1; cell.sum += e.lastReport.joinsInWindow || 0;
    }
    return json({ grid: grid.map((row) => row.map((c) => (c.n ? Math.round(c.sum / c.n) : null))) });
  }

  // ---- record a listing view (funnel stage 1) ----
  if (action === "view" && req.method === "POST") {
    if (!(await rateLimit(`view:${clientIp(req)}`, 60, 60))) return json({ ok: true });
    const ev = await store.get(url.searchParams.get("id") || "", { type: "json" });
    if (ev && !isEnded(ev)) await store.setJSON(ev.id, { ...ev, views: (ev.views || 0) + 1 });
    return json({ ok: true });
  }

  // ---- reveal join code (funnel stage 2; unlocks 15 min before start) ----
  if (action === "join") {
    const ev = await store.get(url.searchParams.get("id") || "", { type: "json" });
    if (!ev) return json({ error: "Event not found." }, 404);
    const start = new Date(ev.startsAt).getTime();
    const now = Date.now();
    if (now < start - 15 * 60000) return json({ error: "Join code unlocks 15 minutes before start." }, 403);
    if (now > endMs(ev)) return json({ error: "This event has ended." }, 410);
    await store.setJSON(ev.id, { ...ev, reveals: (ev.reveals || 0) + 1 });
    return json({ joinCode: ev.joinCode });
  }

  // ---- everything below requires login ----
  const user = await requireUser(req);
  if (!user) return json({ error: "Log in first." }, 401);

  if (action === "mine") {
    const events = (await allEvents())
      .filter((e) => e.hostId === user.id)
      .sort((a, b) => new Date(b.startsAt) - new Date(a.startsAt));
    return json({
      events: events.map((e) => ({
        ...PUBLIC_FIELDS(e), joinCode: e.joinCode, ended: isEnded(e),
        reveals: e.reveals || 0, lastReport: e.lastReport || null,
      })),
    });
  }

  if (action === "create" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));

    // Honeypot: real users never fill this hidden field.
    if (b.website) return json({ ok: true });

    if (!(await rateLimit(`create:${user.id}`, DAILY_EVENT_CAP, 86400))) {
      return json({ error: `Daily limit reached (${DAILY_EVENT_CAP} events per day).` }, 429);
    }
    if (!b.title || !b.startsAt || !b.joinCode) {
      return json({ error: "Title, start time, and join code are required." }, 400);
    }
    const start = new Date(b.startsAt);
    if (isNaN(start.getTime())) return json({ error: "Invalid start time." }, 400);
    if (start.getTime() < Date.now() - 5 * 60000) return json({ error: "Start time is in the past." }, 400);

    const durationMin = Math.round(Number(b.durationMin) || 60);
    if (durationMin < MIN_DURATION_MIN || durationMin > MAX_DURATION_MIN) {
      return json({ error: `Event length must be between ${MIN_DURATION_MIN} and ${MAX_DURATION_MIN} minutes (1.5 hour maximum).` }, 400);
    }

    // Banners must come from our own upload endpoint (validated 1200x480).
    let bannerUrl = null;
    if (b.bannerId) bannerUrl = `/api/image?id=${clampStr(b.bannerId, 40)}`;

    const ev = {
      id: id(),
      hostId: user.id,
      hostUsername: user.username,
      title: clampStr(b.title, 80),
      description: clampStr(b.description, 400),
      scenario: clampStr(b.scenario || "Roleplay", 40),
      startsAt: start.toISOString(),
      durationMin,
      joinCode: clampStr(b.joinCode, 32),
      bannerUrl,
      reportRecipientId: clampStr(b.reportRecipientId, 32) || null, // optional extra Discord user ID for report delivery
      boosted: false,
      views: 0,
      reveals: 0,
      createdAt: new Date().toISOString(),
    };
    await store.setJSON(ev.id, ev);
    await audit(user, "event.create", { eventId: ev.id, title: ev.title });
    return json({ ok: true, event: PUBLIC_FIELDS(ev) });
  }

  if (action === "delete" && req.method === "POST") {
    const ev = await store.get(url.searchParams.get("id") || "", { type: "json" });
    if (!ev) return json({ error: "Event not found." }, 404);
    if (ev.hostId !== user.id) return json({ error: "You can only delete your own events." }, 403);
    await store.delete(ev.id);
    await audit(user, "event.delete", { eventId: ev.id });
    return json({ ok: true });
  }

  return json({ error: "Unknown action." }, 404);
};
