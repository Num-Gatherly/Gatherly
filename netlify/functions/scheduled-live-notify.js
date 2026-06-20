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
    const boosted = events.filter((ev) => ev.boosted);
    const due = events.filter((ev) => {
      if (!ev.boosted) return false;
      if (ev.liveNotifiedAt) return false;
      const startMs = new Date(ev.startsAt).getTime();
      if (!Number.isFinite(startMs)) return false;
      return startMs <= now && now - startMs <= WINDOW_MS;
    });

    console.log(`[liveNotify] sweep: ${events.length} total events, ${boosted.length} boosted, ${due.length} due this run.`);
    if (boosted.length && !due.length) {
      // Helps tell "nothing boosted" apart from "boosted but not in window /
      // already notified", which look identical from the outside otherwise.
      boosted.forEach((ev) => {
        const startMs = new Date(ev.startsAt).getTime();
        console.log(`[liveNotify] boosted event ${ev.id} not due: liveNotifiedAt=${ev.liveNotifiedAt || "none"}, startsAt=${ev.startsAt}, msSinceStart=${now - startMs}`);
      });
    }

    let sent = 0, skipped = 0, failed = 0;
    for (const ev of due) {
      const host = await hostFor(ev);
      console.log(`[liveNotify] processing event ${ev.id}, host=${host?.username || ev.userId}, plan=${host?.plan}, boosted=${ev.boosted}`);
      if (!eligibleForLiveNotify(ev, host)) {
        // Mark as handled either way so a free/pro host's boosted event
        // (e.g. downgraded after boosting) doesn't get re-checked forever.
        ev.liveNotifiedAt = new Date().toISOString();
        ev.liveNotifySkippedReason = "not-ultra-or-not-boosted";
        await store.setJSON(ev.id, ev);
        console.log(`[liveNotify] skipped event ${ev.id}: not eligible (host plan or boosted flag).`);
        skipped++;
        continue;
      }
      const r = await sendLiveNotify(ev, host);
      ev.liveNotifiedAt = new Date().toISOString();
      ev.liveNotifyOk = r.ok;
      if (r.ok && r.messageId) ev.liveCardMessageId = r.messageId;
      if (!r.ok) { ev.liveNotifyFailReason = r.reason; ev.liveNotifyFailDetail = r.detail || null; }
      await store.setJSON(ev.id, ev);
      console.log(`[liveNotify] event ${ev.id} send result: ok=${r.ok}${r.ok ? "" : `, reason=${r.reason}, detail=${r.detail || "n/a"}`}`);
      if (r.ok) sent++; else failed++;
    }

    if (sent || failed) {
      await audit(null, "event.live-notify-sweep", { sent, failed, skipped, checked: due.length });
    }
    console.log(`[liveNotify] sweep complete: sent=${sent}, failed=${failed}, skipped=${skipped}.`);
    return new Response(JSON.stringify({ ok: true, sent, failed, skipped }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.log(`[liveNotify] sweep crashed: ${e?.message || e}`);
    try { await auditError(null, "event.live-notify-crash", e?.message || "unknown"); } catch {}
    return new Response(JSON.stringify({ ok: false, error: e?.message || "unknown" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};

// Every minute.
export const config = { schedule: "* * * * *" };
