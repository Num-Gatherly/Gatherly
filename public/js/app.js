/* ============================================================
   Gatherly V2 - "dispatch at night"
   Palette: ink navy surfaces, signal-blue radar phosphor accent,
   amber strictly reserved for LIVE states.
   Type: Clash Display (display) + General Sans (body), Fontshare.
   ============================================================ */

:root {
  --ink: #090d13;
  --ink-2: #0d1219;
  --panel: #111824;
  --panel-2: #16202e;
  --line: rgba(148, 170, 205, 0.13);
  --line-strong: rgba(148, 170, 205, 0.28);
  --text: #e9eef6;
  --muted: #8e9aac;
  --faint: #5d6a78;
  --signal: #7fa8ff;
  --signal-deep: #3e6ce0;
  --signal-soft: rgba(127, 168, 255, 0.12);
  --live: #ffb454;
  --good: #69d99c;
  --bad: #ff7a7a;
  --radius: 14px;
  --radius-sm: 9px;
  --font-display: "Clash Display", "General Sans", sans-serif;
  --font-body: "General Sans", -apple-system, "Segoe UI", sans-serif;
  --shadow: 0 18px 50px -18px rgba(0, 0, 0, 0.65);
}

* { margin: 0; padding: 0; box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  font-family: var(--font-body);
  background: var(--ink);
  color: var(--text);
  line-height: 1.6;
  font-size: 16px;
  -webkit-font-smoothing: antialiased;
}
::selection { background: var(--signal-deep); color: #fff; }

h1, h2, h3, h4 { font-family: var(--font-display); font-weight: 600; line-height: 1.12; letter-spacing: -0.015em; }
h1 { font-size: clamp(2.4rem, 5.4vw, 4.1rem); }
h2 { font-size: clamp(1.7rem, 3.2vw, 2.5rem); }
h3 { font-size: 1.18rem; }
p { color: var(--muted); }
a { color: var(--signal); text-decoration: none; }
a:hover { text-decoration: underline; }
img { max-width: 100%; display: block; }
:focus-visible { outline: 2px solid var(--signal); outline-offset: 2px; border-radius: 4px; }

.wrap { max-width: 1120px; margin: 0 auto; padding: 0 24px; }
.section { padding: 88px 0; }
.section + .section { border-top: 1px solid var(--line); }

/* ---------- eyebrow / kicker ---------- */
.kicker {
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 0.78rem; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--signal); margin-bottom: 16px;
}
.kicker::before { content: ""; width: 22px; height: 1px; background: var(--signal); }

