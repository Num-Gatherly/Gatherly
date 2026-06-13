import { boot, api, esc, currentUser, planRank } from "/js/app.js";
boot("/pricing");

const $ = (id) => document.getElementById(id);

const PLANS = {
  free: {
    id: "free", name: "Gatherly", tagline: "Everything you need to start filling sessions.",
    prices: { monthly: 0, annual: 0, lifetime: 0 }, credits: 0,
    features: ["6 event listings per month", "Discovery feed placement", "Core report: joins, peak, sessions", "One-click join-code reveal", "Live in-game player counts"],
  },
  pro: {
    id: "pro", name: "Gatherly Pro", tagline: "Full analytics and the tools to grow.",
    prices: { monthly: 6.99, annual: 75, lifetime: 179 }, credits: 8,
    features: ["Everything in Gatherly", "14 event listings per month", "Full Health Score and funnel", "Scenario benchmarking", "Discord webhook delivery", "8 boost credits per month", "Best-time-to-host heatmap", "Pinned support priority"],
  },
  ultra: {
    id: "ultra", name: "Gatherly Ultra", tagline: "The complete intelligence suite.", popular: true,
    prices: { monthly: 14.99, annual: 140, lifetime: 349 }, robuxMonthly: 2500, credits: 24,
    features: ["Everything in Gatherly Pro", "21 event listings per month", "AI report summaries", "Predictive forecasting + momentum", "Staff and moderation analytics", "Weekly performance report", "Bot DM delivery + extra recipient", "24 boost credits per month", "Top-priority support"],
  },
};
const ORDER = ["free", "pro", "ultra"];
let cycle = "monthly";

