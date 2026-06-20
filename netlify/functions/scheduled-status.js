// netlify/functions/scheduled-status.js
// Runs every minute. Re-checks ER:LC, the Gatherly website, and Netlify's
// own incident feed, then edits the single live status message in channel
// 1515875341737136168 in place (creates it once on the very first run).
//
// Netlify's scheduler has a 1-minute floor, there is no 10-second tier on
// this platform, so this is the fastest honest cadence available without
// resorting to a sleep-loop hack inside a single invocation.
import { auditError } from "../lib/util.js";
import { upsertStatusMessage, recordStatusRun } from "../lib/statusPage.js";

export default async () => {
  try {
    const result = await upsertStatusMessage();
    console.log(`[statusPage] ${result.ok ? `${result.action} message` : `failed: ${result.reason}`}${result.ok ? `, erlc=${result.checks.erlc.up}, website=${result.checks.website.up}, netlify=${result.checks.netlify.up}` : result.detail ? `, detail=${result.detail.slice(0, 300)}` : ""}`);
    await recordStatusRun(result);
    return new Response(JSON.stringify(result.ok ? { ok: true, action: result.action } : { ok: false, reason: result.reason }), {
      status: result.ok ? 200 : 500,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.log(`[statusPage] sweep crashed: ${e?.message || e}`);
    try { await auditError(null, "status.crash", e?.message || "unknown"); } catch {}
    return new Response(JSON.stringify({ ok: false, error: e?.message || "unknown" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};

// Every minute, the platform floor.
export const config = { schedule: "* * * * *" };
