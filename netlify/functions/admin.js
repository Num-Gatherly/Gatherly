// /api/admin - staff-only control surface.
// Every action requires an admin or executive role (stored server-side on the user
// record) and is written to the audit log. Non-staff get a 404, not a 403, so the
// endpoint does not advertise itself.

import {
  json, requireUser, isStaff, usersStore, eventsStore, miscStore, auditStore,
  audit, clampStr,
} from "../lib/util.js";

const MAX_DURATION_MIN = 90;

export default async (req) => {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  // Site content blocks are public to read (the homepage renders them),
  // staff-only to write.
  if (action === "content" && req.method === "GET") {
    const content = (await miscStore().get("siteContent", { type: "json" })) || {};
    return json({ content });
  }

  const user = await requireUser(req);
  if (!isStaff(user)) return json({ error: "Not found." }, 404);

  const evStore = eventsStore();
  const uStore = usersStore();

  // ---------- events ----------
  if (action === "events") {
    const { blobs } = await evStore.list();
    const events = (await Promise.all(blobs.map((b) => evStore.get(b.key, { type: "json" }))))
      .filter(Boolean)
      .sort((a, b) => new Date(b.startsAt) - new Date(a.startsAt))
      .map((e) => ({
        id: e.id, title: e.title, scenario: e.scenario, hostUsername: e.hostUsername,
        startsAt: e.startsAt, durationMin: e.durationMin, boosted: Boolean(e.boosted),
        views: e.views || 0, hasReport: Boolean(e.lastReport),
      }));
    return json({ events });
  }

  if (action === "event-update" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const ev = await evStore.get(b.id || "", { type: "json" });
    if (!ev) return json({ error: "Event not found." }, 404);

    const update = { ...ev };
    if (b.title !== undefined) update.title = clampStr(b.title, 80);
    if (b.description !== undefined) update.description = clampStr(b.description, 400);
    if (b.scenario !== undefined) update.scenario = clampStr(b.scenario, 40);
    if (b.startsAt !== undefined) {
      const d = new Date(b.startsAt);
      if (isNaN(d.getTime())) return json({ error: "Invalid start time." }, 400);
      update.startsAt = d.toISOString();
    }
    if (b.durationMin !== undefined) {
      const dur = Math.round(Number(b.durationMin));
      if (!(dur >= 15 && dur <= MAX_DURATION_MIN)) return json({ error: `Duration must be 15-${MAX_DURATION_MIN} minutes.` }, 400);
      update.durationMin = dur;
    }
    if (b.boosted !== undefined) update.boosted = Boolean(b.boosted);
    await evStore.setJSON(ev.id, update);
    await audit(user, "admin.event-update", { eventId: ev.id, changes: Object.keys(b).filter((k) => k !== "id") });
    return json({ ok: true });
  }

  if (action === "event-delete" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const ev = await evStore.get(b.id || "", { type: "json" });
    if (!ev) return json({ error: "Event not found." }, 404);
    await evStore.delete(ev.id);
    await audit(user, "admin.event-delete", { eventId: ev.id, title: ev.title, host: ev.hostUsername });
    return json({ ok: true });
  }

  // ---------- users ----------
  if (action === "users") {
    const { blobs } = await uStore.list();
    const users = (await Promise.all(blobs.map((b) => uStore.get(b.key, { type: "json" }))))
      .filter(Boolean)
      .map((u) => ({
        id: u.id, username: u.username, plan: u.plan || "basic", role: u.role || null,
        suspended: Boolean(u.suspended), hasErlcKey: Boolean(u.erlcKeyEnc),
        updatedAt: u.updatedAt,
      }));
    return json({ users });
  }

  if (action === "user-update" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const target = await uStore.get(b.id || "", { type: "json" });
    if (!target) return json({ error: "User not found." }, 404);
    if (target.role === "executive" && user.role !== "executive") {
      return json({ error: "Only executives can modify executives." }, 403);
    }

    const update = { ...target, updatedAt: new Date().toISOString() };
    if (b.suspended !== undefined) update.suspended = Boolean(b.suspended);
    if (b.revokeErlcKey) update.erlcKeyEnc = null;
    if (b.plan !== undefined && ["basic", "sergeant", "commander"].includes(b.plan)) update.plan = b.plan;
    await uStore.setJSON(target.id, update);
    await audit(user, "admin.user-update", { userId: target.id, username: target.username, changes: Object.keys(b).filter((k) => k !== "id") });
    return json({ ok: true });
  }

  // ---------- editable site content blocks ----------
  if (action === "content-update" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const content = (await miscStore().get("siteContent", { type: "json" })) || {};
    const allowed = ["heroHeadline", "heroSub", "announcement"];
    for (const k of allowed) if (b[k] !== undefined) content[k] = clampStr(b[k], 200);
    await miscStore().setJSON("siteContent", content);
    await audit(user, "admin.content-update", { keys: Object.keys(b) });
    return json({ ok: true, content });
  }

  // ---------- audit log (newest first) ----------
  if (action === "audit") {
    const store = auditStore();
    const { blobs } = await store.list();
    const keys = blobs.map((b) => b.key).sort().reverse().slice(0, 100);
    const entries = (await Promise.all(keys.map((k) => store.get(k, { type: "json" })))).filter(Boolean);
    return json({ entries });
  }

  return json({ error: "Unknown action." }, 404);
};