/* ---------- nav ---------- */
.nav {
  position: sticky; top: 0; z-index: 50;
  background: rgba(7, 10, 16, 0.92);
  backdrop-filter: blur(20px) saturate(160%);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  border-bottom: 1px solid rgba(127, 168, 255, 0.1);
}
.nav-inner { display: flex; align-items: center; gap: 0; height: 58px; padding: 0 4px; }
.brand { display: flex; align-items: center; gap: 9px; font-family: var(--font-display); font-weight: 700; font-size: 1.08rem; color: #fff; letter-spacing: -0.01em; padding: 0 6px; flex-shrink: 0; }
.brand:hover { text-decoration: none; opacity: 0.9; }
.brand img { height: 24px; width: auto; }
.nav-divider { width: 1px; height: 22px; background: rgba(148,170,205,0.15); margin: 0 14px; flex-shrink: 0; }
.nav-links { display: flex; gap: 2px; margin-left: 0; align-items: center; flex: 1; }
.nav-links a { color: rgba(200,212,230,0.7); font-size: 0.875rem; font-weight: 500; padding: 6px 11px; border-radius: 8px; transition: color 0.15s, background 0.15s; white-space: nowrap; }
.nav-links a:hover { color: #fff; background: rgba(255,255,255,0.06); text-decoration: none; }
.nav-links a.active { color: #fff; background: rgba(127,168,255,0.12); font-weight: 600; }
.nav-links a.active::before { content: ""; display: inline-block; width: 5px; height: 5px; border-radius: 50%; background: var(--signal); margin-right: 6px; vertical-align: middle; margin-top: -2px; }
.nav-right { display: flex; align-items: center; gap: 8px; margin-left: auto; flex-shrink: 0; }
.nav-cta { margin-left: 0; }
.nav-burger { display: none; background: none; border: 1px solid rgba(148,170,205,0.2); color: var(--text); border-radius: 8px; padding: 7px 11px; font-size: 1rem; cursor: pointer; }

/* ---------- buttons ---------- */
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  font-family: var(--font-body); font-weight: 600; font-size: 0.95rem;
  padding: 13px 24px; border-radius: 999px; border: 1px solid transparent;
  cursor: pointer; transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease;
  text-decoration: none !important;
}
.btn:active { transform: translateY(1px); }
.btn-primary { background: var(--signal); color: #0a1020; }
.btn-primary:hover { background: #9cbcff; }
.btn-ghost { background: transparent; color: var(--text); border-color: var(--line-strong); }
.btn-ghost:hover { border-color: var(--signal); }
.btn-danger { background: transparent; color: var(--bad); border-color: rgba(255, 122, 122, 0.4); }
.btn-sm { padding: 8px 16px; font-size: 0.85rem; border-radius: 999px; }
.btn[disabled] { opacity: 0.5; cursor: not-allowed; }

/* ---------- cards / panels ---------- */
.card {
  background: linear-gradient(180deg, var(--panel) 0%, var(--ink-2) 100%);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 26px;
  transition: border-color 0.2s ease, transform 0.2s ease;
}
.card h3 { margin-bottom: 8px; }
.card:hover { transform: translateY(-3px); border-color: var(--line-strong); }
.grid { display: grid; gap: 18px; }
.grid-3 { grid-template-columns: repeat(3, 1fr); }
.grid-2 { grid-template-columns: repeat(2, 1fr); }
.grid-4 { grid-template-columns: repeat(4, 1fr); }

/* ---------- stats ---------- */
.stat { padding: 22px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--ink-2); }
.stat b { display: block; font-family: var(--font-display); font-size: 2rem; font-weight: 600; font-variant-numeric: tabular-nums; }
.stat span { font-size: 0.85rem; color: var(--muted); }

.quiet-stats { display: flex; flex-wrap: wrap; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.quiet-stat { flex: 1; min-width: 220px; padding: 38px 30px; border-left: 1px solid var(--line); }
.quiet-stat:first-child { border-left: 0; }
.quiet-stat b { display: block; font-family: var(--font-display); font-size: 2.3rem; font-weight: 600; }
.quiet-stat span { font-size: 0.85rem; color: var(--muted); }
@media (max-width: 700px) { .quiet-stat { border-left: 0; border-top: 1px solid var(--line); } .quiet-stat:first-child { border-top: 0; } }

/* ---------- section header (kicker is used sparingly, not on every section) ---------- */
.sect-head { max-width: 600px; margin-bottom: 38px; }
.sect-head h2 { font-size: clamp(1.8rem, 3.4vw, 2.6rem); }
.sect-head p { margin-top: 10px; }
.sect-tag { font-size: 0.78rem; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); margin-bottom: 10px; display: block; }

/* ---------- editorial spotlight (large quote + real image, Melonly-style) ---------- */
.spotlight { display: grid; grid-template-columns: 1.1fr 0.9fr; border: 1px solid var(--line); border-radius: 20px; overflow: hidden; align-items: stretch; }
.spotlight-img { position: relative; min-height: 320px; background: var(--ink-2); }
.spotlight-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
.spotlight-body { padding: 44px 42px; display: flex; flex-direction: column; justify-content: center; gap: 18px; }
.spotlight-quote { font-family: var(--font-display); font-size: 1.55rem; font-weight: 500; line-height: 1.35; color: var(--text); }
.spotlight-server { display: flex; align-items: center; gap: 8px; font-size: 0.88rem; color: var(--muted); font-weight: 600; }
@media (max-width: 860px) { .spotlight { grid-template-columns: 1fr; } .spotlight-img { min-height: 220px; } }

/* ---------- alternating product rows ---------- */
.alt-row { display: grid; grid-template-columns: 1fr 1fr; gap: 56px; align-items: center; }
.alt-row + .alt-row { margin-top: 64px; }
.alt-row.reverse .alt-text { order: 2; }
.alt-row.reverse .alt-visual { order: 1; }
.alt-text h3 { font-size: 1.8rem; margin-bottom: 14px; }
.alt-text p { max-width: 420px; }

/* ---------- window-chrome frame for real screenshots / mock UI ---------- */
.win { border: 1px solid var(--line); border-radius: 14px; overflow: hidden; background: var(--ink-2); }
.win-bar { display: flex; gap: 6px; padding: 11px 14px; border-bottom: 1px solid var(--line); }
.win-bar i { width: 9px; height: 9px; border-radius: 50%; background: var(--line-strong); display: block; }
.win-shot { position: relative; aspect-ratio: 16/10; }
.win-shot img { width: 100%; height: 100%; object-fit: cover; display: block; }
.win-overlay { position: absolute; left: 14px; bottom: 14px; background: rgba(9,13,19,0.86); border: 1px solid var(--line-strong); border-radius: 10px; padding: 10px 14px; font-size: 0.82rem; max-width: 240px; }
.win-overlay b { display: block; font-size: 0.86rem; margin-bottom: 3px; }
@media (max-width: 860px) { .alt-row { grid-template-columns: 1fr; } .alt-row.reverse .alt-text, .alt-row.reverse .alt-visual { order: initial; } }

/* ---------- bento grid (irregular tile sizes) ---------- */
.bento { display: grid; grid-template-columns: repeat(4, 1fr); grid-auto-rows: 168px; grid-auto-flow: dense; gap: 16px; }
.bento .card { display: flex; flex-direction: column; justify-content: flex-end; }
.bento .b-lg { grid-column: span 2; grid-row: span 2; justify-content: space-between; }
.bento .b-md { grid-column: span 2; }
.bento .b-sm { grid-column: span 1; }
@media (max-width: 860px) { .bento { grid-template-columns: repeat(2, 1fr); } .bento .b-lg { grid-column: span 2; grid-row: span 1; } }
@media (max-width: 560px) { .bento { grid-template-columns: 1fr; } .bento .b-lg, .bento .b-md { grid-column: span 1; } }

/* ---------- accordion (FAQ, comparisons, anywhere a card grid would feel templated) ---------- */
.faq-list { border-top: 1px solid var(--line); max-width: 760px; }
.faq-item { border-bottom: 1px solid var(--line); }
.faq-q { width: 100%; text-align: left; background: none; border: none; color: var(--text); font-family: var(--font-display); font-size: 1.08rem; font-weight: 500; padding: 24px 2px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; gap: 16px; }
.faq-q .plus { font-size: 1.5rem; color: var(--muted); transition: transform 0.25s ease; flex-shrink: 0; line-height: 1; }
.faq-item.open .faq-q .plus { transform: rotate(45deg); }
.faq-a { max-height: 0; overflow: hidden; transition: max-height 0.3s ease; }
.faq-item.open .faq-a { max-height: 320px; }
.faq-a p { padding: 0 2px 24px; max-width: 600px; }

/* ---------- badges ---------- */
.badge {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 0.74rem; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
  padding: 4px 10px; border-radius: 999px; border: 1px solid var(--line-strong); color: var(--muted);
}
.badge-live { color: var(--live); border-color: rgba(255, 180, 84, 0.45); }
.badge-live::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--live); animation: pulse 1.6s infinite; }
.badge-boost { color: var(--signal); border-color: rgba(127, 168, 255, 0.45); }
.badge-good { color: var(--good); border-color: rgba(105, 217, 156, 0.4); }
.badge-bad { color: var(--bad); border-color: rgba(255, 122, 122, 0.4); }
.badge-streak { color: var(--live); border-color: rgba(255, 180, 84, 0.45); }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }

