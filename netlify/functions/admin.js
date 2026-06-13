// /api/admin - staff control surface.
import {
  json, requireUser, isStaff, isExec, usersStore, eventsStore, miscStore,
  auditStore, codesStore, ticketsStore, audit, clampStr, adminCode,
} from "../lib/util.js";

const MAX_DURATION_MIN = 90;
const endMs = (ev) => new Date(ev.startsAt).getTime() + (ev.durationMin || 60) * 60000;

const PLAN_CREDITS = { patrol: 0, sergeant: 2, commander: 6, network: 20 };

export default async (req) => {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  // ---------- public read: site content ----------
  if (action === "content" && req.method === "GET") {
    const content = (await miscStore().get("siteContent", { type: "json" })) || {};
    return json({ content });
  }

  // ---------- self-service: claim exec ----------
  if (action === "claim-exec" && req.method === "POST") {
    const user = await requireUser(req);
    if (!user) return json({ error: "Log in first." }, 401);
    const setup = process.env.EXEC_SETUP_CODE;
    if (!setup) return json({ error: "Executive setup is not enabled on this site." }, 400);
    const b = await req.json().catch(() => ({}));
    if (clampStr(b.code, 200) !== setup) {
      await audit(user, "exec.claim-failed", {});
      return json({ error: "That setup code is not correct." }, 403);
    }
    await usersStore().setJSON(user.id, { ...user, role: "executive", updatedAt: new Date().toISOString() });
    await audit({ ...user, role: "executive" }, "exec.claim-success", {});
    return json({ ok: true, role: "executive" });
  }

  // ---------- self-service: redeem code ----------
  if (action === "redeem-code" && req.method === "POST") {
    const user = await requireUser(req);
    if (!user) return json({ error: "Log in first." }, 401);
    const b = await req.json().catch(() => ({}));
    const codeStr = clampStr(b.code, 40).toUpperCase();
    if (!codeStr) return json({ error: "Enter your access code." }, 400);
    const store = codesStore();
    const rec = await store.get(codeStr, { type: "json" });
    if (!rec || rec.revoked) {
      await audit(user, "code.redeem-failed", { code: codeStr });
      return json({ error: "That code is not valid or has been revoked." }, 403);
    }
    const grant = rec.role === "executive" ? "executive" : "admin";
    await usersStore().setJSON(user.id, { ...user, role: grant, updatedAt: new Date().toISOString() });
    rec.redemptions = rec.redemptions || [];
    rec.redemptions.push({ userId: user.id, username: user.username, at: new Date().toISOString() });
    rec.lastRedeemedAt = new Date().toISOString();
    await store.setJSON(codeStr, rec);
    await audit({ ...user, role: grant }, "code.redeem-success", { code: codeStr, granted: grant });
    return json({ ok: true, role: grant });
  }

  // ---------- self-service: request admin ----------
  if (action === "request-admin" && req.method === "POST") {
    const user = await requireUser(req);
    if (!user) return json({ error: "Log in first." }, 401);
    if (isStaff(user)) return json({ error: "You already have staff access." }, 400);
    const b = await req.json().catch(() => ({}));
    const reqs = (await miscStore().get("adminRequests", { type: "json" })) || {};
    reqs[user.id] = { userId: user.id, username: user.username, note: clampStr(b.note, 300), at: new Date().toISOString() };
    await miscStore().setJSON("adminRequests", reqs);
    await audit(user, "admin.request", {});
    return json({ ok: true });
  }

  // ---------- staff gate ----------
  const user = await requireUser(req);
  if (!isStaff(user)) return json({ error: "Not found." }, 404);

  const evStore = eventsStore();
  const uStore = usersStore();

  // ---------- whoami ----------
  if (action === "whoami") {
    return json({ id: user.id, username: user.username, role: user.role });
  }

  // ---------- users: search ----------
  if (action === "users-search") {
    const q = (url.searchParams.get("q") || "").toLowerCase().trim();
    const { blobs } = await uStore.list();
    const all = await Promise.all(blobs.map((b) => uStore.get(b.key, { type: "json" })));
    const results = all.filter((u) => u && (
      u.username?.toLowerCase().includes(q) ||
      u.id?.toLowerCase().includes(q) ||
      u.discordId?.toLowerCase().includes(q)
    )).slice(0, 20).map((u) => ({
      id: u.id, username: u.username, plan: u.plan || "patrol",
      role: u.role || null, credits: u.credits ?? 0,
      suspended: Boolean(u.suspended), createdAt: u.createdAt,
      discordId: u.discordId,
    }));
    return json({ users: results });
  }

  // ---------- users: list ----------
  if (action === "users") {
    const { blobs } = await uStore.list();
    const all = await Promise.all(blobs.map((b) => uStore.get(b.key, { type: "json" })));
    const users = all.filter(Boolean).map((u) => ({
      id: u.id, username: u.username, plan: u.plan || "patrol",
      role: u.role || null, credits: u.credits ?? 0,
      suspended: Boolean(u.suspended), createdAt: u.createdAt,
    }));
    return json({ users });
  }

  // ---------- users: get single ----------
  if (action === "user-get") {
    const uid = url.searchParams.get("id");
    const u = await uStore.get(uid, { type: "json" });
    if (!u) return json({ error: "User not found." }, 404);
    return json({ user: { id: u.id, username: u.username, plan: u.plan || "patrol", role: u.role || null, credits: u.credits ?? 0, suspended: Boolean(u.suspended), discordId: u.discordId } });
  }

  // ---------- credits: add ----------
  if (action === "credits-add" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const target = await uStore.get(b.userId, { type: "json" });
    if (!target) return json({ error: "User not found." }, 404);
    const amount = parseInt(b.amount, 10);
    if (!Number.isFinite(amount) || amount < 1) return json({ error: "Enter a positive number of credits." }, 400);
    const newCredits = (target.credits ?? 0) + amount;
    await uStore.setJSON(b.userId, { ...target, credits: newCredits, updatedAt: new Date().toISOString() });
    await audit(user, "credits.add", { targetId: b.userId, amount, newTotal: newCredits });
    return json({ ok: true, credits: newCredits });
  }

  // ---------- credits: remove ----------
  if (action === "credits-remove" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const target = await uStore.get(b.userId, { type: "json" });
    if (!target) return json({ error: "User not found." }, 404);
    const amount = parseInt(b.amount, 10);
    if (!Number.isFinite(amount) || amount < 1) return json({ error: "Enter a positive number of credits." }, 400);
    const newCredits = Math.max(0, (target.credits ?? 0) - amount);
    await uStore.setJSON(b.userId, { ...target, credits: newCredits, updatedAt: new Date().toISOString() });
    await audit(user, "credits.remove", { targetId: b.userId, amount, newTotal: newCredits });
    return json({ ok: true, credits: newCredits });
  }

  // ---------- credits: set ----------
  if (action === "credits-set" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const target = await uStore.get(b.userId, { type: "json" });
    if (!target) return json({ error: "User not found." }, 404);
    const amount = parseInt(b.amount, 10);
    if (!Number.isFinite(amount) || amount < 0) return json({ error: "Enter a valid credit amount." }, 400);
    await uStore.setJSON(b.userId, { ...target, credits: amount, updatedAt: new Date().toISOString() });
    await audit(user, "credits.set", { targetId: b.userId, amount });
    return json({ ok: true, credits: amount });
  }

  // ---------- users: set plan/tier ----------
  if (action === "set-plan" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const target = await uStore.get(b.userId, { type: "json" });
    if (!target) return json({ error: "User not found." }, 404);
    const validPlans = ["patrol", "sergeant", "commander", "network"];
    if (!validPlans.includes(b.plan)) return json({ error: "Invalid plan." }, 400);
    // Auto-assign weekly credits when upgrading
    const weeklyCredits = PLAN_CREDITS[b.plan] || 0;
    await uStore.setJSON(b.userId, {
      ...target,
      plan: b.plan,
      planVia: "admin",
      planSetAt: new Date().toISOString(),
      credits: (target.credits ?? 0) + weeklyCredits,
      updatedAt: new Date().toISOString(),
    });
    await audit(user, "user.set-plan", { targetId: b.userId, plan: b.plan });
    return json({ ok: true, plan: b.plan });
  }

  // ---------- users: set role ----------
  if (action === "set-role" && req.method === "POST") {
    if (!isExec(user)) return json({ error: "Executive only." }, 403);
    const b = await req.json().catch(() => ({}));
    const target = await uStore.get(b.userId, { type: "json" });
    if (!target) return json({ error: "User not found." }, 404);
    const validRoles = [null, "admin", "executive"];
    if (!validRoles.includes(b.role)) return json({ error: "Invalid role." }, 400);
    await uStore.setJSON(b.userId, { ...target, role: b.role || null, updatedAt: new Date().toISOString() });
    await audit(user, "user.set-role", { targetId: b.userId, role: b.role });
    return json({ ok: true });
  }

  // ---------- users: suspend/unsuspend ----------
  if (action === "suspend" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const target = await uStore.get(b.userId, { type: "json" });
    if (!target) return json({ error: "User not found." }, 404);
    const suspended = Boolean(b.suspended);
    await uStore.setJSON(b.userId, { ...target, suspended, updatedAt: new Date().toISOString() });
    await audit(user, suspended ? "user.suspend" : "user.unsuspend", { targetId: b.userId });
    return json({ ok: true });
  }

  // ---------- events: list all ----------
  if (action === "events") {
    const { blobs } = await evStore.list();
    const events = (await Promise.all(blobs.map((b) => evStore.get(b.key, { type: "json" })))).filter(Boolean);
    return json({ events: events.sort((a, b) => new Date(b.startsAt) - new Date(a.startsAt)).slice(0, 200) });
  }

  // ---------- events: toggle boost ----------
  if (action === "boost" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const ev = await evStore.get(b.id, { type: "json" });
    if (!ev) return json({ error: "Event not found." }, 404);
    ev.boosted = !ev.boosted;
    ev.boostedAt = ev.boosted ? new Date().toISOString() : null;
    ev.boostedBy = ev.boosted ? user.username : null;
    await evStore.setJSON(b.id, ev);
    await audit(user, ev.boosted ? "event.boost" : "event.unboost", { eventId: b.id });
    return json({ ok: true, boosted: ev.boosted });
  }

  // ---------- events: end now ----------
  if (action === "end-event" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const ev = await evStore.get(b.id, { type: "json" });
    if (!ev) return json({ error: "Event not found." }, 404);
    ev.startsAt = new Date(Date.now() - (ev.durationMin || 60) * 60000 - 1000).toISOString();
    await evStore.setJSON(b.id, ev);
    await audit(user, "event.end", { eventId: b.id });
    return json({ ok: true });
  }

  // ---------- events: delete ----------
  if (action === "delete-event" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    await evStore.delete(b.id);
    await audit(user, "event.delete", { eventId: b.id });
    return json({ ok: true });
  }

  // ---------- site content ----------
  if (action === "set-content" && req.method === "POST") {
    if (!isExec(user)) return json({ error: "Executive only." }, 403);
    const b = await req.json().catch(() => ({}));
    const current = (await miscStore().get("siteContent", { type: "json" })) || {};
    await miscStore().setJSON("siteContent", { ...current, ...b });
    await audit(user, "site.content-update", {});
    return json({ ok: true });
  }

  // ---------- exec: generate code ----------
  if (action === "gen-code" && req.method === "POST") {
    if (!isExec(user)) return json({ error: "Executive only." }, 403);
    const b = await req.json().catch(() => ({}));
    const code = adminCode();
    const role = b.role === "executive" ? "executive" : "admin";
    await codesStore().setJSON(code, { code, role, createdBy: user.id, createdAt: new Date().toISOString(), revoked: false, redemptions: [] });
    await audit(user, "code.generate", { code, role });
    return json({ ok: true, code });
  }

  // ---------- exec: revoke code ----------
  if (action === "revoke-code" && req.method === "POST") {
    if (!isExec(user)) return json({ error: "Executive only." }, 403);
    const b = await req.json().catch(() => ({}));
    const rec = await codesStore().get(b.code, { type: "json" });
    if (!rec) return json({ error: "Code not found." }, 404);
    await codesStore().setJSON(b.code, { ...rec, revoked: true, revokedAt: new Date().toISOString() });
    await audit(user, "code.revoke", { code: b.code });
    return json({ ok: true });
  }

  // ---------- exec: list codes ----------
  if (action === "codes") {
    if (!isExec(user)) return json({ error: "Executive only." }, 403);
    const { blobs } = await codesStore().list();
    const codes = await Promise.all(blobs.map((b) => codesStore().get(b.key, { type: "json" })));
    return json({ codes: codes.filter(Boolean) });
  }

  // ---------- exec: admin requests ----------
  if (action === "admin-requests") {
    if (!isExec(user)) return json({ error: "Executive only." }, 403);
    const reqs = (await miscStore().get("adminRequests", { type: "json" })) || {};
    return json({ requests: Object.values(reqs) });
  }

  // ---------- audit log ----------
  if (action === "audit") {
    const { blobs } = await auditStore().list();
    const entries = (await Promise.all(blobs.map((b) => auditStore().get(b.key, { type: "json" })))).filter(Boolean);
    return json({ entries: entries.sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 200) });
  }

  return json({ error: "Unknown action." }, 404);
};
