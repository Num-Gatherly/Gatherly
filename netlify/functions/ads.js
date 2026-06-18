// /api/ads - the Gatherly advertising marketplace.
//
//   Public:   active           -> approved+running ads for the on-site rotation
//             impression (POST) -> +1 impression for an ad
//             click             -> +1 click (logs viewer), 302 to the destination
//   Advertiser (logged in):
//             submit (POST)     -> safety-scan, create a PENDING ad, open Stripe checkout
//             mine              -> the advertiser's ads + analytics
//   Staff (Control Room):
//             pending / all     -> moderation queue
//             approve / deny    -> manual approval (required before an ad runs)
//   Executive:
//             config (POST)     -> rotation ratio + seconds-per-ad
//
// Booking is pay-first, then manual staff approval. Per our policy, an ad that
// breaches the ToS can be denied after payment and the unused portion refunded.
import {
  json, redirect, requireUser, isStaff, isExec, adsStore, miscStore, usersStore,
  audit, clampStr, id, guard, clientIp, scanAdSafety, aiModerateAd,
  AD_PACKS, TOTAL_AD_SLOTS, getAdConfig, postStaffEvent, brandEmbed,
} from "../lib/util.js";
import crypto from "node:crypto";

const SITE = (u) => (process.env.SITE_URL || `${u.protocol}//${u.host}`).replace(/\/$/, "");

async function stripeCheckout(params) {
  const sk = process.env.STRIPE_SECRET_KEY;
  const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${sk}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(10000),
  });
  return { ok: r.ok, d: await r.json() };
}

const now = () => Date.now();
const isRunning = (a) => a.status === "active" && a.paid && a.startAt && a.endAt && new Date(a.startAt) <= new Date() && new Date(a.endAt) > new Date();

async function loadAll() {
  const store = adsStore();
  const { blobs } = await store.list();
  return (await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })))).filter(Boolean);
}

export default async (req) => {
  try { return await handler(req); }
  catch (e) { return json({ error: "Server error: " + (e?.message || "unknown") }, 500); }
};

