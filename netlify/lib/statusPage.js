// netlify/lib/statusPage.js
// Live status message for Discord. One message, edited in place every
// minute (the most frequent Netlify's scheduler allows), in the channel
// 1515875341737136168. Rebuilds the card from three real checks: ER:LC
// API reachability, the Gatherly website itself, and Netlify's own public
// incident feed (the host serving that same website).
import { discordBotFetch, miscStore, audit } from "./util.js";
import { text, separator, container, GATHERLY_EMOJI_TAG, V2_FLAG } from "./broadcast.js";

export const STATUS_CHANNEL_ID = process.env.STATUS_CHANNEL_ID || "1515875341737136168";
const SITE_URL = process.env.SITE_URL || "https://gatherly-erlc.xyz";
const ERLC_BASE = "https://api.erlc.gg/v1";
const NETLIFY_STATUS_URL = "https://www.netlifystatus.com/api/v2/status.json";

const TOP_BANNER_URL = "https://i.postimg.cc/zfqzxS1L/image.webp";
const FOOTER_BANNER_URL = "https://i.postimg.cc/Dz3962LS/image-1.webp";

// Service logo emoji (leading icon for each row).
const LOGO = {
  erlc: "<:erlc:1515981127184289832>",
  website: GATHERLY_EMOJI_TAG, // 1515856827689205972
  netlify: "<:netlify:1515982651104956457>",
};

// Green Gatherly logo swapped in when a service is up; plain red circle when
// it's down. No in-between custom emoji was provided, so "degraded" also
// falls back to the red circle rather than inventing a third icon.
const ONLINE_BADGE = "<:online:1515988360253018184>";
const DOWN_BADGE = "🔴";

async function fetchT(url, opts = {}, ms = 6000) {
  return fetch(url, { ...opts, signal: AbortSignal.timeout(ms) });
}

/* =========================================================================
   PROBES
   ========================================================================= */
async function checkErlc() {
  try {
    const r = await fetchT(`${ERLC_BASE}/server`, { headers: { "server-key": "status-probe" } }, 5000);
    // A 502/503/504 means the upstream is actually down. A 401/403 just
    // means our probe key is rejected, which still proves the API itself
    // answered, so that counts as up.
    return { up: r.status !== 502 && r.status !== 503 && r.status !== 504 };
  } catch { return { up: false }; }
}

async function checkWebsite() {
  try {
    const r = await fetchT(SITE_URL, { method: "GET" }, 6000);
    return { up: r.ok || (r.status >= 300 && r.status < 400) };
  } catch { return { up: false }; }
}

async function checkNetlify() {
  try {
    const r = await fetchT(NETLIFY_STATUS_URL, {}, 5000);
    if (!r.ok) return { up: false };
    const d = await r.json();
    const indicator = d?.status?.indicator || "none";
    // Netlify's own scale: none/minor are fine, major/critical are a real
    // platform incident worth flagging red.
    return { up: indicator === "none" || indicator === "minor", indicator };
  } catch { return { up: false }; }
}

export async function runChecks() {
  const [erlc, website, netlify] = await Promise.all([checkErlc(), checkWebsite(), checkNetlify()]);
  return { erlc, website, netlify, checkedAt: new Date().toISOString() };
}

/* =========================================================================
   V2 MESSAGE BUILDER
   ========================================================================= */
function row(label, logo, up) {
  const badge = up ? ONLINE_BADGE : DOWN_BADGE;
  // Coloured status word per row, since a custom red/yellow dot set wasn't
  // provided, plain markdown bold colour isn't a thing in Discord text, so
  // the word itself plus the badge carries the signal.
  const word = up ? "Operational" : "Down";
  return `\`-\` ${logo} **${label}** ${badge} ${word}`;
}

export function statusPayload(checks) {
  const allUp = checks.erlc.up && checks.website.up && checks.netlify.up;
  const anyDown = !checks.erlc.up || !checks.website.up || !checks.netlify.up;
  const accent = allUp ? 0x69d99c : anyDown ? 0xff7a7a : 0xffcf5c;

  const rows = [
    row("ER:LC API", LOGO.erlc, checks.erlc.up),
    row("Gatherly Website", LOGO.website, checks.website.up),
    row("Netlify", LOGO.netlify, checks.netlify.up),
  ].join("\n");

  const blocks = [
    { type: 12, items: [{ media: { url: TOP_BANNER_URL } }] },
    separator(),
    text(`> View **${GATHERLY_EMOJI_TAG}atherly's** live status updates. Providing accurate updates on API integrations and website uptime. If you stumble across a bug in **${GATHERLY_EMOJI_TAG}atherly's** environment, report it [here](${SITE_URL}/contact)`),
    separator(),
    text(rows),
    separator(),
    text(`-# Last checked <t:${Math.floor(Date.now() / 1000)}:R> · updates every minute`),
    { type: 12, items: [{ media: { url: FOOTER_BANNER_URL } }] },
  ];

  return {
    flags: V2_FLAG,
    components: [container(blocks, accent)],
  };
}

/* =========================================================================
   SEND / EDIT (single persistent message)
   ========================================================================= */
async function getMessageRef() {
  return (await miscStore().get("statusMessage", { type: "json" })) || null;
}
async function saveMessageRef(ref) {
  await miscStore().setJSON("statusMessage", ref);
}

export async function upsertStatusMessage() {
  if (!process.env.DISCORD_BOT_TOKEN) return { ok: false, reason: "bot-not-configured" };
  const checks = await runChecks();
  const payload = statusPayload(checks);
  const ref = await getMessageRef();

  if (ref?.messageId) {
    try {
      const r = await discordBotFetch(`/channels/${STATUS_CHANNEL_ID}/messages/${ref.messageId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      if (r.ok) return { ok: true, action: "edited", checks };
      // A 404 here means the stored message was deleted out from under us
      // (manually, or the channel was cleared), so fall through and create
      // a fresh one instead of failing forever on a message that's gone.
      if (r.status !== 404) {
        let detail = "";
        try { detail = await r.text(); } catch {}
        return { ok: false, reason: `discord-${r.status}`, detail };
      }
    } catch {}
  }

  try {
    const r = await discordBotFetch(`/channels/${STATUS_CHANNEL_ID}/messages`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      let detail = "";
      try { detail = await r.text(); } catch {}
      return { ok: false, reason: `discord-${r.status}`, detail };
    }
    const m = await r.json();
    await saveMessageRef({ messageId: m.id, channelId: STATUS_CHANNEL_ID, createdAt: new Date().toISOString() });
    return { ok: true, action: "created", checks };
  } catch (e) {
    return { ok: false, reason: "network-error", detail: e?.message || String(e) };
  }
}

export async function recordStatusRun(result) {
  // Only audit state *changes* and failures, an every-minute "it's fine"
  // entry would drown the audit log within a day.
  const prev = (await miscStore().get("statusLastState", { type: "json" })) || null;
  const cur = result.ok ? {
    erlc: result.checks.erlc.up, website: result.checks.website.up, netlify: result.checks.netlify.up,
  } : null;
  const changed = !result.ok || !prev || JSON.stringify(prev) !== JSON.stringify(cur);
  if (changed) {
    await audit(null, "status.sweep", { ok: result.ok, action: result.action, reason: result.reason || null, ...cur });
    if (cur) await miscStore().setJSON("statusLastState", cur);
  }
}
