// /api/billing - Stripe checkout (card) + Robux gamepass verification (Ultra only).
//
// Env vars (set the ones you use; others return a clear "not configured" error):
//   STRIPE_SECRET_KEY
//   STRIPE_PRICE_PRO_MONTHLY  STRIPE_PRICE_PRO_ANNUAL   STRIPE_PRICE_PRO_LIFETIME
//   STRIPE_PRICE_ULTRA_MONTHLY STRIPE_PRICE_ULTRA_ANNUAL STRIPE_PRICE_ULTRA_LIFETIME
//   ROBUX_GAMEPASS_ULTRA      (2500 Robux / month gamepass id; Ultra only)
import { json, requireUser, usersStore, normalizePlan, PLAN_INFO, audit } from "../lib/util.js";

const STRIPE_PRICE_ENV = {
  pro:   { monthly: "STRIPE_PRICE_PRO_MONTHLY",   annual: "STRIPE_PRICE_PRO_ANNUAL",   lifetime: "STRIPE_PRICE_PRO_LIFETIME" },
  ultra: { monthly: "STRIPE_PRICE_ULTRA_MONTHLY", annual: "STRIPE_PRICE_ULTRA_ANNUAL", lifetime: "STRIPE_PRICE_ULTRA_LIFETIME" },
};

async function fetchT(url, opts = {}, ms = 10000) { return fetch(url, { ...opts, signal: AbortSignal.timeout(ms) }); }

export default async (req) => {
  try { return await handler(req); }
  catch (e) { return json({ error: "Server error: " + (e?.message || "unknown") }, 500); }
};

async function handler(req) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const siteUrl = (process.env.SITE_URL || `${url.protocol}//${url.host}`).replace(/\/$/, "");

  const user = await requireUser(req);
  if (!user) return json({ error: "Log in first to subscribe." }, 401);

  if (action === "checkout" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const plan = normalizePlan(b.plan);
    const cycle = ["monthly", "annual", "lifetime"].includes(b.cycle) ? b.cycle : "monthly";
    if (plan === "free") return json({ error: "The free tier needs no checkout." }, 400);

    const envName = STRIPE_PRICE_ENV[plan]?.[cycle];
    const sk = process.env.STRIPE_SECRET_KEY;
    const priceId = envName ? process.env[envName] : null;
    if (!sk || !priceId) return json({ error: `Card payments for ${PLAN_INFO[plan].name} (${cycle}) aren't configured yet. Admin: set STRIPE_SECRET_KEY and ${envName} in Netlify env vars.` }, 400);

    const mode = cycle === "lifetime" ? "payment" : "subscription";
    const body = new URLSearchParams({
      mode,
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      success_url: `${siteUrl}/dashboard?upgraded=${plan}`,
      cancel_url: `${siteUrl}/pricing`,
      client_reference_id: user.id,
      "metadata[plan]": plan,
      "metadata[cycle]": cycle,
    });
    const r = await fetchT("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST", headers: { Authorization: `Bearer ${sk}`, "Content-Type": "application/x-www-form-urlencoded" }, body,
    });
    const d = await r.json();
    if (!r.ok) return json({ error: d.error?.message || "Stripe error." }, 502);
    return json({ url: d.url });
  }

  if (action === "verify-robux" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const plan = normalizePlan(b.plan);
    if (plan !== "ultra") return json({ error: "Robux payment is available for Gatherly Ultra only." }, 400);
    const gamepassId = process.env.ROBUX_GAMEPASS_ULTRA;
    if (!gamepassId) return json({ error: "Robux payments aren't configured yet. Admin: create the 2500 Robux gamepass and set ROBUX_GAMEPASS_ULTRA." }, 400);

    let robloxId = user.robloxId || b.robloxId;
    if (!robloxId) return json({ error: "Enter your Roblox user ID to verify the gamepass purchase." }, 400);

    const r = await fetchT(`https://inventory.roblox.com/v1/users/${robloxId}/items/GamePass/${gamepassId}`);
    if (!r.ok) return json({ error: "Could not check gamepass ownership right now. Try again shortly." }, 502);
    const d = await r.json();
    const owns = Array.isArray(d.data) && d.data.length > 0;
    if (!owns) return json({ error: "Gamepass purchase not found on your account yet. Buy it on Roblox, then verify again." }, 402);

    const grant = PLAN_INFO.ultra.weeklyCredits;
    await usersStore().setJSON(user.id, { ...user, robloxId, plan: "ultra", planVia: "robux", planVerifiedAt: new Date().toISOString(), credits: (user.credits ?? 0) + grant });
    await audit(user, "billing.robux-ultra", { robloxId });
    return json({ ok: true, plan: "ultra" });
  }

  return json({ error: "Unknown action." }, 404);
}