async function handler(req) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const store = adsStore();

  /* ----------------------------- PUBLIC ----------------------------- */
  if (action === "active") {
    const all = await loadAll();
    const running = all.filter(isRunning).map((a) => ({ id: a.id, title: a.title, image: a.image, link: a.link }));
    const config = await getAdConfig();
    const houseRaw = (await miscStore().get("houseAds", { type: "json" })) || [
      { id: "house-pricing", title: "Go Ultra, every analytic, every event", image: null, link: "/pricing", house: true, kind: "gatherly", enabled: true },
      { id: "house-advertise", title: "Advertise your community on Gatherly", image: null, link: "/advertisers", house: true, kind: "gatherly", enabled: true },
    ];
    const house = houseRaw.filter((h) => h.enabled !== false).map((h) => ({ id: h.id, title: h.title, image: h.image, link: h.link }));
    return json({ config, ads: running, house });
  }

  if (action === "impression" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const ad = await store.get(clampStr(b.id, 60), { type: "json" });
    if (ad && isRunning(ad)) { ad.impressions = (ad.impressions || 0) + 1; await store.setJSON(ad.id, ad); }
    return json({ ok: true });
  }

  if (action === "click") {
    const ad = await store.get(clampStr(url.searchParams.get("id"), 60), { type: "json" });
    if (!ad) return redirect("/");
    if (isRunning(ad)) {
      ad.clicks = (ad.clicks || 0) + 1;
      const user = await requireUser(req).catch(() => null);
      const who = user ? `u:${user.id}` : `ip:${crypto.createHash("sha256").update(clientIp(req)).digest("hex").slice(0, 16)}`;
      ad.clickLog = ad.clickLog || [];
      if (!ad.clickLog.find((c) => c.who === who)) ad.clickLog.push({ who, named: user ? user.username : null, at: new Date().toISOString() });
      ad.uniqueClicks = new Set((ad.clickLog || []).map((c) => c.who)).size;
      await store.setJSON(ad.id, ad);
    }
    return redirect(/^https?:\/\//i.test(ad.link) ? ad.link : `/${String(ad.link || "").replace(/^\//, "")}`);
  }

  /* --------------------------- ADVERTISER --------------------------- */
  const user = await requireUser(req);

  if (action === "submit" && req.method === "POST") {
    if (!user) return json({ error: "Log in to buy advertising." }, 401);
    const blocked = await guard(req, user, `ad-submit:${user.id}`, 6, 300, { kind: "spam", what: "Rapid ad submissions." });
    if (blocked) return blocked;
    const b = await req.json().catch(() => ({}));
    const title = clampStr(b.title, 80);
    const link = clampStr(b.link, 300);
    const image = clampStr(b.image, 400);
    const pack = AD_PACKS[parseInt(b.days, 10)];
    if (!title || !link) return json({ error: "Title and destination link are required." }, 400);
    if (!pack) return json({ error: "Choose a 3, 7, or 14 day placement." }, 400);
    if (image && !/^https?:\/\//i.test(image)) return json({ error: "Image must be a direct https image URL." }, 400);

    // Watchdog: heuristic + AI scan. Hard-block obvious malware/scam links; soft-flag the rest for staff.
    const scan = scanAdSafety({ link, title, image });
    const ai = await aiModerateAd({ title, link });
    const hardBlock = !scan.ok && scan.reasons.some((r) => /not a valid URL|not http/i.test(r));
    if (hardBlock) return json({ error: "That destination link can't be accepted: " + scan.reasons.join(" ") }, 400);
    if (ai.allowed === false) return json({ error: "This ad didn't pass automated review: " + (ai.reason || "policy breach") }, 400);

    const adId = id().slice(0, 10);
    const ad = {
      id: adId, userId: user.id, username: user.username, title, link, image: image || null,
      days: pack.days, amount: pack.amount, status: "pending", paid: false,
      impressions: 0, clicks: 0, uniqueClicks: 0, clickLog: [],
      scan: { flagged: scan.flagged, reasons: scan.reasons, aiSkipped: ai.skipped },
      createdAt: new Date().toISOString(),
    };
    await store.setJSON(adId, ad);
    await audit(user, "ad.submit", { adId, title, days: pack.days, flagged: scan.flagged });

    const sk = process.env.STRIPE_SECRET_KEY;
    if (!sk) {
      return json({ ok: true, adId, queued: true, note: "Submitted for review. Card payments aren't configured yet, an admin can confirm payment manually." });
    }
    const site = SITE(url);
    const { ok, d } = await stripeCheckout({
      mode: "payment",
      "line_items[0][price_data][currency]": (process.env.STRIPE_CURRENCY || "usd").toLowerCase(),
      "line_items[0][price_data][product_data][name]": `Gatherly Advertising - ${pack.label}`,
      "line_items[0][price_data][unit_amount]": String(pack.amount),
      "line_items[0][quantity]": "1",
      success_url: `${site}/advertisers?paid=${adId}`,
      cancel_url: `${site}/advertisers`,
      client_reference_id: user.id,
      "metadata[userId]": user.id,
      "metadata[kind]": "ad",
      "metadata[adId]": adId,
    });
    if (!ok) return json({ error: d.error?.message || "Stripe error." }, 502);
    return json({ ok: true, adId, url: d.url });
  }

  if (action === "mine") {
    if (!user) return json({ error: "Log in first." }, 401);
    const mine = (await loadAll()).filter((a) => a.userId === user.id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((a) => ({
        id: a.id, title: a.title, link: a.link, image: a.image, days: a.days, status: a.status, paid: a.paid,
        impressions: a.impressions || 0, clicks: a.clicks || 0, uniqueClicks: a.uniqueClicks || 0,
        ctr: a.impressions ? +((a.clicks || 0) / a.impressions * 100).toFixed(1) : 0,
        startAt: a.startAt || null, endAt: a.endAt || null, denyReason: a.denyReason || null,
        clickers: (a.clickLog || []).filter((c) => c.named).map((c) => c.named).slice(0, 50),
        createdAt: a.createdAt,
      }));
    return json({ ads: mine });
  }

  /* ------------------------------ STAFF ----------------------------- */
  if (!isStaff(user)) return json({ error: "Not found." }, 404);

  if (action === "all" || action === "pending") {
    let ads = (await loadAll()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    if (action === "pending") ads = ads.filter((a) => a.status === "pending");
    return json({ ads, slots: TOTAL_AD_SLOTS });
  }

  if (action === "approve" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const ad = await store.get(clampStr(b.id, 60), { type: "json" });
    if (!ad) return json({ error: "Ad not found." }, 404);
    ad.status = "active";
    ad.startAt = new Date().toISOString();
    ad.endAt = new Date(Date.now() + ad.days * 86400000).toISOString();
    ad.approvedBy = user.username; ad.approvedAt = new Date().toISOString();
    await store.setJSON(ad.id, ad);
    await audit(user, "ad.approve", { adId: ad.id, title: ad.title, advertiser: ad.username });
    await postStaffEvent(brandEmbed({
      title: "Advertisement approved",
      description: `**${ad.title}** by ${ad.username} is now live for ${ad.days} days.`,
      color: 0x69d99c,
      thumbnail: ad.image || undefined,
    }), [{ label: "Destination", url: /^https?:/.test(ad.link) ? ad.link : `${SITE(url)}${ad.link.startsWith("/") ? "" : "/"}${ad.link}` }]);
    return json({ ok: true });
  }

  if (action === "deny" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const ad = await store.get(clampStr(b.id, 60), { type: "json" });
    if (!ad) return json({ error: "Ad not found." }, 404);
    ad.status = "denied"; ad.denyReason = clampStr(b.reason, 300) || "Breached advertising standards.";
    ad.deniedBy = user.username; ad.deniedAt = new Date().toISOString();
    await store.setJSON(ad.id, ad);
    await audit(user, "ad.deny", { adId: ad.id, title: ad.title, advertiser: ad.username, reason: ad.denyReason });
    await postStaffEvent(brandEmbed({
      title: "Advertisement denied",
      description: `**${ad.title}** by ${ad.username} was denied.\nReason: ${ad.denyReason}`,
      color: 0xff7a7a,
    }));
    return json({ ok: true });
  }

  if (action === "config" && req.method === "POST") {
    if (!isExec(user)) return json({ error: "Executive only." }, 403);
    const b = await req.json().catch(() => ({}));
    const cfg = await getAdConfig();
    if (Number.isFinite(+b.rotateSec)) cfg.rotateSec = Math.max(3, Math.min(60, +b.rotateSec));
    if (Number.isFinite(+b.houseWeight)) cfg.houseWeight = Math.max(0, Math.min(20, +b.houseWeight));
    if (Number.isFinite(+b.advertiserWeight)) cfg.advertiserWeight = Math.max(1, Math.min(20, +b.advertiserWeight));
    await miscStore().setJSON("adConfig", cfg);
    await audit(user, "ad.config", cfg);
    return json({ ok: true, config: cfg });
  }

  return json({ error: "Unknown action." }, 404);
}
