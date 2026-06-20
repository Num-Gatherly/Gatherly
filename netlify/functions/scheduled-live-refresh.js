// netlify/functions/scheduled-live-refresh.js
// Runs every minute. For every boosted Ultra event that already has a live
// Discord card posted (liveCardMessageId set) and is still within its live
// window, re-fetches the in-server player count and edits the card in
// place, since a Discord button's label can't update itself, the count has
// to be re-sent.
import { eventsStore, audit, auditError } from "../lib/util.js";
import { refreshLiveNotify, hostFor } from "../lib/liveNotify.js";

const endMs = (ev) => new Date(ev.startsAt).getTime() + (ev.durationMin || 60) * 60000;
const isLiveNow = (ev) => {
  const startMs = new Date(ev.startsAt).getTime();
  if (!Number.isFinite(startMs)) return false;
  const now = Date.now();
  return now >= startMs && now <= endMs(ev);
};

export default async () => {
  try {
    const store = eventsStore();
    const { blobs } = await store.list();
    const events = (await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })))).filter(Boolean);

    const due = events.filter((ev) => ev.boosted && ev.liveCardMessageId && isLiveNow(ev));
    console.log(`[liveRefresh] sweep: ${events.length} total events, ${due.length} cards to refresh this run.`);

    let updated = 0, failed = 0;
    for (const ev of due) {
      const host = await hostFor(ev);
      const r = await refreshLiveNotify(ev, host);
      if (r.ok) { updated++; }
      else {
        failed++;
        console.log(`[liveRefresh] event ${ev.id} refresh failed: reason=${r.reason}, detail=${r.detail || "n/a"}`);
      }
    }

    if (failed) await audit(null, "event.live-refresh-sweep", { updated, failed, checked: due.length });
    console.log(`[liveRefresh] sweep complete: updated=${updated}, failed=${failed}.`);
    return new Response(JSON.stringify({ ok: true, updated, failed }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.log(`[liveRefresh] sweep crashed: ${e?.message || e}`);
    try { await auditError(null, "event.live-refresh-crash", e?.message || "unknown"); } catch {}
    return new Response(JSON.stringify({ ok: false, error: e?.message || "unknown" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};

// Every minute, the platform floor.
export const config = { schedule: "* * * * *" };
