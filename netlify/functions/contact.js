// /api/contact - stores support messages, optionally forwards to a Discord webhook.
// Optional env var: CONTACT_DISCORD_WEBHOOK
import { json, miscStore, id, postDiscordWebhook, rateLimit, clientIp, clampStr } from "../lib/util.js";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "POST only." }, 405);
  const b = await req.json().catch(() => ({}));

  // Honeypot: bots fill it, people never see it.
  if (b.website) return json({ ok: true });

  if (!(await rateLimit(`contact:${clientIp(req)}`, 5, 3600))) {
    return json({ error: "Too many messages from this connection. Try again later." }, 429);
  }
  if (!b.from || !b.body) return json({ error: "Your Discord username and a message are required." }, 400);

  const msg = {
    id: id(),
    from: clampStr(b.from, 60),
    topic: clampStr(b.topic || "Other", 60),
    body: clampStr(b.body, 1500),
    at: new Date().toISOString(),
  };
  await miscStore().setJSON(`contact_${msg.id}`, msg);

  if (process.env.CONTACT_DISCORD_WEBHOOK) {
    await postDiscordWebhook(process.env.CONTACT_DISCORD_WEBHOOK, {
      username: "Gatherly Support",
      embeds: [{
        title: `Support: ${msg.topic}`,
        description: msg.body,
        color: 0x7fa8ff,
        fields: [{ name: "Discord", value: msg.from, inline: true }],
        timestamp: msg.at,
      }],
    });
  }
  return json({ ok: true });
};
