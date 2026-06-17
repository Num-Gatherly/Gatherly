// /api/webhook - Stripe webhook. THE security-critical endpoint.
//
// Verifies every event with the stripe-signature header over the RAW body
// using STRIPE_WEBHOOK_SECRET, so nobody can POST a fake "you paid" event.
//
// Handles the full lifecycle:
//   checkout.session.completed   -> activate subscription / grant lifetime / add purchased credits
//   invoice.paid                 -> renew: extend access + refresh monthly credits
//   customer.subscription.updated-> sync access window / status changes
//   customer.subscription.deleted-> lapse access (KEEP credits + KEEP past reports)
//
// Env vars: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
import {
  json, usersStore, miscStore, audit, verifyStripeSignature,
  normalizePlan, PLAN_INFO, monthKey, adsStore, postStaffEvent, brandEmbed,
} from "../lib/util.js";

async function fetchT(url, opts = {}, ms = 10000) { return fetch(url, { ...opts, signal: AbortSignal.timeout(ms) }); }

async function stripeGet(path) {
  const sk = process.env.STRIPE_SECRET_KEY;
  if (!sk) return null;
  try {
    const r = await fetchT(`https://api.stripe.com/v1/${path}`, { headers: { Authorization: `Bearer ${sk}` } });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

const uStore = () => usersStore();
const mStore = () => miscStore();

const custKey = (cid) => `scust_${cid}`;
async function linkCustomer(customerId, userId) { if (customerId && userId) await mStore().setJSON(custKey(customerId), { userId }); }
async function userIdFromCustomer(customerId) {
  if (!customerId) return null;
  const rec = await mStore().get(custKey(customerId), { type: "json" });
  return rec?.userId || null;
}

function expiryFromUnix(sec) { return sec ? new Date(sec * 1000).toISOString() : null; }
function expiryFromCycle(cycle) {
  const d = new Date();
  if (cycle === "annual") d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString();
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "POST only." }, 405);

  // 1) RAW body first, never parse before verifying.
  const raw = await req.text();
  const sig = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return json({ error: "Webhook not configured (STRIPE_WEBHOOK_SECRET missing)." }, 500);
  if (!verifyStripeSignature(raw, sig, secret)) {
    await audit(null, "webhook.bad-signature", { ip: req.headers.get("x-nf-client-connection-ip") || null });
    return json({ error: "Invalid signature." }, 400);
  }

  let event;
  try { event = JSON.parse(raw); } catch { return json({ error: "Bad JSON." }, 400); }

  // 2) Idempotency: Stripe retries. Process each event id once.
  const seenKey = `sevt_${event.id}`;
  if (await mStore().get(seenKey, { type: "json" })) return json({ received: true, duplicate: true });

  try {
    await route(event);
  } catch (e) {
    await audit(null, "webhook.error", { type: event.type, error: e?.message || "unknown" });
    // 200 so Stripe does not hammer retries on our internal bug; we logged it.
    return json({ received: true, handled: false });
  }

  await mStore().setJSON(seenKey, { at: new Date().toISOString(), type: event.type });
  return json({ received: true });
};

