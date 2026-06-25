// /api/billing - Stripe checkout for subscriptions + "Gatherly Custom" credit packs
//                + Robux gamepass verification (Ultra). Webhook (/api/webhook) does
//                the actual account changes after Stripe confirms payment.
//
// Env vars (set the ones you use):
//   STRIPE_SECRET_KEY
//   STRIPE_PRICE_PRO_MONTHLY  STRIPE_PRICE_PRO_ANNUAL   STRIPE_PRICE_PRO_LIFETIME
//   STRIPE_PRICE_ULTRA_MONTHLY STRIPE_PRICE_ULTRA_ANNUAL STRIPE_PRICE_ULTRA_LIFETIME
//   STRIPE_CURRENCY            (optional, default "usd")
//   ROBUX_GAMEPASS_ULTRA       (Ultra-only monthly gamepass id)
import {
  json, requireUser, usersStore, normalizePlan, PLAN_INFO, planName, isExec, audit, guard, monthKey,
} from "../lib/util.js";
import { sendPlanThanks, sendCreditsThanks } from "../lib/purchaseThanks.js";

const STRIPE_PRICE_ENV = {
  pro:   { monthly: "STRIPE_PRICE_PRO_MONTHLY",   annual: "STRIPE_PRICE_PRO_ANNUAL",   lifetime: "STRIPE_PRICE_PRO_LIFETIME" },
  ultra: { monthly: "STRIPE_PRICE_ULTRA_MONTHLY", annual: "STRIPE_PRICE_ULTRA_ANNUAL", lifetime: "STRIPE_PRICE_ULTRA_LIFETIME" },
};

// "Gatherly Custom" one-off boost-credit packs. Amounts are in the smallest
// currency unit (cents). Note: top-up credits only affect discovery-feed boosting
// — they never change the depth of analytics in a report (that is fixed by the
// subscription plan).
const CREDIT_PACKS = {
  3:  { credits: 3,  amount: 399,  label: "3 boost credits"  },
  6:  { credits: 6,  amount: 699,  label: "6 boost credits"  },
  12: { credits: 12, amount: 1199, label: "12 boost credits" },
};
const CURRENCY = (process.env.STRIPE_CURRENCY || "usd").toLowerCase();

async function fetchT(url, opts = {}, ms = 10000) { return fetch(url, { ...opts, signal: AbortSignal.timeout(ms) }); }

