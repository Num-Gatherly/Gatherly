// Shared backend helpers used by all Gatherly functions.
// This is the foundation file: every /api/* function imports from here.
// Safe to drop in over netlify/lib/util.js wholesale.
import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

/* =========================================================================
   TUNABLE CONSTANTS
   ========================================================================= */
export const PLAYER_CAP = 40;
export const BLACKLIST_ROLE_ID_DEFAULT = "1515466445084037285";
const PRO_MONTHLY_CREDITS = 6;
const ULTRA_MONTHLY_CREDITS = 12;
const EVENT_CAP_FREE = 6;
const EVENT_CAP_PRO = 14;
const EVENT_CAP_ULTRA = 21;

/* =========================================================================
   HTTP HELPERS
   ========================================================================= */
export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });

export const redirect = (url, headers = {}) =>
  new Response(null, { status: 302, headers: { Location: url, ...headers } });

/* =========================================================================
   STORES
   ========================================================================= */
export const usersStore = () => getStore("users");
export const eventsStore = () => getStore("events");
export const miscStore = () => getStore("misc");
export const imagesStore = () => getStore("images");
export const ticketsStore = () => getStore("tickets");
export const auditStore = () => getStore("audit");
export const codesStore = () => getStore("adminCodes");
export const adsStore = () => getStore("ads");
export const newsStore = () => getStore("news");
export const roleRequestsStore = () => getStore("roleRequests");

/* =========================================================================
   SECRETS / SESSION
   ========================================================================= */
function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET env var is not set");
  return s;
}

const COOKIE = "gatherly_session";

export function makeSessionCookie(userId, days = 30) {
  const exp = Date.now() + days * 86400000;
  const payload = `${userId}.${exp}`;
  const sig = crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${COOKIE}=${payload}.${sig}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${days * 86400}`;
}

export const clearSessionCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

export function readSession(req) {
  const cookies = req.headers.get("cookie") || "";
  const m = cookies.match(new RegExp(`${COOKIE}=([^;]+)`));
  if (!m) return null;
  const [userId, exp, sig] = m[1].split(".");
  if (!userId || !exp || !sig) return null;
  const expect = crypto.createHmac("sha256", secret()).update(`${userId}.${exp}`).digest("base64url");
  try { if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null; } catch { return null; }
  if (Number(exp) < Date.now()) return null;
  return { userId };
}

export async function requireUser(req) {
  const s = readSession(req);
  if (!s) return null;
  const user = await usersStore().get(s.userId, { type: "json" });
  if (!user || user.suspended) return null;
  return user;
}

/* =========================================================================
   ROLES
   ========================================================================= */
export const isStaff = (u) => Boolean(u && (u.role === "admin" || u.role === "executive"));
export const isExec = (u) => Boolean(u && u.role === "executive");

/* =========================================================================
   ENCRYPTION (AES-256-GCM) for stored ER:LC keys
   ========================================================================= */
function encKey() { return crypto.scryptSync(secret(), "gatherly-erlc-key", 32); }

export function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encKey(), iv);
  const enc = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${enc.toString("base64url")}`;
}

