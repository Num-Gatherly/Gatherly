// netlify/lib/purchaseThanks.js
// Fires three things the moment someone buys credits or a plan, however
// they paid (Stripe checkout, Stripe subscription, or the Robux gamepass
// path):
//   1. A thank-you DM to the purchaser, customised to what they bought.
//   2. A follow-up receipt DM (separate message) with the actual
//      transaction details: item, amount, method, date, new account state.
//   3. A public announcement posted to the supporters channel, using the
//      same wording as the DM thank-you card.
//
// The wording (benefits phrases, banner image, receipt footer note) is
// editable from Control Room -> Broadcast -> Purchase thank-you message,
// stored under miscStore() key "purchaseThanksContent". Anything not set
// there falls back to the defaults below.
import { discordBotFetch, miscStore } from "./util.js";
import { text, separator, container, V2_FLAG } from "./broadcast.js";

const DEFAULT_FOOTER_BANNER_URL = "https://i.postimg.cc/Dz3962LS/image-1.webp";
const DEFAULT_BENEFITS_PHRASE_PLAN = "We trust you are going to enjoy the benefits that can be found";
const DEFAULT_BENEFITS_PHRASE_CREDITS = "You can spend them boosting your next listing, full pricing details";
const DEFAULT_RECEIPT_FOOTER_NOTE = "Keep this for your records. Questions about a charge? Reach support from the Gatherly website.";

const SITE_URL = process.env.SITE_URL || "https://gatherly-erlc.xyz";
export const SUPPORTERS_CHANNEL_ID = process.env.SUPPORTERS_CHANNEL_ID || "1515968720424402974";

async function getContent() {
  const c = (await miscStore().get("purchaseThanksContent", { type: "json" })) || {};
  return {
    benefitsPhrasePlan: c.benefitsPhrasePlan || DEFAULT_BENEFITS_PHRASE_PLAN,
    benefitsPhraseCredits: c.benefitsPhraseCredits || DEFAULT_BENEFITS_PHRASE_CREDITS,
    footerBannerUrl: c.footerBannerUrl || DEFAULT_FOOTER_BANNER_URL,
    receiptFooterNote: c.receiptFooterNote || DEFAULT_RECEIPT_FOOTER_NOTE,
  };
}

function thanksPayload(discordId, headline, benefitsPhrase, footerBannerUrl) {
  const blocks = [
    text([
      `# Thank you for purchasing ${headline}!`,
      `Thank you <@${discordId}> for purchasing **${headline}** - ${benefitsPhrase} [here](${SITE_URL}/pricing)`,
    ].join("\n")),
    separator(),
    { type: 12, items: [{ media: { url: footerBannerUrl } }] },
  ];
  return { flags: V2_FLAG, components: [container(blocks, 0x69d99c)] };
}

function formatMoney(amountCents, currency) {
  if (amountCents == null) return null;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: (currency || "usd").toUpperCase() }).format(amountCents / 100);
  } catch { return `$${(amountCents / 100).toFixed(2)}`; }
}

// `details` shape (all optional, the receipt only shows what it's given):
//   { amountCents, currency, method ("Stripe card"/"Robux gamepass"),
//     robuxAmount, newState ("12 boost credits"/"Active until 19 Jul 2026") }
function receiptPayload(headline, details = {}, receiptFooterNote) {
  const price = details.robuxAmount
    ? `R$${details.robuxAmount}`
    : (formatMoney(details.amountCents, details.currency) || "—");
  const rows = [
    `\`-\` Item: **${headline}**`,
    `\`-\` Amount: **${price}**`,
    `\`-\` Payment method: ${details.method || "Unknown"}`,
    `\`-\` Date: ${new Date().toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}`,
  ];
  if (details.newState) rows.push(`\`-\` Account: ${details.newState}`);

  const blocks = [
    text([
      "# Receipt",
      rows.join("\n"),
      "",
      `-# ${receiptFooterNote}`,
    ].join("\n")),
  ];
  return { flags: V2_FLAG, components: [container(blocks, 0x7fa8ff)] };
}

async function dmDiscordId(discordId, payload) {
  if (!process.env.DISCORD_BOT_TOKEN || !discordId) return { ok: false, reason: "not-configured" };
  try {
    const ch = await discordBotFetch("/users/@me/channels", { method: "POST", body: JSON.stringify({ recipient_id: discordId }) });
    if (!ch.ok) return { ok: false, reason: `discord-${ch.status}` };
    const { id: channelId } = await ch.json();
    const r = await discordBotFetch(`/channels/${channelId}/messages`, { method: "POST", body: JSON.stringify(payload) });
    if (!r.ok) {
      let detail = "";
      try { detail = await r.text(); } catch {}
      return { ok: false, reason: `discord-${r.status}`, detail };
    }
    return { ok: true };
  } catch (e) { return { ok: false, reason: "network-error", detail: e?.message || String(e) }; }
}

async function postChannel(payload) {
  if (!process.env.DISCORD_BOT_TOKEN) return { ok: false, reason: "not-configured" };
  try {
    const r = await discordBotFetch(`/channels/${SUPPORTERS_CHANNEL_ID}/messages`, { method: "POST", body: JSON.stringify(payload) });
    if (!r.ok) {
      let detail = "";
      try { detail = await r.text(); } catch {}
      return { ok: false, reason: `discord-${r.status}`, detail };
    }
    return { ok: true };
  } catch (e) { return { ok: false, reason: "network-error", detail: e?.message || String(e) }; }
}

// Runs all three deliveries for a purchase. `details` is optional, the
// channel post and thank-you DM work fine without it, only the receipt
// degrades gracefully (shows "—" for unknown fields) if it's missing.
async function fireAll(host, headline, benefitsPhraseKey, details) {
  if (!host?.discordId) return { ok: false, reason: "no-discord-id" };
  const content = await getContent();
  const benefitsPhrase = content[benefitsPhraseKey];
  const thanks = thanksPayload(host.discordId, headline, benefitsPhrase, content.footerBannerUrl);
  const receipt = receiptPayload(headline, details, content.receiptFooterNote);

  const [dmThanks, dmReceipt, channel] = await Promise.all([
    dmDiscordId(host.discordId, thanks),
    dmDiscordId(host.discordId, receipt),
    postChannel(thanks),
  ]);

  if (!dmThanks.ok) console.log(`[purchaseThanks] thanks DM failed for ${host.id}: ${dmThanks.reason}, ${dmThanks.detail || ""}`);
  if (!dmReceipt.ok) console.log(`[purchaseThanks] receipt DM failed for ${host.id}: ${dmReceipt.reason}, ${dmReceipt.detail || ""}`);
  if (!channel.ok) console.log(`[purchaseThanks] channel announce failed for ${host.id}: ${channel.reason}, ${channel.detail || ""}`);

  // ok is true if at least the primary thank-you DM landed, the receipt and
  // channel post are best-effort and shouldn't make the whole thing "failed"
  // if Discord rejects one of them for an unrelated reason.
  return { ok: dmThanks.ok, dmThanks, dmReceipt, channel };
}

// Plan purchase (Stripe subscription/lifetime, or Robux gamepass).
export async function sendPlanThanks(host, planDisplayName, details) {
  return fireAll(host, planDisplayName, "benefitsPhrasePlan", details);
}

// Credit pack purchase.
export async function sendCreditsThanks(host, creditAmount, details) {
  const headline = `${creditAmount} Boost Credit${creditAmount === 1 ? "" : "s"}`;
  return fireAll(host, headline, "benefitsPhraseCredits", details);
}