/* ---------- forms ---------- */
label.field { display: block; margin-bottom: 16px; font-size: 0.88rem; font-weight: 500; color: var(--text); }
label.field small { display: block; font-weight: 400; color: var(--muted); margin-top: 3px; }
input, textarea, select {
  width: 100%; margin-top: 7px; padding: 11px 13px;
  background: var(--ink); color: var(--text);
  border: 1px solid var(--line-strong); border-radius: var(--radius-sm);
  font-family: var(--font-body); font-size: 0.95rem;
}
input:focus, textarea:focus, select:focus { outline: none; border-color: var(--signal); }
.hp { position: absolute; left: -9999px; opacity: 0; pointer-events: none; } /* honeypot */

.note { font-size: 0.85rem; color: var(--muted); border-left: 2px solid var(--line-strong); padding-left: 12px; margin: 14px 0; }
.alert { padding: 12px 16px; border-radius: var(--radius-sm); font-size: 0.9rem; margin: 14px 0; }
.alert-err { background: rgba(255, 122, 122, 0.08); border: 1px solid rgba(255, 122, 122, 0.35); color: var(--bad); }
.alert-ok { background: rgba(105, 217, 156, 0.08); border: 1px solid rgba(105, 217, 156, 0.35); color: var(--good); }

/* ---------- dropzone ---------- */
.dropzone {
  margin-top: 7px; border: 1.5px dashed var(--line-strong); border-radius: var(--radius);
  padding: 30px 20px; text-align: center; cursor: pointer; transition: border-color 0.15s, background 0.15s;
  color: var(--muted); font-size: 0.9rem;
}
.dropzone.drag, .dropzone:hover { border-color: var(--signal); background: var(--signal-soft); }
.dropzone img { margin: 12px auto 0; border-radius: var(--radius-sm); max-height: 130px; }

/* ============================================================
   RADAR - the signature element
   ============================================================ */
.radar { position: relative; width: 100%; aspect-ratio: 1; max-width: 420px; }
.radar svg { width: 100%; height: 100%; }
.radar-ring { fill: none; stroke: var(--line-strong); stroke-width: 1; }
.radar-cross { stroke: var(--line); stroke-width: 1; }
.radar-sweep {
  position: absolute; inset: 0; border-radius: 50%;
  background: conic-gradient(from 0deg, rgba(127, 168, 255, 0.35), rgba(127, 168, 255, 0.05) 22%, transparent 26%);
  animation: sweep 4.5s linear infinite;
  -webkit-mask: radial-gradient(circle, black 98%, transparent 100%);
          mask: radial-gradient(circle, black 98%, transparent 100%);
}
@keyframes sweep { to { transform: rotate(360deg); } }
.radar-blip { fill: var(--signal); animation: blip 3s ease-out infinite; transform-origin: center; transform-box: fill-box; }
.radar-blip.live { fill: var(--live); }
@keyframes blip { 0% { opacity: 0; transform: scale(0.4); } 12% { opacity: 1; transform: scale(1); } 75% { opacity: 0.85; } 100% { opacity: 0; transform: scale(1.5); } }
.radar-label {
  position: absolute; bottom: -6px; left: 50%; transform: translateX(-50%);
  font-size: 0.78rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); white-space: nowrap;
}
.radar.mini { max-width: 120px; margin: 0 auto; }

/* ---------- hero ---------- */
.hero { padding: 96px 0 80px; position: relative; overflow: hidden; }
.hero-grid { display: grid; grid-template-columns: 1.15fr 0.85fr; gap: 56px; align-items: center; }
.hero h1 .accent { color: var(--signal); }
.hero p.lede { font-size: 1.15rem; margin: 20px 0 30px; max-width: 480px; }
.hero-actions { display: flex; gap: 14px; flex-wrap: wrap; }
.hero-pulse { display: inline-flex; align-items: center; gap: 9px; margin-bottom: 22px; font-size: 0.86rem; color: var(--muted); border: 1px solid var(--line); border-radius: 999px; padding: 6px 14px; }
.hero-pulse b { color: var(--live); font-variant-numeric: tabular-nums; }

/* ---------- ticker ---------- */
.ticker-wrap { overflow: hidden; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); padding: 13px 0; background: var(--ink-2); }
.ticker { display: flex; gap: 48px; width: max-content; animation: ticker 38s linear infinite; }
.ticker span { font-size: 0.85rem; color: var(--muted); white-space: nowrap; }
.ticker b { color: var(--text); font-weight: 600; }
@keyframes ticker { to { transform: translateX(-50%); } }

