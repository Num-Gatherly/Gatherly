// AI chat endpoint for the ERLC report analyst.
// Accepts POST { message, history, reportContext } — responds with { reply }.
// The assistant is constrained to only discuss ERLC-related report data.
import { json, requireUser } from "../lib/util.js";

export const config = { path: "/api/chat" };

const SYSTEM = `You are an expert ERLC (Emergency Response: Liberty County) analytics assistant for the Gatherly platform. You help server hosts understand and improve their event performance based on their specific report data.

Rules:
- Only discuss topics related to the provided ERLC report data and ER:LC server hosting strategy.
- If asked about anything unrelated to ERLC or the report, politely redirect to the report.
- Be concise, data-driven, and actionable. Reference specific numbers from the report.
- Use plain English — no em dashes, no fluff, no greetings.
- Maximum 3-4 sentences per reply unless a detailed breakdown is genuinely useful.
- Tone: sharp analyst, not a chatbot.`;

async function anthropicChat(messages, systemPrompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system: systemPrompt,
      messages,
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API error ${res.status}`);
  const data = await res.json();
  return data.content?.[0]?.text || null;
}

export default async function handler(req) {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let user;
  try { user = await requireUser(req); } catch { return json({ error: "Unauthorized" }, 401); }

  let body;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const { message, history = [], reportContext } = body;
  if (!message || typeof message !== "string" || message.length > 1000) {
    return json({ error: "Invalid message" }, 400);
  }

  // Build a compact context string from the report so the model is grounded.
  const ctx = reportContext ? buildContextString(reportContext) : "";
  const systemWithCtx = ctx ? `${SYSTEM}\n\nREPORT DATA:\n${ctx}` : SYSTEM;

  // Sanitise history: only allow user/assistant roles, max 8 turns, max 500 chars each.
  const safeHistory = (Array.isArray(history) ? history : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-8)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, 500) }));

  // Append the latest user message.
  const messages = [...safeHistory, { role: "user", content: message.slice(0, 1000) }];

  try {
    const reply = await anthropicChat(messages, systemWithCtx);
    return json({ reply: reply || "No response generated." });
  } catch (err) {
    console.error("Chat error:", err);
    return json({ reply: "The AI analyst is temporarily unavailable. All your report data is still accurate above." });
  }
}

function buildContextString(r) {
  const lines = [
    `Event: ${r.eventTitle || "Unknown"} | Server: ${r.serverName || "Unknown"} | Scenario: ${r.scenario || "Unknown"}`,
    `Health score: ${r.score ?? "N/A"}/100 | Momentum: ${r.momentum?.direction || "N/A"} ${r.momentum?.changePct ? `(${r.momentum.changePct}%)` : ""}`,
    `Joins: ${r.joinsInWindow ?? "N/A"} | Unique players: ${r.uniquePlayers ?? "N/A"} | Peak concurrent: ${r.peakConcurrent ?? "N/A"}/${r.maxPlayers ?? "N/A"}`,
    `Avg session: ${r.avgSessionMin ?? "N/A"}m | Retained 30m+: ${r.retained30 ?? "N/A"} | Conversion: ${r.conversionPct ?? "N/A"}%`,
    `Staff online: ${r.staffOnline ?? r.staff?.online?.length ?? "N/A"} | Mod calls: ${r.modCalls ?? r.staff?.modCalls ?? "N/A"} | Kills: ${r.staff?.kills ?? r.kills ?? "N/A"}`,
    `Avg mod response: ${r.staff?.estimatedResponseMin ?? "N/A"}m`,
  ];
  if (r.funnel) lines.push(`Funnel — views: ${r.funnel.views}, reveals: ${r.funnel.reveals}, entries: ${r.funnel.entries}, retained: ${r.funnel.retained30}`);
  if (r.benchmark) lines.push(`Benchmark — peak percentile: ${r.benchmark.peakPercentile}th, session percentile: ${r.benchmark.sessionPercentile}th, platform avg session: ${r.benchmark.platformAvgSessionMin}m`);
  if (r.forecast) lines.push(`Forecast — projected joins: ${r.forecast.projectedJoins?.join("-")}, projected peak: ${r.forecast.projectedPeak?.join("-")}, confidence: ${r.forecast.confidence}`);
  if (r.staff?.leaderboard?.length) lines.push(`Top staff: ${r.staff.leaderboard.slice(0, 3).map((s) => `${s.name} (${s.moderations ?? s.commands} cmds)`).join(", ")}`);
  if (r.villainDetection?.disruptors?.length) lines.push(`Disruptors: ${r.villainDetection.disruptors.map((d) => `${d.player} (${d.timesKilled}x killed, actioned: ${d.staffActed})`).join(", ")}`);
  if (r.ghostStaff?.ghosts?.length) lines.push(`Ghost staff: ${r.ghostStaff.ghosts.map((g) => g.name).join(", ")}`);
  if (r.goldenHour) lines.push(`Golden hour: min ${r.goldenHour.bestWindowStart}-${r.goldenHour.bestWindowEnd}, ${r.goldenHour.retentionRate}% retention`);
  if (r.healthTrend) lines.push(`Health trend (last 6 events): ${r.healthTrend.scores?.join(", ")} — ${r.healthTrend.trend}`);
  if (r.aiSummary) lines.push(`AI summary: ${r.aiSummary}`);
  return lines.join("\n");
}
