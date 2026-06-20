// netlify/lib/purchaseThanks.js
// Sends a Components V2 thank-you DM the moment someone buys credits or a
// plan, however they paid (Stripe checkout, Stripe subscription, or the
// Robux gamepass path), customised to exactly what they bought.
import { discordBotFetch } from "./util.js";
import { text, separator, container, V2_FLAG } from "./broadcast.js";

const FOOTER_BANNER_URL = "https://i.postimg.cc/Dz3962LS/image-1.webp";
const SITE_URL = process.env.SITE_URL || "https://gatherly-erlc.xyz";

function purchaseThanksPayload(discordId, headline, benefitsPhrase) {
  const blocks = [
    text([
      `# Thank you for purchasing ${headline}!`,
      `Thank you <@${discordId}> for purchasing **${headline}** - ${benefitsPhrase} [here](${SITE_URL}/pricing)`,
    ].join("\n")),
    separator(),
    { type: 12, items: [{ media: { url: FOOTER_BANNER_URL } }] },
  ];
  return { flags: V2_FLAG, components: [container(blocks, 0x69d99c)] };
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

// Plan purchase (Stripe subscription/lifetime, or Robux gamepass).
export async function sendPlanThanks(host, planDisplayName) {
  if (!host?.discordId) return { ok: false, reason: "no-discord-id" };
  const payload = purchaseThanksPayload(host.discordId, planDisplayName, "We trust you are going to enjoy the benefits that can be found");
  const r = await dmDiscordId(host.discordId, payload);
  if (!r.ok) console.log(`[purchaseThanks] plan DM failed for ${host.id}: ${r.reason}, ${r.detail || ""}`);
  return r;
}

// Credit pack purchase.
export async function sendCreditsThanks(host, creditAmount) {
  if (!host?.discordId) return { ok: false, reason: "no-discord-id" };
  const headline = `${creditAmount} Boost Credit${creditAmount === 1 ? "" : "s"}`;
  const payload = purchaseThanksPayload(host.discordId, headline, "You can spend them boosting your next listing, full pricing details");
  const r = await dmDiscordId(host.discordId, payload);
  if (!r.ok) console.log(`[purchaseThanks] credits DM failed for ${host.id}: ${r.reason}, ${r.detail || ""}`);
  return r;
}