async function route(event) {
  const obj = event.data?.object || {};

  if (event.type === "checkout.session.completed") {
    const meta = obj.metadata || {};
    const userId = obj.client_reference_id || meta.userId;
    if (!userId) return;
    const user = await uStore().get(userId, { type: "json" });
    if (!user) return;

    const customerId = obj.customer || null;
    if (customerId) await linkCustomer(customerId, userId);

    // (a0) Advertising placement purchase -> mark paid, leave PENDING for staff approval.
    if (meta.kind === "ad") {
      const ad = await adsStore().get(meta.adId, { type: "json" });
      if (ad) {
        ad.paid = true; ad.paidAt = new Date().toISOString();
        await adsStore().setJSON(ad.id, ad);
        await audit({ id: userId, username: user.username }, "billing.ad-paid", { adId: ad.id });
        await postStaffEvent(brandEmbed({
          title: "New advertisement awaiting approval",
          description: `**${ad.title}**\nBy ${ad.username} · ${ad.days}-day placement · paid.`,
          color: ad.scan?.flagged ? 0xffcf5c : 0x7fa8ff,
          fields: ad.scan?.flagged ? [{ name: "Watchdog flags", value: ad.scan.reasons.join("\n").slice(0, 1000) }] : [],
          thumbnail: ad.image || undefined,
        }));
      }
      return;
    }

    // (a) Credit pack purchase ("Gatherly Custom")
    if (meta.kind === "credits") {
      const add = Math.max(0, parseInt(meta.credits, 10) || 0);
      const credits = (user.credits ?? 0) + add;
      await uStore().setJSON(userId, { ...user, credits, stripeCustomerId: customerId || user.stripeCustomerId, updatedAt: new Date().toISOString() });
      await audit({ id: userId, username: user.username }, "billing.credits-purchase", { add, newTotal: credits });
      return;
    }

    // (b) Plan purchase (subscription or lifetime one-off)
    const plan = normalizePlan(meta.plan);
    if (plan === "free") return;
    const cycle = ["monthly", "annual", "lifetime"].includes(meta.cycle) ? meta.cycle : "monthly";
    const grant = PLAN_INFO[plan].monthlyCredits;
    const base = {
      ...user, plan, planVia: cycle === "lifetime" ? "lifetime" : "stripe", planCycle: cycle,
      stripeCustomerId: customerId || user.stripeCustomerId || null,
      stripeSubscriptionId: obj.subscription || user.stripeSubscriptionId || null,
      subStatus: "active", credits: grant, creditsPeriod: monthKey(), planSetAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };

    if (cycle === "lifetime") {
      await uStore().setJSON(userId, { ...base, lifetime: true, planExpiresAt: null });
    } else {
      let expiresAt = null;
      if (obj.subscription) { const sub = await stripeGet(`subscriptions/${obj.subscription}`); expiresAt = expiryFromUnix(sub?.current_period_end); }
      await uStore().setJSON(userId, { ...base, lifetime: false, planExpiresAt: expiresAt || expiryFromCycle(cycle) });
    }
    await audit({ id: userId, username: user.username }, "billing.activate", { plan, cycle });
    return;
  }

  if (event.type === "invoice.paid" || event.type === "invoice.payment_succeeded") {
    const userId = await userIdFromCustomer(obj.customer);
    if (!userId) return;
    const user = await uStore().get(userId, { type: "json" });
    if (!user) return;
    const plan = normalizePlan(user.plan);
    if (plan === "free") return;
    const periodEnd = obj.lines?.data?.[0]?.period?.end;
    await uStore().setJSON(userId, {
      ...user, subStatus: "active",
      planExpiresAt: expiryFromUnix(periodEnd) || expiryFromCycle(user.planCycle || "monthly"),
      credits: PLAN_INFO[plan].monthlyCredits, creditsPeriod: monthKey(), updatedAt: new Date().toISOString(),
    });
    await audit({ id: userId, username: user.username }, "billing.renew", { plan });
    return;
  }

  if (event.type === "customer.subscription.updated") {
    const userId = await userIdFromCustomer(obj.customer);
    if (!userId) return;
    const user = await uStore().get(userId, { type: "json" });
    if (!user) return;
    const active = obj.status === "active" || obj.status === "trialing";
    await uStore().setJSON(userId, {
      ...user, subStatus: obj.status,
      planExpiresAt: active ? expiryFromUnix(obj.current_period_end) : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await audit({ id: userId, username: user.username }, "billing.sub-update", { status: obj.status });
    return;
  }

  if (event.type === "customer.subscription.deleted") {
    const userId = await userIdFromCustomer(obj.customer);
    if (!userId) return;
    const user = await uStore().get(userId, { type: "json" });
    if (!user) return;
    // Lapse access immediately. KEEP credits, KEEP plan label and all past reports.
    await uStore().setJSON(userId, {
      ...user, subStatus: "canceled", planExpiresAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    await audit({ id: userId, username: user.username }, "billing.sub-canceled", {});
    return;
  }

  // All other event types: acknowledged, no action.
}
