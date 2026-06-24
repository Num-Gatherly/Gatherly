// /api/admin - Control Room: checklist, support flags, users, credits, plans,
// roles, listing caps, suspensions, support blacklist, events, announcements,
// notifications, house ads (Gatherly + ASB), audit + watchdog feed, access codes.
//
// Safety: destructive moderation (suspend / blacklist) is rate-limited to 5 per
// staff per day to blunt mass-raid abuse. Account deletion stays exec-only.
import {
  json, requireUser, isStaff, isExec, usersStore, eventsStore, miscStore,
  auditStore, codesStore, ticketsStore, audit, clampStr, adminCode,
  normalizePlan, PLAN_INFO, planCap, effectiveListingCap, guard, flagWatchdog,
  addGuildRole, removeGuildRole, monthKey, id, postStaffEvent, brandEmbed,
  hashCode, codeFingerprint, CODE_TTL_MS,
} from "../lib/util.js";
import { requestSetRole, requestCodeRedemption } from "../lib/roleApproval.js";
import { sendLiveNotify } from "../lib/liveNotify.js";
import { upsertStatusMessage } from "../lib/statusPage.js";

export default async (req) => {
  try { return await handler(req); }
  catch (e) { return json({ error: "Server error: " + (e?.message || "unknown") }, 500); }
};