/* ---------- scroll reveal ---------- */
.reveal { opacity: 0; transform: translateY(26px); transition: opacity 0.65s ease, transform 0.65s ease; }
.reveal.in { opacity: 1; transform: none; }
.reveal-d1 { transition-delay: 0.08s; } .reveal-d2 { transition-delay: 0.16s; } .reveal-d3 { transition-delay: 0.24s; }

/* ---------- event cards ---------- */
.event-card { display: flex; flex-direction: column; overflow: hidden; padding: 0; }
.event-banner { aspect-ratio: 1200 / 480; background: linear-gradient(120deg, var(--panel-2), var(--ink-2)); position: relative; }
.event-banner img { width: 100%; height: 100%; object-fit: cover; }
.event-banner .badges { position: absolute; top: 12px; left: 12px; display: flex; gap: 8px; }
.event-body { padding: 20px; display: flex; flex-direction: column; gap: 10px; flex: 1; }
.event-meta { display: flex; gap: 14px; font-size: 0.83rem; color: var(--muted); flex-wrap: wrap; }
.event-meta b { color: var(--text); font-variant-numeric: tabular-nums; }
.countdown { font-variant-numeric: tabular-nums; color: var(--signal); font-weight: 600; }

/* ---------- report ---------- */
.score-dial { position: relative; width: 170px; height: 170px; margin: 0 auto; }
.score-dial svg { transform: rotate(-90deg); }
.score-dial .val { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; }
.score-dial .val b { font-family: var(--font-display); font-size: 2.6rem; line-height: 1; }
.score-dial .val span { font-size: 0.72rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }

.funnel { display: grid; gap: 8px; }
.funnel-row { display: grid; grid-template-columns: 130px 1fr 70px; gap: 14px; align-items: center; font-size: 0.88rem; }
.funnel-bar { height: 26px; border-radius: 6px; background: linear-gradient(90deg, var(--signal-deep), var(--signal)); min-width: 8px; }
.funnel-drop { font-size: 0.76rem; color: var(--bad); padding-left: 144px; }

.bars { display: flex; align-items: flex-end; gap: 7px; height: 130px; }
.bars .bar { flex: 1; background: linear-gradient(180deg, var(--signal), var(--signal-deep)); border-radius: 5px 5px 0 0; min-height: 4px; position: relative; }
.bars .bar i { position: absolute; bottom: -20px; left: 50%; transform: translateX(-50%); font-style: normal; font-size: 0.66rem; color: var(--muted); white-space: nowrap; }

.heatmap { display: grid; grid-template-columns: repeat(24, 1fr); gap: 3px; }
.heatmap i { aspect-ratio: 1; border-radius: 3px; background: var(--panel-2); }

table.tbl { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
.tbl th { text-align: left; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); padding: 9px 12px; border-bottom: 1px solid var(--line-strong); }
.tbl td { padding: 10px 12px; border-bottom: 1px solid var(--line); font-variant-numeric: tabular-nums; }
.tbl tr:hover td { background: var(--signal-soft); }

.ai-summary { border: 1px solid rgba(127, 168, 255, 0.3); background: var(--signal-soft); border-radius: var(--radius); padding: 22px 24px; }
.ai-summary .tag { font-size: 0.72rem; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--signal); margin-bottom: 10px; display: flex; align-items: center; gap: 8px; }
.ai-summary p { color: var(--text); font-size: 0.97rem; }