async function stripeCheckout(params) {
  const sk = process.env.STRIPE_SECRET_KEY;
  const r = await fetchT("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${sk}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const d = await r.json();
  return { ok: r.ok, d };
}

export default async (req) => {
  try { return await handler(req); }
  catch (e) { return json({ error: "Server error: " + (e?.message || "unknown") }, 500); }
};

async function handler(req) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const siteUrl = (process.env.SITE_URL || `${url.protocol}//${url.host}`).replace(/\/$/, "");

  // Public: let the pricing page render packs from the server so prices stay in sync.
  if (action === "credit-packs") {
    return json({ currency: CURRENCY, packs: Object.values(CREDIT_PACKS).map((p) => ({ credits: p.credits, amount: p.amount, label: p.label })) });
  }

  const user = await requireUser(req);
  if (!user) return json({ error: "Log in first to subscribe." }, 401);

  // ---- Exec-only: send yourself a test purchase thank-you DM ----
  // Hits the exact same sendPlanThanks/sendCreditsThanks functions the real
  // webhook and Robux paths call, just targeted at the caller's own Discord
  // account instead of triggered by an actual payment, so the card design
  // can be checked without spending real money or buying Robux.
  if (action === "test-purchase-thanks" && req.method === "POST") {
    if (!isExec(user)) return json({ error: "Executive only." }, 403);
    const blocked = await guard(req, user, `test-thanks:${user.id}`, 10, 600, { kind: "billing", what: "Repeated test purchase-thanks sends." });
    if (blocked) return blocked;
    if (!user.discordId) return json({ error: "Your account has no linked Discord ID." }, 400);

    const b = await req.json().catch(() => ({}));
    const kind = b.kind === "credits" ? "credits" : "plan";
    const r = kind === "credits"
      ? await sendCreditsThanks(user, Math.max(1, parseInt(b.credits, 10) || 6), {
          amountCents: CREDIT_PACKS[Math.max(1, parseInt(b.credits, 10) || 6)]?.amount ?? 699,
          currency: CURRENCY,
          method: "Stripe card (test)",
          newState: `${user.credits ?? 0} boost credits available`,
        })
      : await sendPlanThanks(user, planName(normalizePlan(b.plan) === "free" ? "ultra" : normalizePlan(b.plan)), {
          amountCents: 1499,
          currency: CURRENCY,
          method: "Stripe card (test)",
          newState: "Active until (test data)",
        });
    if (!r.ok) return json({ error: `Could not send the test DM (${r.reason}). Check DISCORD_BOT_TOKEN and that you share a server with the bot and allow DMs.` }, 400);
    return json({ ok: true });
  }

  // ---- Subscription / lifetime checkout ----
  if (action === "checkout" && req.method === "POST") {
    const blocked = await guard(req, user, `billing:${user.id}`, 8, 60, { kind: "billing", what: "Rapid checkout-session requests." });
    if (blocked) return blocked;

    const b = await req.json().catch(() => ({}));
    const plan = normalizePlan(b.plan);
    const cycle = ["monthly", "annual", "lifetime"].includes(b.cycle) ? b.cycle : "monthly";
    if (plan === "free") return json({ error: "The free tier needs no checkout." }, 400);

    const envName = STRIPE_PRICE_ENV[plan]?.[cycle];
    const sk = process.env.STRIPE_SECRET_KEY;
    const priceId = envName ? process.env[envName] : null;
    if (!sk || !priceId) return json({ error: `Card payments for ${PLAN_INFO[plan].name} (${cycle}) aren't configured yet. Admin: set STRIPE_SECRET_KEY and ${envName} in Netlify env vars.` }, 400);

    const mode = cycle === "lifetime" ? "payment" : "subscription";
    const params = {
      mode,
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      success_url: `${siteUrl}/dashboard?upgraded=${plan}`,
      cancel_url: `${siteUrl}/pricing`,
      client_reference_id: user.id,
      "metadata[userId]": user.id,
      "metadata[plan]": plan,
      "metadata[cycle]": cycle,
      "metadata[kind]": "plan",
    };
    if (user.stripeCustomerId) params.customer = user.stripeCustomerId;

    const { ok, d } = await stripeCheckout(params);
    if (!ok) return json({ error: d.error?.message || "Stripe error." }, 502);
    return json({ url: d.url });
  }

  // ---- Gatherly Custom: buy boost credits ----
  if (action === "buy-credits" && req.method === "POST") {
    const blocked = await guard(req, user, `billing:${user.id}`, 8, 60, { kind: "billing", what: "Rapid credit-pack checkout requests." });
    if (blocked) return blocked;

    const b = await req.json().catch(() => ({}));
    const pack = CREDIT_PACKS[parseInt(b.pack, 10)];
    if (!pack) return json({ error: "Choose a pack of 3, 6, or 12 credits." }, 400);
    const sk = process.env.STRIPE_SECRET_KEY;
    if (!sk) return json({ error: "Card payments aren't configured yet. Admin: set STRIPE_SECRET_KEY." }, 400);

    const params = {
      mode: "payment",
      "line_items[0][price_data][currency]": CURRENCY,
      "line_items[0][price_data][product_data][name]": `Gatherly Custom - ${pack.label}`,
      "line_items[0][price_data][unit_amount]": String(pack.amount),
      "line_items[0][quantity]": "1",
      success_url: `${siteUrl}/dashboard?credits=${pack.credits}`,
      cancel_url: `${siteUrl}/pricing`,
      client_reference_id: user.id,
      "metadata[userId]": user.id,
      "metadata[kind]": "credits",
      "metadata[credits]": String(pack.credits),
    };
    if (user.stripeCustomerId) params.customer = user.stripeCustomerId;

    const { ok, d } = await stripeCheckout(params);
    if (!ok) return json({ error: d.error?.message || "Stripe error." }, 502);
    return json({ url: d.url });
  }

  // ---- Robux gamepass verification (Ultra, manual monthly) ----
  if (action === "verify-robux" && req.method === "POST") {
    const blocked = await guard(req, user, `robux:${user.id}`, 6, 60, { kind: "billing", what: "Rapid Robux verification attempts." });
    if (blocked) return blocked;

    const b = await req.json().catch(() => ({}));
    const plan = normalizePlan(b.plan);
    if (plan !== "ultra") return json({ error: "Robux payment is available for Gatherly Ultra only." }, 400);
    const gamepassId = process.env.ROBUX_GAMEPASS_ULTRA;
    if (!gamepassId) return json({ error: "Robux payments aren't configured yet. Admin: create the gamepass and set ROBUX_GAMEPASS_ULTRA." }, 400);

    const robloxId = user.robloxId || b.robloxId;
    if (!robloxId) return json({ error: "Enter your Roblox user ID to verify the gamepass purchase." }, 400);

    const r = await fetchT(`https://inventory.roblox.com/v1/users/${robloxId}/items/GamePass/${gamepassId}`);
    if (!r.ok) return json({ error: "Could not check gamepass ownership right now. Try again shortly." }, 502);
    const d = await r.json();
    const owns = Array.isArray(d.data) && d.data.length > 0;
    if (!owns) return json({ error: "Gamepass purchase not found on your account yet. Buy it on Roblox, then verify again." }, 402);

    // Robux is manual and not recurring, so we grant 30 days; re-verify to extend.
    const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
    const updated = {
      ...user, robloxId, plan: "ultra", planVia: "robux", planCycle: "monthly", subStatus: "active",
      planVerifiedAt: new Date().toISOString(), planExpiresAt: expiresAt,
      credits: PLAN_INFO.ultra.monthlyCredits, creditsPeriod: monthKey(),
    };
    await usersStore().setJSON(user.id, updated);
    await audit(user, "billing.robux-ultra", { robloxId });
    // Fire-and-forget, same reasoning as the Stripe paths in webhook.js. No
    // Robux amount is available here (the gamepass price lives on Roblox's
    // side, not something this endpoint queries), so the receipt just shows
    // the payment method without inventing a figure.
    sendPlanThanks(updated, planName("ultra"), {
      method: "Robux gamepass",
      newState: `Active until ${new Date(expiresAt).toLocaleDateString("en-AU", { dateStyle: "medium" })}`,
    }).catch(() => {});
    return json({ ok: true, plan: "ultra" });
  }
if (action === "portal" && req.method === "POST") {
    if (!user.stripeCustomerId) return json({ error: "No billing account found." }, 400);
    const sk = process.env.STRIPE_SECRET_KEY;
    const r = await fetchT("https://api.stripe.com/v1/billing_portal/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${sk}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ customer: user.stripeCustomerId, return_url: `${siteUrl}/dashboard` }),
    });
    const d = await r.json();
    if (!r.ok) return json({ error: d.error?.message || "Could not open billing portal." }, 502);
    return json({ url: d.url });
  }

  return json({ error: "Unknown action." }, 404);
}
  return json({ error: "Unknown action." }, 404);
}