async function handler(req) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  /* ---------------- public: site content for banners/toasts --------------- */
  if (action === "content" && req.method === "GET") {
    const content = (await miscStore().get("siteContent", { type: "json" })) || {};
    const now = Date.now();
    const announcements = (content.announcements || []).filter((a) => !a.expiresAt || new Date(a.expiresAt).getTime() > now);
    const notifications = (content.notifications || []).filter((n) => !n.expiresAt || new Date(n.expiresAt).getTime() > now);
    return json({ content: { ...content, announcements, notifications } });
  }

  /* --------------------------- access codes (in) -------------------------- */
  if (action === "redeem-code" && req.method === "POST") {
    const user = await requireUser(req);
    if (!user) return json({ error: "Log in first." }, 401);
    const blocked = await guard(req, user, `redeem:${user.id}`, 5, 3600, {
      kind: "code-bruteforce",
      what: "Repeated access-code redemption attempts.",
      risk: "Possible attempt to guess an admin or executive access code.",
    });
    if (blocked) return blocked;
    const b = await req.json().catch(() => ({}));
    const codeStr = clampStr(b.code, 60).toUpperCase();
    if (!codeStr) return json({ error: "Enter your access code." }, 400);
    const store = codesStore();
    const rec = await store.get(hashCode(codeStr), { type: "json" });
    const expired = rec?.expiresAt && new Date(rec.expiresAt).getTime() < Date.now();
    if (!rec || rec.revoked || expired) {
      await audit(user, "code.redeem-failed", { fingerprint: codeFingerprint(codeStr) });
      return json({ error: "That code is not valid, has expired, or has been revoked." }, 403);
    }
    const grant = rec.role === "executive" ? "executive" : "admin";
    // Role changes are gated behind a DM approval step now, redemption
    // creates a pending request and notifies the approver, it does not
    // touch the user's role or mark the code redeemed until accepted.
    const reqRec = await requestCodeRedemption(user, rec, codeStr);
    await audit(user, "code.redeem-pending", { fingerprint: rec.fingerprint, requestedRole: grant, requestId: reqRec.id });
    return json({ ok: true, pending: true, role: grant });
  }

  if (action === "claim-exec" && req.method === "POST") {
    const user = await requireUser(req);
    if (!user) return json({ error: "Log in first." }, 401);
    const setup = process.env.EXEC_SETUP_CODE;
    if (!setup) return json({ error: "Executive setup is not enabled on this site." }, 400);
    const b = await req.json().catch(() => ({}));
    if (clampStr(b.code, 200) !== setup) {
      await audit(user, "exec.claim-failed", {});
      await flagWatchdog(user, req, "exec-claim-failed", { what: "Failed executive setup-code attempt.", risk: "Possible attempt to seize executive control." });
      return json({ error: "That setup code is not correct." }, 403);
    }
    await usersStore().setJSON(user.id, { ...user, role: "executive", updatedAt: new Date().toISOString() });
    await audit({ ...user, role: "executive" }, "exec.claim-success", {});
    return json({ ok: true, role: "executive" });
  }

  /* ------------------------------ staff gate ------------------------------ */
  const user = await requireUser(req);
  if (!isStaff(user)) return json({ error: "Not found." }, 404);
  const evStore = eventsStore();
  const uStore = usersStore();

  if (action === "whoami") return json({ id: user.id, username: user.username, globalName: user.globalName || user.username, role: user.role });

  /* ------------------------------ CHECKLIST ------------------------------- */
  if (action === "checklist") {
    const tickets = (await listTickets()).filter((t) => t.status !== "closed");
    const escalated = tickets.filter((t) => t.escalated);
    const unclaimed = tickets.filter((t) => !t.assignedTo && !t.escalated);
    const flags = (await listFlags()).filter((f) => !f.resolved);

    const checklist = [
      { label: "Open tickets", count: tickets.length, severity: tickets.length ? "warn" : "ok" },
      { label: "Escalated", count: escalated.length, severity: escalated.length ? "high" : "ok" },
      { label: "Security flags", count: flags.length, severity: flags.length ? "high" : "ok" },
    ];

    return json({
      generatedAt: new Date().toISOString(),
      pending: tickets.length + flags.length,
      checklist,
      flags: flags.slice(0, 50),
      tickets: tickets
        .sort((a, b) => (Number(b.escalated) - Number(a.escalated)) || (new Date(b.updatedAt) - new Date(a.updatedAt)))
        .slice(0, 50)
        .map((t) => ({ id: t.id, subject: t.subject, username: t.username, escalated: Boolean(t.escalated), assignedTo: t.assignedTo || null })),
    });
  }

  if (action === "pending-count") {
    const tickets = (await listTickets()).filter((t) => t.status !== "closed");
    const flags = (await listFlags()).filter((f) => !f.resolved);
    return json({ pending: tickets.length + flags.length });
  }

  if (action === "resolve-flag" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const rec = await auditStore().get(b.key, { type: "json" });
    if (!rec) return json({ error: "Flag not found." }, 404);
    await auditStore().setJSON(b.key, { ...rec, detail: { ...(rec.detail || {}), resolved: true, resolvedBy: user.username, resolvedAt: new Date().toISOString() } });
    await audit(user, "watchdog.resolve", { key: b.key });
    return json({ ok: true });
  }

  if (action === "escalate-flag" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const rec = await auditStore().get(b.key, { type: "json" });
    if (!rec) return json({ error: "Flag not found." }, 404);
    await auditStore().setJSON(b.key, { ...rec, detail: { ...(rec.detail || {}), escalatedFlag: true, escalatedBy: user.username, escalatedAt: new Date().toISOString() } });
    await postStaffEvent(brandEmbed({
      title: "Security flag escalated by staff",
      description: `**${(rec.action || "flag").replace("watchdog.", "")}** escalated by ${user.username}.\n${clampStr(rec.detail?.what, 400) || ""}`,
      color: 0xff7a7a,
    }));
    await audit(user, "watchdog.escalate", { key: b.key });
    return json({ ok: true });
  }

  /* -------------------------------- USERS --------------------------------- */
  if (action === "users" || action === "users-search") {
    const q = (url.searchParams.get("q") || "").toLowerCase().trim();
    const { blobs } = await uStore.list();
    const all = await Promise.all(blobs.map((b) => uStore.get(b.key, { type: "json" })));
    let users = all.filter(Boolean);
    if (q) users = users.filter((u) => (
      u.username?.toLowerCase().includes(q) ||
      u.globalName?.toLowerCase().includes(q) ||
      u.id?.toLowerCase().includes(q) ||
      u.discordId?.toLowerCase().includes(q)
    ));
    users = users.slice(0, 50).map(publicUser);
    return json({ users });
  }

  if (action === "user-get") {
    const u = await uStore.get(url.searchParams.get("id"), { type: "json" });
    if (!u) return json({ error: "User not found." }, 404);
    return json({ user: { ...publicUser(u), blacklistReason: u.supportBlacklist?.reason || null } });
  }

  if (action === "delete-account" && req.method === "POST") {
    if (!isExec(user)) return json({ error: "Executive only." }, 403);
    const blocked = await guard(req, user, `delete-account:${user.id}`, 5, 3600, {
      kind: "account-deletion",
      what: "Executive account-deletion rate limit hit.",
      risk: "More than 5 accounts deleted in one hour by an executive.",
    });
    if (blocked) return blocked;
    const b = await req.json().catch(() => ({}));
    const targetId = clampStr(b.userId, 100);
    if (!targetId) return json({ error: "userId is required." }, 400);
    const target = await uStore.get(targetId, { type: "json" });
    if (!target) return json({ error: "User not found." }, 404);
    const { blobs: evBlobs } = await evStore.list();
    const allEvs = await Promise.all(evBlobs.map((x) => evStore.get(x.key, { type: "json" })));
    let evRemoved = 0;
    for (const e of allEvs) if (e && e.userId === targetId) { await evStore.delete(e.id); evRemoved++; }
    await uStore.delete(targetId);
    await audit(user, "user.delete-account", { targetId, targetUsername: target.username, eventsRemoved: evRemoved });
    return json({ ok: true, eventsRemoved: evRemoved });
  }

  if ((action === "credits-add" || action === "credits-remove" || action === "credits-set") && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const target = await uStore.get(b.userId, { type: "json" });
    if (!target) return json({ error: "User not found." }, 404);
    const amount = parseInt(b.amount, 10);
    if (!Number.isFinite(amount) || amount < 0) return json({ error: "Enter a valid number." }, 400);
    let credits = target.credits ?? 0;
    if (action === "credits-add") credits += amount;
    else if (action === "credits-remove") credits = Math.max(0, credits - amount);
    else credits = amount;
    await uStore.setJSON(b.userId, { ...target, credits, updatedAt: new Date().toISOString() });
    await audit(user, action, { targetId: b.userId, targetUsername: target.username, amount, newTotal: credits });
    return json({ ok: true, credits });
  }

  if (action === "set-plan" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const target = await uStore.get(b.userId, { type: "json" });
    if (!target) return json({ error: "User not found." }, 404);
    const plan = normalizePlan(b.plan);
    const grant = PLAN_INFO[plan].monthlyCredits;
    await uStore.setJSON(b.userId, {
      ...target, plan, planVia: "admin", planCycle: plan === "free" ? null : "monthly",
      subStatus: plan === "free" ? "none" : "active", planExpiresAt: null,
      planSetAt: new Date().toISOString(), credits: plan === "free" ? (target.credits ?? 0) : grant,
      creditsPeriod: monthKey(), updatedAt: new Date().toISOString(),
    });
    await audit(user, "user.set-plan", { targetId: b.userId, targetUsername: target.username, plan, creditsGranted: plan === "free" ? 0 : grant });
    return json({ ok: true, plan });
  }

  if (action === "set-listing-cap" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const target = await uStore.get(b.userId, { type: "json" });
    if (!target) return json({ error: "User not found." }, 404);
    let override = null;
    if (!b.reset && b.cap !== null && b.cap !== "" && b.cap !== undefined) {
      const n = parseInt(b.cap, 10);
      if (!Number.isFinite(n) || n < 0) return json({ error: "Enter a cap of 0 or more, or reset to the plan default." }, 400);
      override = n;
    }
    await uStore.setJSON(b.userId, { ...target, listingCapOverride: override, updatedAt: new Date().toISOString() });
    await audit(user, "user.set-listing-cap", { targetId: b.userId, targetUsername: target.username, cap: override });
    return json({ ok: true, cap: override, effectiveCap: effectiveListingCap({ ...target, listingCapOverride: override }) });
  }

  if (action === "set-role" && req.method === "POST") {
    if (!isExec(user)) return json({ error: "Executive only." }, 403);
    const b = await req.json().catch(() => ({}));
    const target = await uStore.get(b.userId, { type: "json" });
    if (!target) return json({ error: "User not found." }, 404);
    if (![null, "admin", "executive"].includes(b.role)) return json({ error: "Invalid role." }, 400);
    // Every grant AND every removal goes through DM approval now, nothing
    // here mutates the target's role directly, the interaction handler
    // does that once accepted.
    const reqRec = await requestSetRole(target, b.role || null, user);
    await audit(user, "user.set-role-pending", { targetId: b.userId, targetUsername: target.username, role: b.role, requestId: reqRec.id });
    return json({ ok: true, pending: true });
  }

  if (action === "suspend" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const target = await uStore.get(b.userId, { type: "json" });
    if (!target) return json({ error: "User not found." }, 404);
    if (b.suspended) {
      const blocked = await guard(req, user, `cr-mod:${user.id}`, 5, 86400, {
        kind: "mass-moderation",
        what: "More than 5 suspend/blacklist actions in 24 hours.",
        risk: "Possible mass moderation or a compromised staff account acting as a raid.",
      });
      if (blocked) return blocked;
    }
    await uStore.setJSON(b.userId, { ...target, suspended: Boolean(b.suspended), suspendReason: clampStr(b.reason, 200) || null, updatedAt: new Date().toISOString() });
    await audit(user, b.suspended ? "user.suspend" : "user.unsuspend", { targetId: b.userId, targetUsername: target.username, reason: b.reason });
    return json({ ok: true, suspended: Boolean(b.suspended) });
  }

  if (action === "blacklist-add" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const target = await uStore.get(b.userId, { type: "json" });
    if (!target) return json({ error: "User not found." }, 404);
    const blocked = await guard(req, user, `cr-mod:${user.id}`, 5, 86400, {
      kind: "mass-moderation",
      what: "More than 5 suspend/blacklist actions in 24 hours.",
      risk: "Possible mass moderation or a compromised staff account acting as a raid.",
    });
    if (blocked) return blocked;
    const reason = clampStr(b.reason, 200) || "No reason provided.";
    await uStore.setJSON(b.userId, { ...target, supportBlacklist: { active: true, reason, by: user.username, at: new Date().toISOString() }, updatedAt: new Date().toISOString() });
    const roled = target.discordId ? await addGuildRole(target.discordId) : false;
    await audit(user, "support.blacklist-add", { targetId: b.userId, targetUsername: target.username, reason, discordRoleApplied: roled });
    return json({ ok: true, discordRoleApplied: roled });
  }

  if (action === "blacklist-remove" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const target = await uStore.get(b.userId, { type: "json" });
    if (!target) return json({ error: "User not found." }, 404);
    const { supportBlacklist: _drop, ...rest } = target;
    await uStore.setJSON(b.userId, { ...rest, updatedAt: new Date().toISOString() });
    const unroled = target.discordId ? await removeGuildRole(target.discordId) : false;
    await audit(user, "support.blacklist-remove", { targetId: b.userId, targetUsername: target.username, discordRoleRemoved: unroled });
    return json({ ok: true, discordRoleRemoved: unroled });
  }

  if (action === "wipe-listings" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const target = await uStore.get(b.userId, { type: "json" });
    const { blobs } = await evStore.list();
    const all = await Promise.all(blobs.map((x) => evStore.get(x.key, { type: "json" })));
    let removed = 0;
    for (const e of all) if (e && e.userId === b.userId) { await evStore.delete(e.id); removed++; }
    await audit(user, "user.wipe-listings", { targetId: b.userId, targetUsername: target?.username, removed });
    return json({ ok: true, removed });
  }

  /* -------------------------------- EVENTS -------------------------------- */
  if (action === "events") {
    const { blobs } = await evStore.list();
    const events = (await Promise.all(blobs.map((b) => evStore.get(b.key, { type: "json" })))).filter(Boolean);
    return json({ events: events.sort((a, b) => new Date(b.startsAt) - new Date(a.startsAt)).slice(0, 200) });
  }

  if (action === "boost" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const ev = await evStore.get(b.id, { type: "json" });
    if (!ev) return json({ error: "Event not found." }, 404);
    ev.boosted = !ev.boosted; ev.boostedAt = ev.boosted ? new Date().toISOString() : null;
    await evStore.setJSON(b.id, ev);
    await audit(user, ev.boosted ? "event.boost" : "event.unboost", { eventId: b.id });
    return json({ ok: true, boosted: ev.boosted });
  }

  if (action === "end-event" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const ev = await evStore.get(b.id, { type: "json" });
    if (!ev) return json({ error: "Event not found." }, 404);
    ev.startsAt = new Date(Date.now() - (ev.durationMin || 60) * 60000 - 1000).toISOString();
    await evStore.setJSON(b.id, ev);
    await audit(user, "event.end", { eventId: b.id });
    return json({ ok: true });
  }

  if (action === "delete-event" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    await evStore.delete(b.id);
    await audit(user, "event.delete", { eventId: b.id });
    return json({ ok: true });
  }

  /* ---------------------------- ANNOUNCEMENTS ----------------------------- */
  if (action === "announce-add" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const text = clampStr(b.text, 240);
    if (!text) return json({ error: "Announcement text is required." }, 400);
    const content = (await miscStore().get("siteContent", { type: "json" })) || {};
    content.announcements = content.announcements || [];
    const mins = parseInt(b.durationMin, 10);
    const ctaText = clampStr(b.ctaText, 40);
    const ctaLink = clampStr(b.ctaLink, 300);
    content.announcements.push({
      id: id().slice(0, 8), text, link: clampStr(b.link, 300) || null,
      cta: ctaText && ctaLink ? { text: ctaText, link: ctaLink } : null,
      expiresAt: Number.isFinite(mins) && mins > 0 ? new Date(Date.now() + mins * 60000).toISOString() : null,
      by: user.username, at: new Date().toISOString(),
    });
    await miscStore().setJSON("siteContent", content);
    await audit(user, "announce.add", { text });
    return json({ ok: true, announcements: content.announcements });
  }

  if (action === "announce-remove" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const content = (await miscStore().get("siteContent", { type: "json" })) || {};
    content.announcements = (content.announcements || []).filter((a) => a.id !== b.id);
    await miscStore().setJSON("siteContent", content);
    await audit(user, "announce.remove", { id: b.id });
    return json({ ok: true, announcements: content.announcements });
  }

  if (action === "announce-list") {
    const content = (await miscStore().get("siteContent", { type: "json" })) || {};
    return json({ announcements: content.announcements || [] });
  }

  /* ----------------------------- NOTIFICATIONS ---------------------------- */
  if (action === "notify-add" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const title = clampStr(b.title, 80), body = clampStr(b.body, 300);
    if (!title) return json({ error: "Notification title is required." }, 400);
    const content = (await miscStore().get("siteContent", { type: "json" })) || {};
    content.notifications = content.notifications || [];
    const mins = parseInt(b.durationMin, 10);
    const image = clampStr(b.image, 400);
    content.notifications.push({
      id: id().slice(0, 8), title, body,
      image: image && /^https?:\/\//i.test(image) ? image : null,
      link: clampStr(b.link, 300) || null,
      expiresAt: Number.isFinite(mins) && mins > 0 ? new Date(Date.now() + mins * 60000).toISOString() : null,
      by: user.username, at: new Date().toISOString(),
    });
    await miscStore().setJSON("siteContent", content);
    await audit(user, "notify.add", { title });
    return json({ ok: true, notifications: content.notifications });
  }

  if (action === "notify-remove" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const content = (await miscStore().get("siteContent", { type: "json" })) || {};
    content.notifications = (content.notifications || []).filter((n) => n.id !== b.id);
    await miscStore().setJSON("siteContent", content);
    await audit(user, "notify.remove", { id: b.id });
    return json({ ok: true, notifications: content.notifications });
  }

  /* --------------------------- TEST TRIGGERS ------------------------------ */
  // Exec-only buttons in the Control Room's Tests tab, fire the real
  // Discord-sending code paths on demand without waiting for a real event
  // to go live or the per-minute scheduler to run.
  if (action === "test-live-card" && req.method === "POST") {
    if (!isExec(user)) return json({ error: "Executive only." }, 403);
    const blocked = await guard(req, user, `test-live:${user.id}`, 10, 600, { kind: "billing", what: "Repeated test live-card sends." });
    if (blocked) return blocked;
    const sampleEvent = {
      id: `test-${id().slice(0, 8)}`,
      title: "Test Event Card",
      scenario: "pursuit",
      description: "This is a preview sent from the Control Room Tests tab, not a real listing.",
      joinCode: "https://www.roblox.com/games/start?placeId=0&launchData=test",
      boosted: true,
    };
    const r = await sendLiveNotify(sampleEvent, user);
    if (!r.ok) return json({ error: `Could not send the test card (${r.reason}). Check DISCORD_BOT_TOKEN and LIVE_NOTIFY_CHANNEL_ID.` }, 400);
    return json({ ok: true });
  }

  if (action === "test-status-refresh" && req.method === "POST") {
    if (!isExec(user)) return json({ error: "Executive only." }, 403);
    const blocked = await guard(req, user, `test-status:${user.id}`, 10, 600, { kind: "billing", what: "Repeated test status refreshes." });
    if (blocked) return blocked;
    try {
      await upsertStatusMessage();
      return json({ ok: true });
    } catch (e) {
      return json({ error: `Could not refresh the status message (${e?.message || "unknown error"}).` }, 400);
    }
  }

  /* ------------------ PURCHASE THANK-YOU MESSAGE CONTENT ------------------ */
  if (action === "purchase-thanks-content") {
    const content = (await miscStore().get("purchaseThanksContent", { type: "json" })) || {};
    return json({ content });
  }

  if (action === "purchase-thanks-content-save" && req.method === "POST") {
    if (!isExec(user)) return json({ error: "Executive only." }, 403);
    const b = await req.json().catch(() => ({}));
    const content = {
      benefitsPhrasePlan: clampStr(b.benefitsPhrasePlan, 200) || undefined,
      benefitsPhraseCredits: clampStr(b.benefitsPhraseCredits, 200) || undefined,
      footerBannerUrl: clampStr(b.footerBannerUrl, 400) || undefined,
      receiptFooterNote: clampStr(b.receiptFooterNote, 300) || undefined,
    };
    // Strip undefined keys so unset fields fall back to the library's
    // built-in defaults rather than being saved as "undefined".
    Object.keys(content).forEach((k) => content[k] === undefined && delete content[k]);
    await miscStore().setJSON("purchaseThanksContent", content);
    await audit(user, "purchase-thanks.content-save", {});
    return json({ ok: true, content });
  }

  /* ------------------------- HOUSE ADS (Gatherly/ASB) --------------------- */
  if (action === "house-ads") {
    const list = (await miscStore().get("houseAds", { type: "json" })) || [];
    return json({ houseAds: list });
  }

  if (action === "house-ad-save" && req.method === "POST") {
    if (!isExec(user)) return json({ error: "Executive only." }, 403);
    const b = await req.json().catch(() => ({}));
    const list = (await miscStore().get("houseAds", { type: "json" })) || [];
    const existing = b.id ? list.find((a) => a.id === b.id) : null;
    const title = b.title !== undefined ? clampStr(b.title, 120) : existing?.title;
    const link = b.link !== undefined ? clampStr(b.link, 300) : existing?.link;
    if (!title) return json({ error: "A title is required." }, 400);
    let image = b.image !== undefined ? (clampStr(b.image, 400) || null) : (existing?.image || null);
    if (image && !/^https?:\/\//i.test(image)) return json({ error: "Image must be an https URL." }, 400);
    const kind = b.kind !== undefined ? (b.kind === "asb" ? "asb" : "gatherly") : (existing?.kind || "gatherly");
    const subtitle = b.subtitle !== undefined ? (clampStr(b.subtitle, 160) || null) : (existing?.subtitle || null);
    const enabled = b.enabled !== undefined ? b.enabled !== false : (existing ? existing.enabled !== false : true);
    const rec = {
      id: existing ? existing.id : `house-${id().slice(0, 8)}`,
      title, subtitle, image, link: link || null, kind,
      house: true, enabled, updatedAt: new Date().toISOString(),
      createdAt: existing?.createdAt || new Date().toISOString(),
    };
    if (existing) Object.assign(existing, rec); else list.push(rec);
    await miscStore().setJSON("houseAds", list);
    await audit(user, existing ? "ads.house-update" : "ads.house-create", { id: rec.id, title: rec.title, kind });
    return json({ ok: true, houseAds: list });
  }

  if (action === "house-ad-delete" && req.method === "POST") {
    if (!isExec(user)) return json({ error: "Executive only." }, 403);
    const b = await req.json().catch(() => ({}));
    let list = (await miscStore().get("houseAds", { type: "json" })) || [];
    const removed = list.find((a) => a.id === b.id);
    list = list.filter((a) => a.id !== b.id);
    await miscStore().setJSON("houseAds", list);
    await audit(user, "ads.house-delete", { id: b.id, title: removed?.title });
    return json({ ok: true, houseAds: list });
  }

  /* ------------------------------- CONTENT -------------------------------- */
  if (action === "set-content" && req.method === "POST") {
    if (!isExec(user)) return json({ error: "Executive only." }, 403);
    const b = await req.json().catch(() => ({}));
    const current = (await miscStore().get("siteContent", { type: "json" })) || {};
    if (typeof b.heroHeadlineMain === "string") current.heroHeadlineMain = clampStr(b.heroHeadlineMain, 120);
    if (typeof b.heroHeadlineAccent === "string") current.heroHeadlineAccent = clampStr(b.heroHeadlineAccent, 60);
    if (typeof b.heroSub === "string") current.heroSub = clampStr(b.heroSub, 200);
    await miscStore().setJSON("siteContent", current);
    await audit(user, "site.content-update", {});
    return json({ ok: true });
  }

  /* -------------------------------- CODES --------------------------------- */
  if (action === "gen-code" && req.method === "POST") {
    if (!isExec(user)) return json({ error: "Executive only." }, 403);
    const code = adminCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
    await codesStore().setJSON(hashCode(code), {
      hash: hashCode(code), fingerprint: codeFingerprint(code), role: "admin",
      createdBy: user.id, createdByName: user.username, createdAt: new Date().toISOString(),
      expiresAt, revoked: false, redemptions: [],
    });
    await audit(user, "code.generate", { fingerprint: codeFingerprint(code), role: "admin" });
    return json({ ok: true, code, expiresAt });
  }

  if (action === "revoke-code" && req.method === "POST") {
    if (!isExec(user)) return json({ error: "Executive only." }, 403);
    const b = await req.json().catch(() => ({}));
    const key = clampStr(b.key, 200);
    const rec = await codesStore().get(key, { type: "json" });
    if (!rec) return json({ error: "Code not found." }, 404);
    await codesStore().setJSON(key, { ...rec, revoked: true, revokedAt: new Date().toISOString() });
    await audit(user, "code.revoke", { fingerprint: rec.fingerprint });
    return json({ ok: true });
  }

  if (action === "codes") {
    if (!isExec(user)) return json({ error: "Executive only." }, 403);
    const { blobs } = await codesStore().list();
    const codes = (await Promise.all(blobs.map((b) => codesStore().get(b.key, { type: "json" })))).filter(Boolean);
    const now = Date.now();
    return json({
      codes: codes.map((c) => ({
        key: c.hash,
        fingerprint: c.fingerprint,
        role: c.role,
        expiresAt: c.expiresAt,
        expired: c.expiresAt ? new Date(c.expiresAt).getTime() < now : false,
        revoked: Boolean(c.revoked),
        redemptions: (c.redemptions || []).length,
      })).sort((a, b) => new Date(b.expiresAt || 0) - new Date(a.expiresAt || 0)),
    });
  }

  /* ------------------------------- AUDIT ---------------------------------- */
  if (action === "audit" || action === "flagged") {
    const { blobs } = await auditStore().list();
    let entries = (await Promise.all(blobs.map((b) => auditStore().get(b.key, { type: "json" })))).filter(Boolean);
    if (action === "flagged") entries = entries.filter((e) => e.level === "warn" || e.detail?.watchdog);
    return json({ entries: entries.sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 500) });
  }

  return json({ error: "Unknown action." }, 404);

  /* ------------------------------ helpers --------------------------------- */
  function publicUser(u) {
    return {
      id: u.id,
      username: u.username,
      globalName: u.globalName || u.username,
      plan: normalizePlan(u.plan),
      role: u.role || null,
      credits: u.credits ?? 0,
      suspended: Boolean(u.suspended),
      supportBlacklisted: Boolean(u.supportBlacklist?.active),
      listingCapOverride: Number.isFinite(Number(u.listingCapOverride)) ? Number(u.listingCapOverride) : null,
      planCapDefault: planCap(normalizePlan(u.plan)),
      effectiveCap: effectiveListingCap(u),
      createdAt: u.createdAt,
      discordId: u.discordId,
      avatar: u.avatar || null,
    };
  }

  async function listTickets() {
    const store = ticketsStore();
    const { blobs } = await store.list();
    return (await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })))).filter(Boolean);
  }

  async function listFlags() {
    const { blobs } = await auditStore().list();
    const entries = (await Promise.all(blobs.map(async (b) => {
      const e = await auditStore().get(b.key, { type: "json" });
      return e ? { ...e, _key: b.key } : null;
    }))).filter(Boolean);
    return entries
      .filter((e) => (e.level === "warn" || e.detail?.watchdog) && !String(e.action || "").startsWith("watchdog.resolve") && !String(e.action || "").startsWith("watchdog.escalate"))
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .map((e) => ({
        key: e._key,
        action: e.action,
        what: e.detail?.what || "Flagged activity.",
        risk: e.detail?.risk || null,
        aiResolution: e.detail?.aiResolution || e.detail?.fix || null,
        actor: e.actor?.username || "anonymous",
        at: e.at,
        resolved: Boolean(e.detail?.resolved),
        escalated: Boolean(e.detail?.escalatedFlag),
      }));
  }
}