function priceLabel(plan) {
  const p = PLANS[plan];
  if (plan === "free") return `<div class="price">Free</div>`;
  const v = p.prices[cycle];
  const monthlyEquiv = cycle === "annual" ? (v / 12) : null;
  const unit = cycle === "lifetime" ? " one-time" : cycle === "annual" ? " /year" : " /month";
  let old = "";
  if (cycle === "annual") { const fullYear = (p.prices.monthly * 12).toFixed(0); old = `<span class="plan-old">$${fullYear}</span>`; }
  return `<div class="price">${old}$${v}<small>${unit}</small></div>
    ${monthlyEquiv ? `<div style="font-size:.8rem;color:var(--muted);margin-top:2px">that's $${monthlyEquiv.toFixed(2)}/mo</div>` : ""}
    ${plan === "ultra" && cycle === "monthly" ? `<div style="font-size:.8rem;color:var(--signal);margin-top:2px">or ${p.robuxMonthly.toLocaleString()} Robux /month</div>` : ""}`;
}

function planCard(plan) {
  const p = PLANS[plan];
  const me = currentUser();
  const isCurrent = me && planRank(me.plan) === planRank(plan);
  const tag = isCurrent ? `<span class="badge" style="margin-bottom:8px;color:var(--signal);border-color:var(--signal)">Current plan</span>` : "";
  let cta;
  if (plan === "free") {
    cta = isCurrent
      ? `<span class="btn btn-ghost btn-sm" style="margin-top:auto;opacity:.6;pointer-events:none">Your current plan</span>`
      : `<a class="btn btn-ghost btn-sm" href="/advertise" style="margin-top:auto">Start free</a>`;
  } else {
    // Always allow opening checkout, even on the current plan, so monthly to annual
    // (or Pro to Ultra) is a normal switch rather than a dead end.
    cta = `<button class="btn ${p.popular ? "btn-primary" : "btn-ghost"} btn-sm" data-buy="${plan}" style="margin-top:auto">${isCurrent ? "Change billing or upgrade" : "Choose " + esc(p.name)}</button>`;
  }
  return `
  <div class="card plan reveal in ${p.popular ? "featured" : ""}" style="display:flex;flex-direction:column">
    ${p.popular ? `<span class="flag">Most popular</span>` : ""}
    ${tag}
    <h3>${esc(p.name)}</h3>
    <p style="font-size:.85rem;min-height:38px;margin:4px 0 6px">${esc(p.tagline)}</p>
    ${priceLabel(plan)}
    <ul style="margin:16px 0">${p.features.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
    ${cta}
  </div>`;
}

function render() {
  $("planGrid").innerHTML = ORDER.map(planCard).join("");
  $("planGrid").querySelectorAll("[data-buy]").forEach((b) => b.onclick = () => openModal(b.dataset.buy));
}

function setCycle(c) {
  cycle = c;
  document.querySelectorAll(".billing-toggle button").forEach((b) => b.classList.toggle("active", b.dataset.cycle === c));
  render();
}

/* ----------------------- Gatherly Custom credit packs ------------------- */
const money = (cents, currency) => currency && currency !== "usd" ? `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}` : `$${(cents / 100).toFixed(2)}`;

async function renderCredits() {
  const host = $("creditsSection");
  if (!host) return;
  let packs = [], currency = "usd";
  try { const d = await api("/api/billing?action=credit-packs"); packs = d.packs || []; currency = d.currency || "usd"; } catch {}
  if (!packs.length) { host.innerHTML = ""; return; }
  host.innerHTML = `
    <div class="card" style="max-width:560px;margin:0 auto">
      <span class="badge badge-boost" style="margin-bottom:8px">Gatherly Custom</span>
      <h3>Top up boost credits</h3>
      <p style="font-size:.9rem;margin:6px 0 14px">A one-off purchase, no subscription. Boost credits push an event to the top of the discovery feed. Subscription credits refresh monthly; these stack on top.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <select id="packSelect" class="input" style="flex:1;min-width:200px">
          ${packs.map((p) => `<option value="${p.credits}">${p.credits} boost credits &mdash; ${money(p.amount, currency)}</option>`).join("")}
        </select>
        <button id="buyCredits" class="btn btn-primary btn-sm">Purchase credits</button>
      </div>
      <p class="note" style="margin-top:12px">Need a bigger or bespoke package? <a href="/contact">Talk to us</a> and we will sort something custom.</p>
      <div id="creditsMsg" style="margin-top:10px"></div>
    </div>`;
  $("buyCredits").onclick = buyCredits;
}

async function buyCredits() {
  const msg = $("creditsMsg");
  if (!currentUser()) { msg.innerHTML = `<div class="alert alert-err">Log in first. <a href="/api/auth?action=start">Continue with Discord</a></div>`; return; }
  const pack = $("packSelect").value;
  msg.innerHTML = `<div class="alert alert-ok">Opening secure checkout&hellip;</div>`;
  try {
    const d = await api("/api/billing?action=buy-credits", { method: "POST", body: { pack } });
    if (d.url) location.href = d.url;
  } catch (e) { msg.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; }
}

/* ------------------------------- modal ---------------------------------- */
function openModal(plan) {
  const chosen = PLANS[plan];
  const upsellId = plan === "pro" ? "ultra" : null;
  const upsell = upsellId ? PLANS[upsellId] : null;

  const tierBlock = (p, highlight) => {
    const v = p.prices[cycle];
    const unit = cycle === "lifetime" ? " one-time" : cycle === "annual" ? " /year" : " /month";
    let struck = "";
    if (highlight && cycle === "annual") struck = `<span class="plan-old">$${(p.prices.monthly * 12).toFixed(0)}</span>`;
    if (highlight && cycle === "monthly") struck = `<span class="plan-old">$${(p.prices.monthly + 3).toFixed(2)}</span>`;
    return `
      <div class="modal-tier ${highlight ? "hi" : "dim"}">
        ${highlight ? `<span class="badge badge-boost" style="margin-bottom:8px">Best value</span>` : ""}
        <h3>${esc(p.name)}</h3>
        <div class="price" style="font-size:1.6rem;margin:8px 0">${struck}$${v}<small>${unit}</small></div>
        <ul style="margin:10px 0 16px;font-size:.85rem">${p.features.slice(0, 4).map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
        <button class="btn ${highlight ? "btn-primary" : "btn-ghost"} btn-sm" data-confirm="${p.id}" style="width:100%">Continue with ${esc(p.name)}</button>
        ${p.id === "ultra" && cycle === "monthly" ? `<button class="btn btn-ghost btn-sm" data-robux="ultra" style="width:100%;margin-top:8px">Pay ${p.robuxMonthly.toLocaleString()} Robux instead</button>` : ""}
      </div>`;
  };

  const back = document.createElement("div");
  back.className = "g-modal-backdrop";
  back.innerHTML = `
    <div class="g-modal">
      <button class="g-modal-x" id="modalX" type="button">&times;</button>
      <h2 style="font-size:1.5rem">Choose your plan</h2>
      <p style="font-size:.9rem;margin-top:6px">${upsell ? "You picked " + esc(chosen.name) + ". Most hosts go a step up for the full toolkit." : "Confirm your " + esc(chosen.name) + " plan."}</p>
      <div class="modal-tiers">
        ${tierBlock(chosen, false)}
        ${upsell ? tierBlock(upsell, true) : ""}
      </div>
      <p class="note" style="margin-top:16px">Billed ${cycle}. Card payments run on Stripe's secure checkout. Switching plan or billing cycle is fine at any time. Cancel whenever you like.</p>
      <div id="modalMsg" style="margin-top:10px"></div>
    </div>`;
  document.body.appendChild(back);
  requestAnimationFrame(() => back.classList.add("in"));

  const close = () => { back.classList.remove("in"); setTimeout(() => back.remove(), 250); };
  back.addEventListener("click", (e) => { if (e.target === back) close(); });
  back.querySelector("#modalX").onclick = close;

  back.querySelectorAll("[data-confirm]").forEach((btn) => btn.onclick = () => checkout(btn.dataset.confirm, back.querySelector("#modalMsg")));
  back.querySelectorAll("[data-robux]").forEach((btn) => btn.onclick = () => robuxFlow(btn.dataset.robux, back.querySelector("#modalMsg")));
}

async function checkout(plan, msgEl) {
  if (!currentUser()) { msgEl.innerHTML = `<div class="alert alert-err">Log in first to subscribe. <a href="/api/auth?action=start">Continue with Discord</a></div>`; return; }
  msgEl.innerHTML = `<div class="alert alert-ok">Opening secure checkout&hellip;</div>`;
  try {
    const d = await api("/api/billing?action=checkout", { method: "POST", body: { plan, cycle } });
    if (d.url) location.href = d.url;
  } catch (e) { msgEl.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; }
}

async function robuxFlow(plan, msgEl) {
  if (!currentUser()) { msgEl.innerHTML = `<div class="alert alert-err">Log in first.</div>`; return; }
  const robloxId = prompt("Buy the 2500 Robux gamepass on Roblox first. Then enter your Roblox user ID (found in your profile URL):");
  if (!robloxId) return;
  msgEl.innerHTML = `<div class="alert alert-ok">Verifying your purchase&hellip;</div>`;
  try {
    await api("/api/billing?action=verify-robux", { method: "POST", body: { plan, robloxId } });
    msgEl.innerHTML = `<div class="alert alert-ok">Verified. You are now on Gatherly Ultra. Redirecting&hellip;</div>`;
    setTimeout(() => location.href = "/dashboard", 1200);
  } catch (e) { msgEl.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; }
}

document.querySelectorAll(".billing-toggle button").forEach((b) => b.onclick = () => setCycle(b.dataset.cycle));
render();
renderCredits();
