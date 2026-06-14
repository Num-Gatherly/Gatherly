import { boot, api, esc, currentUser } from "/js/app.js";
boot("/advertise");

const $ = (id) => document.getElementById(id);
let bannerId = null;

let me = null;
api("/api/auth?action=me").then((d) => {
  me = d.user;
  if (!me) { $("gate").hidden = false; $("formCard").hidden = true; return; }
  const credits = me.credits ?? 0;
  $("boostRow").innerHTML = `
    <label class="field" style="display:flex;align-items:flex-start;gap:10px;font-weight:500;background:rgba(255,80,80,0.05);border:1px solid rgba(255,80,80,0.2);border-radius:10px;padding:12px 14px">
      <input type="checkbox" id="boost" style="width:auto;margin:3px 0 0" ${credits < 1 ? "disabled" : ""}>
      <span>
        <span style="color:#ff8080;font-weight:700">Boost this event &middot; 1 credit</span>
        <small style="display:block;color:var(--muted);margin-top:3px">Pins it to the top of discovery with a red highlight for the full duration. When it ends it archives below active events and the highlight is removed. You have <b style="color:var(--text)">${credits}</b> credit${credits === 1 ? "" : "s"}.${credits < 1 ? ` <a href="/pricing">Get credits</a>` : ""}</small>
      </span>
    </label>`;
  renderQuota();
}).catch(() => { $("gate").hidden = false; $("formCard").hidden = true; });

async function renderQuota() {
  try {
    const q = await api("/api/events?action=quota");
    let note = document.getElementById("quotaNote");
    if (!note) {
      note = document.createElement("div");
      note.id = "quotaNote";
      note.style.cssText = "margin:0 0 14px;padding:10px 14px;border-radius:10px;border:1px solid var(--line);font-size:.88rem";
      $("formCard").insertBefore(note, $("formCard").firstChild.nextSibling);
    }
    const low = q.remaining <= 0;
    note.style.background = low ? "rgba(255,80,80,.06)" : "rgba(127,168,255,.06)";
    note.style.borderColor = low ? "rgba(255,80,80,.3)" : "var(--line)";
    note.innerHTML = low
      ? `You've used all <b>${q.cap}</b> of your monthly listings on <b>${esc(q.planName)}</b>. <a href="/pricing">Upgrade</a> for more, or wait until next month.`
      : `<b>${q.used}</b> of <b>${q.cap}</b> monthly listings used on ${esc(q.planName)}. <b>${q.remaining}</b> left this month.`;
    if (low && $("publish")) { $("publish").disabled = true; }
  } catch {}
}

function preview() {
  const s = $("startsAt").value;
  if (!s) return;
  const end = new Date(new Date(s).getTime() + Number($("durationMin").value) * 60000);
  $("endPreview").textContent = `Ends ${end.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })} - the listing leaves the feed at that moment.`;
}
$("startsAt").addEventListener("input", preview);
$("durationMin").addEventListener("change", preview);

const dz = $("dz"), input = $("dzInput");
dz.addEventListener("click", () => input.click());
dz.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") input.click(); });
["dragover", "dragenter"].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.add("drag"); }));
["dragleave", "drop"].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.remove("drag"); }));
dz.addEventListener("drop", (e) => handle(e.dataTransfer.files[0]));
input.addEventListener("change", () => handle(input.files[0]));

function say(text, ok = false) {
  $("msg").innerHTML = `<div class="alert ${ok ? "alert-ok" : "alert-err"}">${ok ? text : esc(text)}</div>`;
  $("msg").scrollIntoView({ behavior: "smooth", block: "center" });
}

async function handle(file) {
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) return say("Banner must be under 2MB.");
  const okDims = await new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img.naturalWidth === 1200 && img.naturalHeight === 480);
    img.onerror = () => res(false);
    img.src = URL.createObjectURL(file);
  });
  if (!okDims) return say("Banner must be exactly 1200x480px. Resize it and try again.");
  $("dzText").textContent = "Uploading…";
  try {
    const r = await fetch("/api/image", { method: "POST", body: file, credentials: "same-origin" });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Upload failed.");
    bannerId = d.id;
    dz.innerHTML = `<span>Banner attached - click to replace</span><img src="${d.url}" alt="Banner preview">`;
    dz.appendChild(input);
  } catch (e) {
    $("dzText").textContent = "Drag a 1200x480 banner here, or click to choose a file";
    say(e.message);
  }
}