export function decrypt(blob) {
  const [iv, tag, data] = blob.split(".").map((p) => Buffer.from(p, "base64url"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", encKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/* =========================================================================
   RATE LIMITING + WATCHDOG
   ========================================================================= */
export async function rateState(bucket, limit, windowSec) {
  const store = miscStore();
  const key = `rl_${bucket}`;
  const now = Date.now();
  const rec = (await store.get(key, { type: "json" })) || { hits: [] };
  rec.hits = rec.hits.filter((t) => now - t < windowSec * 1000);
  if (rec.hits.length >= limit) {
    const oldest = Math.min(...rec.hits);
    const retryAfter = Math.max(1, Math.ceil((windowSec * 1000 - (now - oldest)) / 1000));
    return { ok: false, retryAfter };
  }
  rec.hits.push(now);
  await store.setJSON(key, rec);
  return { ok: true, retryAfter: 0 };
}

export async function rateLimit(bucket, limit, windowSec) {
  return (await rateState(bucket, limit, windowSec)).ok;
}

export async function guard(req, actor, bucket, limit, windowSec, opts = {}) {
  const st = await rateState(bucket, limit, windowSec);
  if (st.ok) return null;
  await flagWatchdog(actor, req, opts.kind || "rate-limit", {
    what: opts.what || `Tripped the limit on \`${bucket}\` (${limit} per ${windowSec}s).`,
    risk: opts.risk || "Rapid repeated requests to an action endpoint. Possible scripted abuse or accidental flooding.",
    bucket, limit, windowSec, retryAfter: st.retryAfter,
  });
  return json({ error: `You are doing this too fast, please wait ${st.retryAfter}s and try again.`, retryAfter: st.retryAfter }, 429);
}

// Ask the AI for a short "here is what happened / how to resolve" note for staff.
// Degrades to a sensible static fallback when no API key is set or the call fails.
async function watchdogResolution(kind, detail, actor) {
  const fallback = "Review the activity below in the Control Room. If it looks like abuse, suspend the account from the Users tab. If it looks accidental, no action is needed.";
  const prompt = `You are Gatherly's security analyst. A safety watchdog just flagged activity on our ER:LC events platform. In 2 to 3 short sentences, written for a staff member, explain plainly: what the user appears to have done, why it was flagged, and the recommended action to resolve it (for example: ignore, warn, rate-limit, suspend, or blacklist). Be calm and concrete. No greeting, no markdown headings, no em dashes.\n\nFlag type: ${kind}\nWhat happened: ${detail.what || "An action endpoint limit was tripped."}\nRisk: ${detail.risk || "Repeated requests to an action endpoint."}\nUser: ${actor ? `${actor.username || "unknown"} (id ${actor.id || "?"}, role ${actor.role || "user"})` : "anonymous"}`;
  return (await aiText(prompt, { max_tokens: 200 }).catch(() => null)) || fallback;
}

export async function flagWatchdog(actor, req, kind, detail = {}) {
  let path = "unknown", ip = "unknown";
  try { if (req) { const u = new URL(req.url); path = u.pathname + u.search; ip = clientIp(req); } } catch {}

  // AI-written guidance for staff, stored on the audit record so the Audit log
  // and the Checklist can both show "what they did / how to resolve".
  const aiResolution = await watchdogResolution(kind, detail, actor);

  await audit(actor, `watchdog.${kind}`, {
    ...detail, watchdog: true,
    ip, path,
    diagnosis: detail.what || "Flagged activity.",
    fix: aiResolution,
    aiResolution,
  });

  const url = process.env.WATCHDOG_WEBHOOK_URL;
  if (!url) return;

  const created = actor?.discordId ? `<@${actor.discordId}>` : null;
  await postDiscordWebhook(url, {
    username: "Gatherly Watchdog",
    avatar_url: BRAND.logo,
    embeds: [{
      title: "Watchdog Security Flag",
      color: BRAND.red,
      thumbnail: { url: BRAND.logo },
      description: [
        `# ${kind.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}`,
        `> ${String(detail.risk || "Suspicious activity detected.").slice(0, 400)}`,
        "",
        "### AI assessment and resolution",
        `> ${aiResolution.replace(/\n+/g, "\n> ").slice(0, 900)}`,
      ].join("\n"),
      fields: [
        { name: "User", value: actor ? `**${actor.username || "unknown"}**\n\`${actor.id || "?"}\`${created ? `\n${created}` : ""}` : `Anonymous\n\`${ip}\``, inline: true },
        { name: "What they did", value: String(detail.what || "An action endpoint limit was tripped.").slice(0, 300), inline: true },
        { name: "Endpoint", value: `\`${path}\``, inline: false },
        { name: "IP address", value: `\`${ip}\``, inline: true },
        { name: "Detected", value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
      ],
      timestamp: new Date().toISOString(),
      footer: { text: "Gatherly Watchdog - automated safety flag", icon_url: BRAND.logo },
    }],
  });
}

export const clientIp = (req) =>
  (req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();

/* =========================================================================
   AUDIT LOG
   ========================================================================= */
export async function audit(actor, action, detail = {}) {
  try {
    const k = `${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const level = detail && detail.watchdog ? "warn" : (detail && detail.error ? "error" : "info");
    await auditStore().setJSON(k, { at: new Date().toISOString(), actor: actor ? { id: actor.id, username: actor.username, role: actor.role || null } : null, action, detail, level });
  } catch {}
}

export async function auditError(actor, action, errorMessage) {
  const d = diagnose(errorMessage);
  await audit(actor, action, { error: errorMessage, diagnosis: d.what, fix: d.fix });
}

export function diagnose(msg = "") {
  const m = String(msg).toLowerCase();
  if (m.includes("session_secret")) return { what: "The SESSION_SECRET environment variable is missing.", fix: "In Netlify, Site configuration, Environment variables, add SESSION_SECRET set to any long random string, then redeploy." };
  if (m.includes("401") || m.includes("403") || m.includes("rejected the key")) return { what: "The ER:LC API rejected the saved server key.", fix: "Re-copy the key from in-game Server Settings then API. The server must own the ER:LC API Pack. No spaces or quotes." };
  if (m.includes("422")) return { what: "The ER:LC server is offline or empty.", fix: "Start the private server in-game and try again." };
  if (m.includes("429") || m.includes("rate limit")) return { what: "Too many requests in a short window.", fix: "Wait a short while and retry." };
  if (m.includes("timeout") || m.includes("did not respond")) return { what: "A third-party service did not respond in time.", fix: "Usually temporary. Retry shortly. If it persists, check PRC or Discord status." };
  if (m.includes("dm blocked") || m.includes("could not open a dm")) return { what: "The Gatherly bot could not DM the user.", fix: "The user must share a server with the bot and allow DMs from server members." };
  if (m.includes("anthropic")) return { what: "The AI service is not configured or failed.", fix: "Set ANTHROPIC_API_KEY in Netlify environment variables." };
  if (m.includes("discord_bot_token") || m.includes("bot not configured")) return { what: "The Discord bot token is missing.", fix: "Set DISCORD_BOT_TOKEN in Netlify environment variables and invite the bot to your server." };
  if (m.includes("stripe")) return { what: "A Stripe operation failed or is misconfigured.", fix: "Check STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in Netlify env vars." };
  if (m.includes("not your event") || m.includes("not found")) return { what: "The target record does not exist or is owned by someone else.", fix: "Refresh the list and try again." };
  if (m.includes("credit")) return { what: "The user does not have enough boost credits.", fix: "Buy more credits on the pricing page or have an admin grant credits." };
  return { what: "An unexpected error occurred.", fix: "Check the Netlify function logs for the full stack trace." };
}

/* =========================================================================
   INPUT HELPERS + CODES
   ========================================================================= */
export const clampStr = (v, max) => String(v ?? "").trim().slice(0, max);
export const id = () => crypto.randomBytes(9).toString("base64url");

const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
function codeBlocks(prefix, blocks, len) {
  const block = () => Array.from({ length: len }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join("");
  return `${prefix}-` + Array.from({ length: blocks }, block).join("-");
}
export const adminCode = () => codeBlocks("GATH", 5, 6);
export const execCode = () => codeBlocks("GEXE", 6, 6);

export const CODE_TTL_MS = 30 * 60 * 1000;
export function hashCode(code) {
  return crypto.createHmac("sha256", secret()).update(`code:${String(code).trim().toUpperCase()}`).digest("base64url");
}
export const codeFingerprint = (code) => `${String(code).slice(0, 4)}-••••-${hashCode(code).slice(0, 4).toUpperCase()}`;

/* =========================================================================
   DISCORD (bot REST) HELPERS
   ========================================================================= */
const DISCORD_API = "https://discord.com/api/v10";

export async function discordBotFetch(path, opts = {}, ms = 8000) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return { ok: false, status: 0, json: async () => ({}) };
  return fetch(`${DISCORD_API}${path}`, { ...opts, headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json", ...(opts.headers || {}) }, signal: AbortSignal.timeout(ms) });
}

export const guildId = () => process.env.GATHERLY_GUILD_ID || null;
export const blacklistRoleId = () => process.env.BLACKLIST_ROLE_ID || BLACKLIST_ROLE_ID_DEFAULT;

export async function isGuildMember(discordId) {
  const gid = guildId();
  if (!gid || !discordId) return null;
  try {
    const r = await discordBotFetch(`/guilds/${gid}/members/${discordId}`);
    if (r.status === 200) return true;
    if (r.status === 404) return false;
    return null;
  } catch { return null; }
}

export async function addGuildRole(discordId, roleId = blacklistRoleId()) {
  const gid = guildId();
  if (!gid || !discordId || !roleId) return false;
  try { return (await discordBotFetch(`/guilds/${gid}/members/${discordId}/roles/${roleId}`, { method: "PUT" })).ok; } catch { return false; }
}

export async function removeGuildRole(discordId, roleId = blacklistRoleId()) {
  const gid = guildId();
  if (!gid || !discordId || !roleId) return false;
  try { return (await discordBotFetch(`/guilds/${gid}/members/${discordId}/roles/${roleId}`, { method: "DELETE" })).ok; } catch { return false; }
}

export async function dmUserEmbed(discordId, embed, components = null) {
  if (!process.env.DISCORD_BOT_TOKEN || !discordId) return { ok: false };
  try {
    const ch = await discordBotFetch("/users/@me/channels", { method: "POST", body: JSON.stringify({ recipient_id: discordId }) });
    if (!ch.ok) return { ok: false };
    const { id: channelId } = await ch.json();
    const body = { embeds: [embed] };
    if (components) body.components = components;
    const r = await discordBotFetch(`/channels/${channelId}/messages`, { method: "POST", body: JSON.stringify(body) });
    return { ok: r.ok, channelId };
  } catch { return { ok: false }; }
}

export async function postDiscordWebhook(webhookUrl, payload) {
  try {
    const r = await fetch(webhookUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(8000) });
    return r.ok;
  } catch { return false; }
}

export const BRAND = {
  color: 0x7fa8ff,
  green: 0x69d99c,
  red: 0xff7a7a,
  yellow: 0xffcf5c,
  logo: process.env.GATHERLY_LOGO_URL || "https://gatherly-events.netlify.app/assets/logo-white.png",
  footer: "Gatherly",
};

/* =========================================================================
   AI HELPERS (Anthropic)
   ========================================================================= */
async function anthropic(messages, { model = "claude-haiku-4-5-20251001", max_tokens = 400, system } = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens, ...(system ? { system } : {}), messages }),
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d.content?.map((c) => c.text || "").join("").trim() || null;
  } catch { return null; }
}

export async function aiText(prompt, opts = {}) { return anthropic([{ role: "user", content: prompt }], opts); }

export async function aiModerateEvent(ev = {}) {
  if (!process.env.ANTHROPIC_API_KEY) return { allowed: true, reason: null, skipped: true };
  const prompt = `You are a strict content moderator for "Gatherly", a public events board for the Roblox game ER:LC (Emergency Response: Liberty County) private-server roleplay community. Decide whether the following event listing may be published.\n\nBLOCK the listing if it contains or implies ANY of: sexual or NSFW content, profanity or slurs, harassment or hate, real-world violence or threats, advertising or content unrelated to ER:LC, scams, or fake / troll events that are not genuine ER:LC roleplay.\nALLOW normal ER:LC roleplay events such as patrols, scenarios, car shows, court sessions, training, tryouts, and similar.\n\nListing:\nTitle: ${clampStr(ev.title, 200)}\nScenario: ${clampStr(ev.scenario, 200)}\nDescription: ${clampStr(ev.description || ev.desc, 1500)}\nServer code: ${clampStr(ev.code, 60)}\n\nReply with ONLY a compact JSON object and nothing else, no markdown:\n{"allowed": true or false, "reason": "short reason shown to the user if blocked, empty string if allowed"}`;
  const out = await anthropic([{ role: "user", content: prompt }], { max_tokens: 200 });
  if (!out) return { allowed: true, reason: null, skipped: true };
  try {
    const parsed = JSON.parse(out.replace(/```json|```/g, "").trim());
    return {
      allowed: Boolean(parsed.allowed),
      reason: parsed.allowed ? null : clampStr(parsed.reason || "This listing did not pass automated review.", 300),
      skipped: false,
    };
  } catch { return { allowed: true, reason: null, skipped: true }; }
}

/* =========================================================================
   STRIPE WEBHOOK SIGNATURE VERIFICATION
   ========================================================================= */
export function verifyStripeSignature(rawBody, sigHeader, webhookSecret, toleranceSec = 300) {
  if (!sigHeader || !webhookSecret) return false;
  const parts = Object.fromEntries(sigHeader.split(",").map((kv) => kv.split("=").map((s) => s.trim())));
  const t = parts.t, v1 = parts.v1;
  if (!t || !v1) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(t)) > toleranceSec) return false;
  const expected = crypto.createHmac("sha256", webhookSecret).update(`${t}.${rawBody}`).digest("hex");
  try { return crypto.timingSafeEqual(Buffer.from(v1, "utf8"), Buffer.from(expected, "utf8")); } catch { return false; }
}

/* =========================================================================
   BLOB-BACKED CACHE
   ========================================================================= */
export async function cacheGet(key) {
  try {
    const rec = await miscStore().get(`cache_${key}`, { type: "json" });
    if (!rec) return null;
    if (rec.exp && rec.exp < Date.now()) return null;
    return rec.val;
  } catch { return null; }
}
export async function cacheSet(key, val, ttlSec = 30) {
  try { await miscStore().setJSON(`cache_${key}`, { val, exp: Date.now() + ttlSec * 1000 }); } catch {}
}

/* =========================================================================
   PLANS / CREDITS / SUBSCRIPTION LIFECYCLE
   ========================================================================= */
export const PLAN_INFO = {
  free:  { id: "free",  name: "Gatherly",       level: 0, monthlyCredits: 0,                    eventCap: EVENT_CAP_FREE  },
  pro:   { id: "pro",   name: "Gatherly Pro",   level: 1, monthlyCredits: PRO_MONTHLY_CREDITS,  eventCap: EVENT_CAP_PRO   },
  ultra: { id: "ultra", name: "Gatherly Ultra", level: 2, monthlyCredits: ULTRA_MONTHLY_CREDITS, eventCap: EVENT_CAP_ULTRA },
};
for (const k of Object.keys(PLAN_INFO)) PLAN_INFO[k].weeklyCredits = PLAN_INFO[k].monthlyCredits;

export function normalizePlan(plan) {
  const map = { patrol: "free", sergeant: "pro", commander: "ultra", network: "ultra" };
  const p = map[plan] || plan || "free";
  return PLAN_INFO[p] ? p : "free";
}

export const planLevel = (plan) => PLAN_INFO[normalizePlan(plan)].level;
export const planName = (plan) => PLAN_INFO[normalizePlan(plan)].name;
export const planCap = (plan) => PLAN_INFO[normalizePlan(plan)].eventCap;

export function effectiveListingCap(user) {
  const base = planCap(effectivePlan(user));
  const o = Number(user?.listingCapOverride);
  return Number.isFinite(o) && o >= 0 ? Math.floor(o) : base;
}

export const monthKey = (d = new Date()) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

export function subscriptionActive(user) {
  if (!user) return false;
  if (user.lifetime || user.planVia === "lifetime") return normalizePlan(user.plan) !== "free";
  if (normalizePlan(user.plan) === "free") return false;
  if (!user.planExpiresAt) return true;
  return new Date(user.planExpiresAt).getTime() > Date.now();
}

export function effectivePlan(user) { return subscriptionActive(user) ? normalizePlan(user.plan) : "free"; }
export const effectiveLevel = (user) => PLAN_INFO[effectivePlan(user)].level;

export function monthlyResetIfDue(user) {
  if (!user) return { user, changed: false };
  const mk = monthKey();
  if (user.creditsPeriod === mk) return { user, changed: false };
  if (subscriptionActive(user)) {
    const grant = PLAN_INFO[normalizePlan(user.plan)].monthlyCredits;
    return { user: { ...user, credits: grant, creditsPeriod: mk }, changed: true };
  }
  return { user: { ...user, creditsPeriod: mk }, changed: true };
}

export const canCreateEvent = (user, usedThisMonth) => usedThisMonth < planCap(effectivePlan(user));

export const isSupportBlacklisted = (u) => Boolean(u && u.supportBlacklist && u.supportBlacklist.active);

/* =========================================================================
   ADVERTISING
   ========================================================================= */
export const AD_PACKS = {
  3:  { days: 3,  amount: 500,  label: "3-day placement"  },
  7:  { days: 7,  amount: 1000, label: "7-day placement"  },
  14: { days: 14, amount: 1800, label: "14-day placement" },
};
export const TOTAL_AD_SLOTS = 12;

export const DEFAULT_AD_CONFIG = { rotateSec: 8, houseWeight: 4, advertiserWeight: 1, slots: TOTAL_AD_SLOTS };
export async function getAdConfig() {
  const c = (await miscStore().get("adConfig", { type: "json" })) || {};
  return { ...DEFAULT_AD_CONFIG, ...c };
}

const SUSPICIOUS_TLDS = [".zip", ".mov", ".xyz", ".top", ".gq", ".tk", ".ml", ".cf", ".ru", ".click", ".country", ".kim", ".work"];
const URL_SHORTENERS = ["bit.ly", "tinyurl.com", "goo.gl", "t.co", "is.gd", "cutt.ly", "rb.gy", "shorturl", "rebrand.ly", "ow.ly", "discord.gg/"];
const BANNED_WORDS = ["free robux", "free nitro", "giveaway scam", "login to claim", "steam gift", "crypto", "casino", "porn", "nsfw", "nude"];

export function scanAdSafety({ link = "", title = "", image = "" } = {}) {
  const reasons = [];
  let url;
  try { url = new URL(link); } catch { return { ok: false, flagged: true, reasons: ["The destination link is not a valid URL."] }; }
  if (!/^https?:$/.test(url.protocol)) reasons.push("Link is not http(s).");
  const host = url.hostname.toLowerCase();
  if (SUSPICIOUS_TLDS.some((t) => host.endsWith(t))) reasons.push(`Destination uses a high-risk TLD (${host}).`);
  if (URL_SHORTENERS.some((s) => link.toLowerCase().includes(s))) reasons.push("Link uses a redirect/shortener that hides the real destination.");
  if (image && !/^https?:\/\//i.test(image)) reasons.push("Creative image is not an http(s) URL.");
  const hay = `${title} ${link}`.toLowerCase();
  for (const w of BANNED_WORDS) if (hay.includes(w)) reasons.push(`Contains flagged term: "${w}".`);
  if (/@/.test(url.pathname + url.search)) reasons.push("Link contains an '@' which can disguise the true host.");
  return { ok: reasons.length === 0, flagged: reasons.length > 0, reasons };
}

export async function aiModerateAd(ad = {}) {
  if (!process.env.ANTHROPIC_API_KEY) return { allowed: true, reason: null, skipped: true };
  const prompt = `You are a strict ad reviewer for "Gatherly", a public board for the Roblox game ER:LC. Decide if this paid advertisement may run.\nBLOCK if it contains or implies: scams, phishing, "free robux/nitro", malware, NSFW, hate/harassment, real-world violence, deceptive claims, or links that clearly do not match the advertised text.\nALLOW normal promotion of ER:LC servers, Discord communities, creators, and game-related products.\nTitle: ${clampStr(ad.title, 200)}\nDestination link: ${clampStr(ad.link, 300)}\nReply with ONLY compact JSON: {"allowed": true/false, "reason": "short reason if blocked, else empty"}`;
  const out = await anthropic([{ role: "user", content: prompt }], { max_tokens: 160 });
  if (!out) return { allowed: true, reason: null, skipped: true };
  try {
    const p = JSON.parse(out.replace(/```json|```/g, "").trim());
    return { allowed: Boolean(p.allowed), reason: p.allowed ? null : clampStr(p.reason || "Did not pass automated review.", 300), skipped: false };
  } catch { return { allowed: true, reason: null, skipped: true }; }
}

/* =========================================================================
   STAFF EVENT WEBHOOK
   ========================================================================= */
export function brandEmbed({ title, description, color = BRAND.color, fields = [], url, thumbnail, footer = "Gatherly Automation" } = {}) {
  const e = { title, description, color, timestamp: new Date().toISOString(), footer: { text: footer, icon_url: BRAND.logo } };
  if (url) e.url = url;
  if (fields.length) e.fields = fields.slice(0, 25);
  if (thumbnail) e.thumbnail = { url: thumbnail };
  return e;
}

export async function postStaffEvent(embed, links = []) {
  const url = process.env.STAFF_WEBHOOK_URL || process.env.WATCHDOG_WEBHOOK_URL;
  if (!url) return false;
  const e = { ...embed };
  if (links.length) {
    e.fields = [...(e.fields || []), { name: "Open", value: links.map((b) => `[${b.label}](${b.url})`).join(" · ").slice(0, 1000), inline: false }];
  }
  return postDiscordWebhook(url, { username: "Gatherly", avatar_url: BRAND.logo, embeds: [e] });
}
