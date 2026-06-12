// /api/billing - Stripe checkout (card) + Robux gamepass verification.
//
// Card payments (optional, enable later):
//   STRIPE_SECRET_KEY            sk_live_... or sk_test_... from dashboard.stripe.com
//   STRIPE_PRICE_SERGEANT        a recurring weekly Price ID (price_...)
//   STRIPE_PRICE_COMMANDER       a recurring weekly Price ID (price_...)
//
// Robux payments (optional):
//   ROBUX_GAMEPASS_SERGEANT      gamepass ID players buy weekly
//   ROBUX_GAMEPASS_COMMANDER     gamepass ID
//
// Until keys are set, endpoints return a clear "not configured" error instead of fake success.

import { json, requireUser, usersStore } from "../lib/util.js";

const PLANS = { sergeant: "STRIPE_PRICE_SERGEANT", commander: "STRIPE_PRICE_COMMANDER" };
const GAMEPASSES = { sergeant: "ROBUX_GAMEPASS_SERGEANT", commander: "ROBUX_GAMEPASS_COMMANDER" };

export default async (req) => {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const siteUrl = (process.env.SITE_URL || `${url.protocol}//${url.host}`).replace(/\/$/, "");

  const user = await requireUser(req);
  if (!user) return json({ error: "Log in first to subscribe." }, 401);

  // ---- card checkout via Stripe ----
  if (action === "checkout" && req.method === "POST") {
    const { plan } = await req.json().catch(() => ({}));
    const priceEnv = PLANS[plan];
    if (!priceEnv) return json({ error: "Unknown plan." }, 400);

    const sk = process.env.STRIPE_SECRET_KEY;
    const priceId = process.env[priceEnv];
    if (!sk || !priceId) {
      return json({ error: "Card payments aren't configured yet. Admin: set STRIPE_SECRET_KEY and " + priceEnv + " in Netlify env vars." }, 400);
    }

    const body = new URLSearchParams({
      mode: "subscription",
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      success_url: `${siteUrl}/dashboard?upgraded=${plan}`,
      cancel_url: `${siteUrl}/pricing`,
      client_reference_id: user.id,
    });
    const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${sk}`, "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const d = await r.json();
    if (!r.ok) return json({ error: d.error?.message || "Stripe error." }, 502);
    return json({ url: d.url });
  }

  // ---- Robux: verify gamepass ownership through the official Roblox API ----
  if (action === "verify-robux" && req.method === "POST") {
    const { plan } = await req.json().catch(() => ({}));
    const gpEnv = GAMEPASSES[plan];
    if (!gpEnv) return json({ error: "Unknown plan." }, 400);
    const gamepassId = process.env[gpEnv];
    if (!gamepassId) {
      return json({ error: "Robux payments aren't configured yet. Admin: create a weekly gamepass on Roblox and set " + gpEnv + "." }, 400);
    }

    // Since login is via Discord, we need the user's Roblox ID to check gamepass
    // ownership. They supply it once and we store it on their account.
    let robloxId = user.robloxId;
    if (!robloxId) {
      const body = await req.json().catch(() => ({}));
      robloxId = body.robloxId;
      if (!robloxId) {
        return json({ error: "Link your Roblox account first - send your Roblox user ID with this request." }, 400);
      }
    }

    const r = await fetch(
      `https://inventory.roblox.com/v1/users/${robloxId}/items/GamePass/${gamepassId}`
    );
    if (!r.ok) return json({ error: "Could not check gamepass ownership - try again shortly." }, 502);
    const d = await r.json();
    const owns = Array.isArray(d.data) && d.data.length > 0;
    if (!owns) return json({ error: "Gamepass purchase not found on your account yet. Buy it on Roblox, then verify again." }, 402);

    await usersStore().setJSON(user.id, {
      ...user,
      robloxId,
      plan,
      planVia: "robux",
      planVerifiedAt: new Date().toISOString(),
    });
    return json({ ok: true, plan });
  }

  return json({ error: "Unknown action." }, 404);
};