$("publish").addEventListener("click", async () => {
  $("publish").disabled = true;
  say("Gatherly is scanning your event, please be patient&hellip;", true);
  try {
    const startsAt = $("startsAt").value;
    const wantsBoost = $("boost") ? $("boost").checked : false;
    const d = await api("/api/events?action=create", {
      method: "POST",
      body: {
        title: $("title").value, scenario: $("scenario").value, description: $("description").value,
        startsAt: startsAt ? new Date(startsAt).toISOString() : "",
        durationMin: Number($("durationMin").value),
        joinCode: $("joinCode").value, bannerId,
        reportRecipientId: $("reportRecipientId").value,
        boost: wantsBoost, website: $("website").value,
      },
    });
    if (d.blocked) {
      say(`Gatherly's review blocked this listing: ${esc(d.reason)} No credit was used. If you believe this is a mistake, <a href="/contact">open a support ticket</a>.`, false);
      $("publish").disabled = false;
      return;
    }
    await rocketLaunch();
    say(`Published${d.boosted ? " and boosted" : ""}. Your listing is live in the <a href="/events">discovery feed</a>${d.boosted ? " with a featured red highlight" : ""}, and your report will be ready in the <a href="/dashboard">dashboard</a> when it ends.`, true);
    renderQuota();
  } catch (e) {
    if (/monthly listings/i.test(e.message || "")) say(`${esc(e.message)} <a href="/pricing">See plans</a>.`, false);
    else say(e.message);
  } finally {
    if ($("publish")) $("publish").disabled = false;
  }
});

// Full-screen rocket launch on approval. Blue flames, Gatherly logo on the rocket.
function rocketLaunch() {
  return new Promise((resolve) => {
    if (!document.getElementById("rocketKeys")) {
      const st = document.createElement("style");
      st.id = "rocketKeys";
      st.textContent = `
        @keyframes gSoar{0%{transform:translateY(42vh) scale(.8);opacity:0}14%{opacity:1}68%{transform:translateY(-8vh) scale(1)}100%{transform:translateY(-125vh) scale(.92);opacity:0}}
        @keyframes gFlame{0%,100%{transform:scaleY(1) scaleX(1);opacity:.85}50%{transform:scaleY(1.5) scaleX(.85);opacity:1}}
        @keyframes gFade{from{opacity:0}to{opacity:1}}
        #rocketOverlay{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at 50% 70%,rgba(20,40,90,.85),rgba(6,10,20,.96));animation:gFade .25s ease}
        #rocketOverlay .rk{position:relative;animation:gSoar 2.3s cubic-bezier(.45,0,.55,1) forwards}
        #rocketOverlay .flame{position:absolute;left:50%;top:100%;width:26px;height:60px;transform-origin:top center;margin-left:-13px;border-radius:0 0 50% 50%;background:linear-gradient(#bfe0ff,#5aa0ff 45%,#1f6dff 80%);filter:blur(2px);animation:gFlame .18s ease-in-out infinite}
        #rocketOverlay .cap{position:absolute;bottom:14%;width:100%;text-align:center;color:#cfe0ff;font-weight:600;letter-spacing:.04em;animation:gFade .6s ease .2s both}
      `;
      document.head.appendChild(st);
    }
    const ov = document.createElement("div");
    ov.id = "rocketOverlay";
    ov.innerHTML = `
      <div class="rk">
        <svg width="92" height="150" viewBox="0 0 92 150" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <defs><linearGradient id="body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eaf2ff"/><stop offset="1" stop-color="#b9cdf2"/></linearGradient></defs>
          <path d="M46 2c20 18 30 44 30 74 0 16-4 30-10 42H26c-6-12-10-26-10-42C16 46 26 20 46 2z" fill="url(#body)" stroke="#7fa8ff" stroke-width="2"/>
          <circle cx="46" cy="58" r="16" fill="#0b1730" stroke="#7fa8ff" stroke-width="2"/>
          <path d="M16 96c-9 4-14 14-14 28 10-2 16-7 20-14zM76 96c9 4 14 14 14 28-10-2-16-7-20-14z" fill="#5aa0ff"/>
          <rect x="30" y="112" width="32" height="14" rx="3" fill="#0b1730"/>
        </svg>
        <img src="/assets/logo-white.webp" alt="" width="20" height="24" style="position:absolute;top:44px;left:50%;margin-left:-10px">
        <div class="flame"></div>
      </div>
      <div class="cap">Cleared for launch &middot; your event is live</div>`;
    document.body.appendChild(ov);
    setTimeout(() => { ov.style.transition = "opacity .3s"; ov.style.opacity = "0"; setTimeout(() => { ov.remove(); resolve(); }, 300); }, 2150);
  });
}
