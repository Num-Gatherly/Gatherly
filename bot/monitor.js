// bot/monitor.js
import { config } from "./config.js";

const COMPLAINT_PATTERNS = [
  /bot.*down/i, /website.*down/i, /not.*working/i, /broken/i,
  /issue.*with/i, /problem.*with/i, /can'?t.*access/i,
  /gatherly.*down/i, /gatherly.*broken/i, /bot.*offline/i,
  /site.*down/i, /error.*gatherly/i, /gatherly.*error/i,
  /not.*loading/i, /won'?t.*load/i, /gatherly.*not.*respond/i,
];

function looksLikeComplaint(text) {
  return COMPLAINT_PATTERNS.some(p => p.test(text));
}

async function getStatusSummary() {
  try {
    const r = await fetch("https://gatherly-erlc.xyz/api/scheduled-status", {
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) return await r.json();
  } catch {}
  return null;
}

async function askClaude(userMessage, statusSummary) {
  const key = config.anthropicKey;
  if (!key) return null;

  const statusContext = statusSummary
    ? `Current system status: ${JSON.stringify(statusSummary)}`
    : "Current system status: unknown (could not reach status endpoint).";

  const prompt = `You are the Gatherly automated support assistant. A user in a Discord server sent this message:\n\n"${userMessage}"\n\n${statusContext}\n\nDetermine if they are reporting an issue with the Gatherly bot or website. If they are, briefly confirm or deny the issue based on the status data (2-3 sentences max), then always tell them to open a ticket in <#${config.supportChannelId}>.\n\nIf the message is NOT about a Gatherly issue, reply with exactly: NOT_COMPLAINT\n\nRespond naturally and concisely.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.content?.[0]?.text || null;
  } catch { return null; }
}

export async function monitorMessage(message) {
  if (!looksLikeComplaint(message.content)) return;

  const status = await getStatusSummary();
  const reply = await askClaude(message.content, status);

  if (!reply || reply.trim() === "NOT_COMPLAINT") return;

  await message.reply({ content: reply, allowedMentions: { repliedUser: false } });
}
