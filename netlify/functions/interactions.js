// /api/interactions - Discord Interactions endpoint.
//
// This is what makes the DM two-way: the bot's DM has a Reply button that opens a
// text box (modal); the submitted text is relayed back to staff here. It also powers
// the Claim / Unclaim / Close / Escalate buttons on the support-channel card.
//
// SETUP (one time): in the Discord Developer Portal -> your app -> General Information,
// copy the Public Key into a Netlify env var DISCORD_PUBLIC_KEY. Then under that app,
// set "Interactions Endpoint URL" to https://gatherly-events.netlify.app/api/interactions
// (Discord will send a test PING which this handler answers).
import crypto from "node:crypto";
import { json } from "../lib/util.js";
import {
  getTicket, saveTicket, appendMessage, refreshChannelCard, postChannelNote,
  dmResolved, discordUserIsStaff,
} from "../lib/support.js";

// Interaction + response type constants.
const T = { PING: 1, COMPONENT: 3, MODAL_SUBMIT: 5 };
const R = { PONG: 1, MESSAGE: 4, MODAL: 9 };
const EPHEMERAL = 64;

function ed25519Key(hex) {
  const der = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(hex, "hex")]);
  return crypto.createPublicKey({ key: der, format: "der", type: "spki" });
}
function verifySignature(sig, ts, rawBody, pubHex) {
  try { return crypto.verify(null, Buffer.from(ts + rawBody), ed25519Key(pubHex), Buffer.from(sig, "hex")); }
  catch { return false; }
}

const reply = (content, ephemeral = false) => json({ type: R.MESSAGE, data: { content, ...(ephemeral ? { flags: EPHEMERAL } : {}) } });

export default async (req) => {
  if (req.method !== "POST") return json({ error: "POST only." }, 405);

  const raw = await req.text();
  const sig = req.headers.get("x-signature-ed25519");
  const ts = req.headers.get("x-signature-timestamp");
  const pub = process.env.DISCORD_PUBLIC_KEY;
  if (!pub) return json({ error: "Interactions not configured (DISCORD_PUBLIC_KEY missing)." }, 500);
  if (!sig || !ts || !verifySignature(sig, ts, raw, pub)) return json({ error: "bad signature" }, 401);

  let i;
  try { i = JSON.parse(raw); } catch { return json({ error: "bad json" }, 400); }

  if (i.type === T.PING) return json({ type: R.PONG });

  try {
    if (i.type === T.COMPONENT) return await onComponent(i);
    if (i.type === T.MODAL_SUBMIT) return await onModal(i);
  } catch {
    return reply("Something went wrong handling that. Please try again shortly.", true);
  }
  return json({ type: R.PONG });
};

function parseId(customId) {
  const parts = String(customId || "").split(":"); // tkt:<kind>:<ticketId>
  return { kind: parts[1] || "", ticketId: parts.slice(2).join(":") };
}
const actorDiscordId = (i) => i.member?.user?.id || i.user?.id || null;
const inGuild = (i) => Boolean(i.member); // channel context = staff; DM = opener

async function onComponent(i) {
  const { kind, ticketId } = parseId(i.data?.custom_id);
  const t = await getTicket(ticketId);
  if (!t) return reply("That ticket no longer exists.", inGuild(i));
  const who = actorDiscordId(i);

  // ----- opener actions (in DM) -----
  if (!inGuild(i)) {
    if (who !== t.discordId) return reply("This ticket is not yours.", false);
    if (kind === "reply") {
      return json({ type: R.MODAL, data: {
        custom_id: `tkt:modal:${t.id}`,
        title: "Reply to Gatherly Support",
        components: [{ type: 1, components: [{ type: 4, custom_id: "msg", label: "Your message", style: 2, min_length: 1, max_length: 2000, required: true, placeholder: "Type your reply to the support team" }] }],
      } });
    }
    if (kind === "esc") {
      t.escalated = true; t.escalatedAt = new Date().toISOString(); t.updatedAt = t.escalatedAt;
      await saveTicket(t);
      await postChannelNote(t, "> The user marked this ticket **high urgency**.");
      await refreshChannelCard(t);
      return reply("Marked as high urgency. A member of our team will prioritise this. Please be patient.", false);
    }
    return reply("Unknown action.", false);
  }

  // ----- staff actions (in the support channel) -----
  if (!(await discordUserIsStaff(who))) return reply("Staff only.", true);

  if (kind === "claim") {
    t.assignedTo = `dsc_${who}`; t.assignedToName = i.member.user.global_name || i.member.user.username; t.updatedAt = new Date().toISOString();
    await saveTicket(t); await refreshChannelCard(t);
    return reply("You claimed this ticket.", true);
  }
  if (kind === "unclaim") {
    t.assignedTo = null; t.assignedToName = null; t.updatedAt = new Date().toISOString();
    await saveTicket(t); await refreshChannelCard(t);
    return reply("Ticket unclaimed.", true);
  }
  if (kind === "esc") {
    t.escalated = true; t.escalatedAt = new Date().toISOString(); t.updatedAt = t.escalatedAt;
    await saveTicket(t); await refreshChannelCard(t);
    return reply("Ticket escalated.", true);
  }
  if (kind === "close") {
    t.status = "closed"; t.updatedAt = new Date().toISOString();
    await saveTicket(t); await refreshChannelCard(t);
    await dmResolved(t);
    return reply("Ticket closed and the user has been notified.", true);
  }
  return reply("Unknown action.", true);
}

async function onModal(i) {
  const { ticketId } = parseId(i.data?.custom_id);
  const t = await getTicket(ticketId);
  if (!t) return reply("That ticket no longer exists.", false);
  if (actorDiscordId(i) !== t.discordId) return reply("This ticket is not yours.", false);

  const text = i.data?.components?.[0]?.components?.[0]?.value || "";
  if (!text.trim()) return reply("Your reply was empty.", false);
  if (t.status === "closed") return reply("This ticket is closed. Please open a new request from the Gatherly website.", false);

  appendMessage(t, "user", text);
  await saveTicket(t);
  await postChannelNote(t, `> New reply from the user:\n${text.slice(0, 800)}`);
  await refreshChannelCard(t);
  return reply("Sent to the team. A member of our staff will respond. Please be patient and avoid sending repeated messages.", false);
}