/* ----------------------------- DOWNTIME --------------------------------- */
  if (action === "downtime-get") {
    const d = (await miscStore().get("downtime", { type: "json" })) || { active: false };
    return json({ downtime: d });
  }

  if (action === "downtime-set" && req.method === "POST") {
    if (!isExec(user)) return json({ error: "Executive only." }, 403);
    const b = await req.json().catch(() => ({}));
    const d = {
      active: Boolean(b.active),
      message: clampStr(b.message, 200) || "We are currently down for maintenance.",
      discordUrl: clampStr(b.discordUrl, 300) || "https://discord.gg/gatherly",
      setAt: new Date().toISOString(),
      setBy: user.username,
    };
    await miscStore().setJSON("downtime", d);
    await audit(user, b.active ? "downtime.enable" : "downtime.disable", {});
    return json({ ok: true, downtime: d });
  }

  /* ----------------------------- ANALYTICS -------------------------------- */
  if (action === "analytics-track" && req.method === "POST") {
    // Public endpoint - no auth required
    const b = await req.json().catch(() => ({}));
    const store = miscStore();
    const dayKey = new Date().toISOString().slice(0, 10);
    const existing = (await store.get(`analytics:${dayKey}`, { type: "json" })) || {
      date: dayKey, pageViews: {}, events: [], uniqueSessions: [], totalClicks: 0, totalViews: 0,
    };
    if (b.type === "pageview") {
      const page = clampStr(b.page, 100) || "/";
      existing.pageViews[page] = (existing.pageViews[page] || 0) + 1;
      existing.totalViews = (existing.totalViews || 0) + 1;
      if (b.session && !existing.uniqueSessions.includes(b.session)) {
        existing.uniqueSessions.push(b.session);
        if (existing.uniqueSessions.length > 5000) existing.uniqueSessions = existing.uniqueSessions.slice(-5000);
      }
    } else if (b.type === "click") {
      existing.totalClicks = (existing.totalClicks || 0) + 1;
      existing.events.push({
        t: b.type,
        page: clampStr(b.page, 100),
        target: clampStr(b.target, 100),
        at: new Date().toISOString(),
      });
      if (existing.events.length > 1000) existing.events = existing.events.slice(-1000);
    } else if (b.type === "error") {
      existing.events.push({
        t: "error",
        page: clampStr(b.page, 100),
        msg: clampStr(b.message, 200),
        at: new Date().toISOString(),
      });
      if (existing.events.length > 1000) existing.events = existing.events.slice(-1000);
    }
    await store.setJSON(`analytics:${dayKey}`, existing);
    return json({ ok: true });
  }

  if (action === "analytics-get") {
    if (!isStaff(user)) return json({ error: "Staff only." }, 403);
    const days = Math.min(30, parseInt(url.searchParams.get("days") || "7", 10));
    const store = miscStore();
    const results = [];
    for (let i = 0; i < days; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dayKey = d.toISOString().slice(0, 10);
      const data = (await store.get(`analytics:${dayKey}`, { type: "json" })) || {
        date: dayKey, pageViews: {}, events: [], uniqueSessions: [], totalClicks: 0, totalViews: 0,
      };
      results.push({
        date: dayKey,
        totalViews: data.totalViews || 0,
        uniqueVisitors: (data.uniqueSessions || []).length,
        totalClicks: data.totalClicks || 0,
        topPages: Object.entries(data.pageViews || {})
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([page, views]) => ({ page, views })),
        recentErrors: (data.events || []).filter(e => e.t === "error").slice(-10),
      });
    }
    return json({ analytics: results });
  }