/* ---------- pricing ---------- */
.plan { position: relative; display: flex; flex-direction: column; gap: 14px; }
.plan .price { font-family: var(--font-display); font-size: 2.1rem; font-weight: 600; }
.plan .price small { font-size: 0.9rem; color: var(--muted); font-family: var(--font-body); font-weight: 400; }
.plan ul { list-style: none; display: grid; gap: 9px; font-size: 0.9rem; color: var(--muted); }
.plan ul li::before { content: "-"; color: var(--signal); margin-right: 9px; }
.plan.featured { border-color: var(--signal); box-shadow: 0 0 0 1px var(--signal), var(--shadow); }
.plan .flag { position: absolute; top: -11px; left: 22px; background: var(--signal); color: #0a1020; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; padding: 3px 10px; border-radius: 999px; }

/* ---------- footer ---------- */
footer { border-top: 1px solid var(--line); padding: 56px 0 36px; margin-top: 60px; }
.foot-grid { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap: 32px; margin-bottom: 36px; }
.foot-grid h4 { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); margin-bottom: 14px; }
.foot-grid a { display: block; color: var(--muted); font-size: 0.9rem; margin-bottom: 9px; }
.foot-grid a:hover { color: var(--text); text-decoration: none; }
.foot-base { display: flex; justify-content: space-between; align-items: center; gap: 18px; font-size: 0.82rem; color: var(--faint, #5d6a78); flex-wrap: wrap; border-top: 1px solid var(--line); padding-top: 22px; }
.status-dot { display: inline-flex; align-items: center; gap: 7px; font-size: 0.8rem; color: var(--muted); }
.status-dot i { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
.status-dot.up i { background: var(--good); } .status-dot.down i { background: var(--bad); }

/* ---------- split feature ---------- */
.split { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; align-items: stretch; }
.split .card { display: flex; flex-direction: column; gap: 14px; }
.mock { border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--ink); padding: 16px; font-size: 0.82rem; color: var(--muted); flex: 1; }
.mock b { color: var(--text); }
.mock .row { display: flex; justify-content: space-between; padding: 7px 0; border-bottom: 1px solid var(--line); }
.mock .row:last-child { border-bottom: 0; }

/* ---------- responsive ---------- */
@media (max-width: 900px) {
  .hero-grid, .grid-3, .grid-4, .split, .grid-2 { grid-template-columns: 1fr; }
  .foot-grid { grid-template-columns: 1fr 1fr; }
  .radar { max-width: 300px; margin: 0 auto; }
  .nav-links { display: none; position: absolute; top: 58px; left: 0; right: 0; flex-direction: column; background: rgba(7,10,16,0.98); border-bottom: 1px solid rgba(127,168,255,0.1); padding: 14px 16px; gap: 4px; align-items: flex-start; }
  .nav-links.open { display: flex; }
  .nav-burger { display: block; }
  .nav-divider { display: none; }
  .nav-right { display: none; }
  .section { padding: 60px 0; }
}

@media (prefers-reduced-motion: reduce) {
  .radar-sweep, .radar-blip, .ticker, .badge-live::before { animation: none !important; }
  .reveal { opacity: 1; transform: none; transition: none; }
  html { scroll-behavior: auto; }
}
/* ============================================================
   GATHERLY V3 ADDITIONS - append to the end of style.css
   ============================================================ */

/* ---------- nav user & login styles ---------- */
.nav-login {
  background: rgba(127,168,255,0.15) !important; color: #c8d8ff !important;
  border: 1px solid rgba(127,168,255,0.3) !important; font-size: .84rem !important;
  padding: 7px 14px !important; border-radius: 8px !important;
  transition: background .15s, border-color .15s !important;
}
.nav-login:hover { background: rgba(127,168,255,0.25) !important; border-color: rgba(127,168,255,0.5) !important; }
.nav-controlroom {
  color: rgba(200,212,230,0.85) !important; font-size: .84rem; font-weight: 500; margin-right: 4px;
  padding: 6px 11px; border-radius: 8px; transition: color .15s, background .15s;
}
.nav-controlroom:hover { color: #fff !important; background: rgba(255,255,255,0.06); text-decoration: none; opacity: 1; }

.nav-user-wrap { display: flex; align-items: center; gap: 8px; }
.nav-user-btn {
  display: flex; align-items: center; gap: 8px;
  background: rgba(255,255,255,0.05); border: 1px solid rgba(148,170,205,0.2);
  color: #ffffff; font-size: .84rem; font-weight: 500; font-family: var(--font-body);
  padding: 5px 10px 5px 5px; border-radius: 999px; cursor: pointer;
  transition: border-color .2s, background .2s;
}
.nav-user-btn:hover { border-color: rgba(127,168,255,0.45); background: rgba(127,168,255,0.08); }
.nav-user-name { color: #ffffff; font-weight: 600; }
.nav-user-caret { font-size: .65rem; color: rgba(255,255,255,0.4); margin-left: 2px; }

.nav-dropdown {
  position: fixed; z-index: 9999; min-width: 210px;
  background: rgba(14,20,30,0.97); backdrop-filter: blur(20px);
  border: 1px solid rgba(148,170,205,0.18); border-radius: 12px;
  padding: 8px; box-shadow: 0 20px 60px rgba(0,0,0,0.5);
}
.ndd-head { display: flex; align-items: center; gap: 10px; padding: 6px 10px 12px; border-bottom: 1px solid rgba(148,170,205,0.1); margin-bottom: 6px; }
.ndd-name { color: #fff; font-weight: 600; font-size: .92rem; }
.ndd-meta { color: var(--signal); font-size: .8rem; margin-top: 2px; }
.ndd-item {
  display: block; width: 100%; text-align: left; padding: 9px 12px; border-radius: 8px;
  color: rgba(255,255,255,0.85); font-size: .9rem; text-decoration: none;
  background: none; border: none; cursor: pointer; font-family: var(--font-body); transition: background .15s;
}
.ndd-item:hover { background: rgba(127,168,255,0.1); text-decoration: none; }
.ndd-danger { color: #ff8585; }
.ndd-danger:hover { background: rgba(255,90,90,0.08); }
.ndd-sep { height: 1px; background: rgba(148,170,205,0.1); margin: 6px 0; }

.announce-bar {
  position: relative; z-index: 40;
  background: linear-gradient(90deg, rgba(62,108,224,0.16), rgba(127,168,255,0.10), rgba(62,108,224,0.16));
  backdrop-filter: blur(14px) saturate(140%);
  border-bottom: 1px solid rgba(127,168,255,0.22);
}
.announce-inner { display: flex; align-items: center; justify-content: center; gap: 10px; padding: 10px 24px; min-height: 42px; }
.announce-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--signal); box-shadow: 0 0 10px var(--signal); animation: pulse 1.8s infinite; flex-shrink: 0; }
.announce-text { font-size: .88rem; color: #dce6ff; font-weight: 500; text-align: center; opacity: 0; }
.announce-text.in { animation: announce-fade .5s ease forwards; }
.announce-text a { color: #fff; text-decoration: underline; }
@keyframes announce-fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }

.g-toast {
  position: fixed; right: 22px; bottom: 22px; z-index: 9998; width: 320px; max-width: calc(100vw - 44px);
  background: rgba(16,22,33,0.96); backdrop-filter: blur(20px);
  border: 1px solid rgba(127,168,255,0.25); border-radius: 14px; padding: 16px 18px;
  box-shadow: 0 24px 70px rgba(0,0,0,0.55), 0 0 0 1px rgba(127,168,255,0.06);
  transform: translateY(30px); opacity: 0; transition: transform .35s cubic-bezier(.22,1,.36,1), opacity .35s ease;
}
.g-toast.in { transform: none; opacity: 1; }
.g-toast-x { position: absolute; top: 10px; right: 12px; background: none; border: none; color: var(--muted); font-size: 1.3rem; line-height: 1; cursor: pointer; }
.g-toast-x:hover { color: #fff; }
.g-toast-title { font-weight: 700; color: #fff; font-size: .98rem; padding-right: 18px; }
.g-toast-body { color: var(--muted); font-size: .85rem; margin-top: 6px; line-height: 1.5; }
.g-toast-link { display: inline-block; margin-top: 10px; font-size: .85rem; font-weight: 600; color: var(--signal); }

@keyframes radar-ping { 0% { opacity: .8; transform: scale(1); } 100% { opacity: 0; transform: scale(2.5); } }

.locked { position: relative; overflow: hidden; isolation: isolate; min-height: 220px; }
.locked > .locked-inner { position: relative; z-index: 0; filter: blur(7px); pointer-events: none; user-select: none; opacity: .55; min-height: 100%; }
.locked-overlay {
  position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 12px; text-align: center; padding: 20px; z-index: 5;
  background: radial-gradient(circle at center, rgba(9,13,19,0.6), rgba(9,13,19,0.88));
}
.locked-overlay .lock-title { font-weight: 700; color: #fff; font-size: 1rem; }
.locked-overlay .lock-sub { color: var(--muted); font-size: .85rem; max-width: 280px; }
.lock-badge { display: inline-flex; align-items: center; gap: 6px; font-size: .72rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--signal); border: 1px solid rgba(127,168,255,0.4); border-radius: 999px; padding: 4px 12px; }

.event-card.boosted { border: 2px solid rgba(255,80,80,0.7) !important; box-shadow: 0 0 26px rgba(255,60,60,0.18), inset 0 0 0 1px rgba(255,100,100,0.12); }
.boost-flag { display: flex; align-items: center; gap: 6px; font-size: .72rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #ff6060; }
.boost-flag .bdot { width: 6px; height: 6px; border-radius: 50%; background: #ff4040; animation: pulse 1.2s infinite; }

.live-count { display: flex; align-items: center; gap: 6px; margin-top: 6px; font-size: .82rem; color: var(--good); font-weight: 600; }
.live-count .ldot { width: 7px; height: 7px; border-radius: 50%; background: var(--good); }

.discover-controls { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin: 24px 0 28px; }
.discover-search { flex: 1; min-width: 220px; }
.filter-chips { display: flex; gap: 8px; flex-wrap: wrap; }
.chip { background: rgba(255,255,255,0.04); border: 1px solid var(--line-strong); color: var(--muted); border-radius: 999px; padding: 7px 14px; font-size: .82rem; font-weight: 600; cursor: pointer; transition: all .15s; font-family: var(--font-body); }
.chip:hover { border-color: var(--signal); color: var(--text); }
.chip.active { background: var(--signal-soft); border-color: var(--signal); color: var(--text); }

.billing-toggle { display: inline-flex; background: rgba(255,255,255,0.04); border: 1px solid var(--line-strong); border-radius: 999px; padding: 4px; gap: 4px; margin: 0 auto 36px; }
.billing-toggle button { background: none; border: none; color: var(--muted); font-weight: 600; font-size: .88rem; padding: 8px 18px; border-radius: 999px; cursor: pointer; font-family: var(--font-body); transition: all .2s; }
.billing-toggle button.active { background: var(--signal); color: #0a1020; }
.save-pill { font-size: .68rem; background: rgba(105,217,156,0.16); color: var(--good); border-radius: 999px; padding: 2px 7px; margin-left: 6px; }
.plan-old { text-decoration: line-through; color: var(--faint); font-size: 1rem; font-weight: 400; margin-right: 8px; }

.g-modal-backdrop { position: fixed; inset: 0; background: rgba(5,8,12,0.7); backdrop-filter: blur(6px); z-index: 10000; display: flex; align-items: center; justify-content: center; padding: 20px; opacity: 0; transition: opacity .25s; }
.g-modal-backdrop.in { opacity: 1; }
.g-modal { background: rgba(16,22,33,0.98); border: 1px solid rgba(148,170,205,0.18); border-radius: 18px; padding: 28px; max-width: 720px; width: 100%; box-shadow: 0 30px 90px rgba(0,0,0,0.6); transform: translateY(16px); transition: transform .25s; }
.g-modal-backdrop.in .g-modal { transform: none; }
.g-modal-x { float: right; background: none; border: none; color: var(--muted); font-size: 1.5rem; cursor: pointer; }
.g-modal-x:hover { color: #fff; }
.modal-tiers { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 18px; }
.modal-tier { border: 1px solid var(--line); border-radius: 14px; padding: 20px; }
.modal-tier.dim { opacity: .6; }
.modal-tier.hi { border-color: var(--signal); box-shadow: 0 0 0 1px var(--signal), 0 16px 50px -18px rgba(62,108,224,0.4); background: linear-gradient(180deg, rgba(127,168,255,0.06), transparent); }
@media (max-width: 620px) { .modal-tiers { grid-template-columns: 1fr; } }

.back-home { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); font-size: .88rem; font-weight: 500; margin-bottom: 14px; }
.back-home:hover { color: var(--text); text-decoration: none; }

/* ============================================================
   REPORT V4 - sectioned analytics, heatmap, gating, upsell
   ============================================================ */
.rep-section-head { margin: 34px 0 18px; }
.rep-section-title {
  font-size: 1.05rem; letter-spacing: .14em; text-transform: uppercase; font-weight: 600;
  color: var(--signal); display: flex; align-items: center; gap: 12px;
}
.rep-section-title::after { content: ""; flex: 1; height: 1px; background: linear-gradient(90deg, rgba(127,168,255,0.35), transparent); }
.rep-section-sub { font-size: .85rem; margin-top: 6px; }
.rep-grid { align-items: stretch; }
.rep-grid .rep-box { height: 100%; display: flex; flex-direction: column; }
.rep-box .rep-kick { font-size: .68rem; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; }
.rep-box h3 { margin-bottom: 10px; }
.rep-box .locked-inner { flex: 1; }

/* best-time-to-host heatmap */
.heatmap-7 { display: flex; flex-direction: column; gap: 4px; }
.heat-row { display: grid; grid-template-columns: 34px 1fr; align-items: center; gap: 8px; }
.heat-day { font-size: .68rem; color: var(--muted); text-align: right; }
.heat-cells { display: grid; grid-template-columns: repeat(24, 1fr); gap: 2px; }
.heat-cells i { aspect-ratio: 1; border-radius: 2px; }
.heat-axis .heat-cells { position: relative; height: 14px; }
.heat-axis .heat-cells span { font-size: .58rem; color: var(--faint); grid-row: 1; }

/* delivery rows */
.delivery-row { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--line); }
.delivery-row:last-child { border-bottom: 0; }
.del-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--line-strong); flex-shrink: 0; }
.del-dot.on { background: var(--good); box-shadow: 0 0 8px var(--good); }

/* retention / win-back band */
.rep-upsell {
  display: flex; align-items: center; justify-content: space-between; gap: 22px; flex-wrap: wrap;
  border: 1px solid rgba(127,168,255,0.32);
  background: linear-gradient(120deg, rgba(127,168,255,0.10), rgba(62,108,224,0.05));
}
.rep-upsell .rep-kick { font-size: .7rem; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--signal); }

/* gated boxes need to fill the grid row cleanly - min-height now lives on the base .locked rule */

/* ============================================================
   CONTROL ROOM + ANNOUNCEMENT REFINEMENTS (Update 5)
   ============================================================ */
/* Calmer announcement marker, keep the glass + blue tint, drop the pulsing "AI orb". */
.announce-dot {
  width: 7px; height: 7px; border-radius: 2px; transform: rotate(45deg);
  background: linear-gradient(135deg, #9cbcff, var(--signal));
  box-shadow: 0 0 0 3px rgba(127,168,255,0.12);
  animation: none !important;
}
/* Editable glass "clickbox" CTA button at the end of the announcement. */
.announce-cta {
  display: inline-flex; align-items: center; gap: 6px; margin-left: 10px;
  padding: 4px 12px; border-radius: 8px; font-size: .8rem; font-weight: 600;
  color: #eaf1ff !important; text-decoration: none !important;
  background: rgba(127,168,255,0.14);
  border: 1px solid rgba(127,168,255,0.38);
  backdrop-filter: blur(8px) saturate(150%);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.12);
  transition: background .18s ease, border-color .18s ease, transform .18s ease;
}
.announce-cta::after { content: "\2192"; opacity: .8; }
.announce-cta:hover { background: rgba(127,168,255,0.24); border-color: rgba(127,168,255,0.6); transform: translateY(-1px); }

/* Red notification circle over the Control room nav link. */
.nav-controlroom { position: relative; }
.nav-cr-badge {
  position: absolute; top: -7px; right: -12px; min-width: 16px; height: 16px;
  padding: 0 4px; border-radius: 999px; background: #ff5c5c; color: #fff;
  font-size: .64rem; font-weight: 700; line-height: 16px; text-align: center;
  box-shadow: 0 0 0 2px rgba(9,13,19,0.9); }

/* Notification toast image. */
.g-toast-img { width: 100%; max-height: 150px; object-fit: cover; border-radius: 10px; margin-bottom: 10px; }

/* ============================================================
   COMMUNITY REVIEW RAIL - tilted "glass laptop" screens (Update 3/12)
   ============================================================ */
.laptop-rail-wrap {
  margin-top: 40px; padding: 30px 0 10px; overflow: hidden;
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent);
          mask-image: linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent);
}
.laptop-rail { display: flex; gap: 46px; width: max-content; animation: laptop-scroll 72s linear infinite; will-change: transform; padding: 10px 24px; }
.laptop-rail-wrap:hover .laptop-rail { animation-play-state: paused; }
@keyframes laptop-scroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }

.laptop-card { width: 380px; flex-shrink: 0; }
.laptop { perspective: 1500px; }
.laptop-screen {
  position: relative; aspect-ratio: 16 / 10; border-radius: 14px 14px 4px 4px; overflow: hidden;
  transform: rotateY(-22deg) rotateX(6deg); transform-origin: left center;
  border: 1px solid rgba(148,170,205,0.22);
  background: #05080d;
  box-shadow: 28px 30px 70px -28px rgba(0,0,0,0.8), inset 0 0 0 2px rgba(255,255,255,0.04);
  transition: transform .5s cubic-bezier(.22,1,.36,1);
}
.laptop-card:hover .laptop-screen { transform: rotateY(-10deg) rotateX(3deg); }
.laptop-screen img { width: 100%; height: 100%; object-fit: cover; }
.laptop-glare {
  position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(120deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.04) 22%, transparent 42%);
  mix-blend-mode: screen;
}
.laptop-base {
  height: 12px; margin: 0 6%; border-radius: 0 0 12px 12px;
  transform: rotateY(-22deg) rotateX(6deg); transform-origin: left center;
  background: linear-gradient(180deg, rgba(148,170,205,0.3), rgba(148,170,205,0.06));
  box-shadow: 18px 16px 30px -16px rgba(0,0,0,0.7);
}
.laptop-card figcaption { margin-top: 26px; max-width: 330px; }
.laptop-quote { color: var(--text); font-size: .92rem; line-height: 1.5; }
.laptop-server { display: flex; align-items: center; gap: 8px; margin-top: 10px; font-size: .82rem; font-weight: 600; color: var(--signal); }
.laptop-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--good); box-shadow: 0 0 8px var(--good); }
@media (max-width: 600px) { .laptop-card { width: 300px; } }
@media (prefers-reduced-motion: reduce) { .laptop-rail { animation: none; } }

