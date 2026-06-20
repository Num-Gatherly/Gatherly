// netlify/functions/scheduled-live-notify.js
// Runs every minute. Finds boosted, Ultra-plan events whose start time has
// just passed and that have not been announced yet, sends the Discord live
// notification for each, then marks them so this never double-fires.
//
// Netlify Scheduled Functions: the `config.schedule` export below is what
// registers the cron, no netlify.toml change needed.
import { eventsStore, audit, auditError } from "../lib/util.js";
import { eligibleForLiveNotify, sendLiveNotify, hostFor } from "../lib/liveNotify.js";

// Only look at events that started within this window. Wide enough to
// survive a missed minute or two of cold starts, narrow enough that a long-
// dead event never suddenly announces itself after a deploy gap.
const WINDOW_MS = 5 * 60 * 1000;

export default async () => {
  try {
    const store = eventsStore();
    const { blobs } = await store.list();
    const events = (await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })))).filter(Boolean);

    const now = Date.now();
    const due = events.filter((ev) => {
      if (!ev.boosted) return false;
      if (ev.liveNotifiedAt) return false;
      const startMs = new Date(ev.startsAt).getTime();
      if (!Number.isFinite(startMs)) return false;
      return startMs <= now && now - startMs <= WINDOW_MS;
    });

    let sent = 0, skipped = 0, failed = 0;
    for (const ev of due) {
      const host = await hostFor(ev);
      if (!eligibleForLiveNotify(ev, host)) {
        // Mark as handled either way so a free/pro host's boosted event
        // (e.g. downgraded after boosting) doesn't get re-checked forever.
        ev.liveNotifiedAt = new Date().toISOString();
        ev.liveNotifySkippedReason = "not-ultra-or-not-boosted";
        await store.setJSON(ev.id, ev);
        skipped++;
        continue;
      }
      const r = await sendLiveNotify(ev, host);
      ev.liveNotifiedAt = new Date().toISOString();
      ev.liveNotifyOk = r.ok;
      if (!r.ok) ev.liveNotifyFailReason = r.reason;
      await store.setJSON(ev.id, ev);
      if (r.ok) sent++; else failed++;
    }

    if (sent || failed) {
      await audit(null, "event.live-notify-sweep", { sent, failed, skipped, checked: due.length });
    }
    return new Response(JSON.stringify({ ok: true, sent, failed, skipped }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    try { await auditError(null, "event.live-notify-crash", e?.message || "unknown"); } catch {}
    return new Response(JSON.stringify({ ok: false, error: e?.message || "unknown" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};

// Every minute.
export const config = { schedule: "* * * * *" };