.live-event-card { display: block; }
.live-event-card:hover { text-decoration: none; }

/* ============================================================
   ADVERTISING SLOTS + ADVERTISERS PAGE (Update 9)
   ============================================================ */
.ad-slot { margin: 26px 0; min-height: 0; }
.ad-slot:empty { display: none; }
.ad-slot--side { margin: 0 0 18px; }
.ad-slot--side .ad-banner { flex-direction: column; align-items: flex-start; }
.ad-slot--side .ad-banner img { width: 100%; aspect-ratio: 16 / 10; height: auto; }
.ad-slot--side .ad-cta { margin-left: 0; }
.ad-rail { position: sticky; top: 96px; align-self: start; }
.layout-rail { display: grid; grid-template-columns: 1fr 280px; gap: 32px; align-items: start; }
@media (max-width: 980px) { .layout-rail { grid-template-columns: 1fr; } }
@media (max-width: 980px) { .ad-rail { position: static; } }
.ad-banner {
  display: flex; align-items: center; gap: 16px; padding: 14px 18px; border-radius: 14px;
  background: rgba(255,255,255,0.03); border: 1px solid var(--line);
  text-decoration: none !important; color: var(--text); transition: border-color .2s, transform .2s, background .2s;
  position: relative; overflow: hidden;
}
.ad-banner:hover { border-color: rgba(127,168,255,0.45); transform: translateY(-2px); background: rgba(127,168,255,0.05); }
.ad-banner img { width: 96px; height: 60px; object-fit: cover; border-radius: 8px; flex-shrink: 0; }
.ad-banner .ad-title { font-weight: 600; font-size: .98rem; }
.ad-banner .ad-cta { margin-left: auto; font-size: .82rem; font-weight: 600; color: var(--signal); white-space: nowrap; }
.ad-banner .ad-flag { position: absolute; top: 6px; right: 8px; font-size: .58rem; letter-spacing: .08em; text-transform: uppercase; color: var(--faint); }
.ad-house { border-style: dashed; }

.adv-price-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 14px; margin: 18px 0; }
.adv-price { border: 1px solid var(--line); border-radius: 14px; padding: 18px; text-align: center; cursor: pointer; transition: border-color .2s, background .2s; }
.adv-price:hover, .adv-price.active { border-color: var(--signal); background: var(--signal-soft); }
.adv-price b { display: block; font-family: var(--font-display); font-size: 1.8rem; }
.adv-stat { display: flex; gap: 18px; flex-wrap: wrap; }
@media (max-width: 700px) { .adv-price-grid { grid-template-columns: 1fr; } }

/* ============================================================
   NEWS / BLOG (Update 8)
   ============================================================ */
.news-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 20px; margin-top: 34px; }
@media (max-width: 900px) { .news-grid { grid-template-columns: 1fr; } }
.news-card {
  display: flex; flex-direction: column; overflow: hidden; padding: 0; cursor: pointer;
  background: linear-gradient(180deg, var(--panel) 0%, var(--ink-2) 100%);
  border: 1px solid var(--line); border-radius: var(--radius); transition: transform .25s, border-color .25s, box-shadow .25s;
}
.news-card:hover { transform: translateY(-4px); border-color: rgba(127,168,255,0.4); box-shadow: 0 22px 50px -22px rgba(62,108,224,0.3); }
.news-banner { aspect-ratio: 16/9; background: linear-gradient(120deg, var(--panel-2), var(--ink-2)); overflow: hidden; }
.news-banner img { width: 100%; height: 100%; object-fit: cover; }
.news-body { padding: 18px 20px 22px; display: flex; flex-direction: column; gap: 10px; flex: 1; }
.news-author { display: flex; align-items: center; gap: 9px; font-size: .82rem; color: var(--muted); }
.news-author img { width: 26px; height: 26px; border-radius: 50%; object-fit: cover; }
.news-author .na-fallback { width: 26px; height: 26px; border-radius: 50%; background: var(--signal-deep); display: flex; align-items: center; justify-content: center; font-weight: 700; color: #fff; font-size: .8rem; }
.news-card h3 { margin: 0; }
.news-excerpt { font-size: .88rem; color: var(--muted); }
.news-date { font-size: .76rem; color: var(--faint); margin-top: auto; }

.article { max-width: 760px; margin: 0 auto; }
.article-banner { width: 100%; border-radius: var(--radius); margin: 18px 0 24px; }
.article-block-img { width: 100%; border-radius: var(--radius); margin: 22px 0; }
.article p { color: var(--text); font-size: 1.02rem; line-height: 1.75; margin: 16px 0; }
.article h3 { margin: 30px 0 8px; }
