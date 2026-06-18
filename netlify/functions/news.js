// /api/news — Gatherly news / blog.
//   Public:   list                 -> published articles (newest first)
//             get?slug= | ?id=      -> a single published article (full body)
//   Executive (Control Room -> News):
//             save (POST)           -> create or update an article
//             delete (POST)         -> remove an article
//             admin-list            -> all articles incl. drafts
//
// Articles are ordered blocks. A block is one of:
//   { type: "heading", value }      plain text heading
//   { type: "image",   value }      https image URL
//   { type: "text",    value }      plain paragraph
//   { type: "html",    value }      rich text (bold, sizes, links, images) — sanitised
import {
  json, requireUser, isExec, newsStore, audit, clampStr, id, guard,
  postStaffEvent, brandEmbed,
} from "../lib/util.js";

const slugify = (s) => clampStr(s, 80).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || id().slice(0, 8);

/* --------------------------- HTML sanitiser ----------------------------- */
// Allowlist-based. Authors are executives (trusted), but we still strip scripts,
// event handlers, and dangerous URLs as defence in depth.
const ALLOWED_TAGS = new Set(["p", "br", "b", "strong", "i", "em", "u", "s", "strike", "h1", "h2", "h3", "h4", "ul", "ol", "li", "blockquote", "a", "span", "div", "img", "hr"]);
const ALLOWED_ATTR = {
  a: ["href", "target", "rel"], span: ["style"], div: ["style"], p: ["style"],
  h1: ["style"], h2: ["style"], h3: ["style"], h4: ["style"], li: ["style"], img: ["src", "alt", "style"],
};
const STYLE_ALLOW = /^(font-size|font-weight|font-style|text-decoration|text-align|color)\s*:\s*[^;]+$/i;

function sanitizeStyle(style) {
  return String(style).split(";").map((s) => s.trim())
    .filter((s) => STYLE_ALLOW.test(s) && !/url\(|expression|javascript:/i.test(s))
    .join("; ");
}

function sanitizeHtml(html) {
  if (!html) return "";
  let out = String(html).replace(/<\s*(script|style|iframe|object|embed|svg|math|link|meta)[\s\S]*?<\s*\/\s*\1\s*>/gi, "");
  out = out.replace(/<\/?([a-zA-Z0-9]+)((?:[^>"']|"[^"]*"|'[^']*')*)>/g, (m, tag, attrs) => {
    tag = tag.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return "";
    if (m.startsWith("</")) return `</${tag}>`;
    const allow = ALLOWED_ATTR[tag] || [];
    let safe = "";
    const attrRe = /([a-zA-Z0-9-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let am;
    while ((am = attrRe.exec(attrs))) {
      const name = am[1].toLowerCase();
      let val = am[3] ?? am[4] ?? "";
      if (!allow.includes(name)) continue;
      if (name === "href" && !/^(https?:\/\/|\/|#|mailto:)/i.test(val)) continue;
      if (name === "src" && !/^https?:\/\//i.test(val)) continue;
      if ((name === "href" || name === "src") && /^\s*(javascript|data|vbscript):/i.test(val)) continue;
      if (name === "style") { val = sanitizeStyle(val); if (!val) continue; }
      if (name === "target") val = "_blank";
      val = val.replace(/"/g, "&quot;");
      safe += ` ${name}="${val}"`;
    }
    if (tag === "a" && /href=/.test(safe) && !/rel=/.test(safe)) safe += ` rel="noopener nofollow"`;
    if (tag === "img" && !/src=/.test(safe)) return "";
    return `<${tag}${safe}>`;
  });
  return out.replace(/\son\w+\s*=\s*("([^"]*)"|'([^']*)'|[^\s>]+)/gi, "").slice(0, 12000);
}

function cleanBlocks(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 60).map((b) => {
    if (b?.type === "image" && /^https?:\/\//i.test(b.value || "")) return { type: "image", value: clampStr(b.value, 500) };
    if (b?.type === "heading") return { type: "heading", value: clampStr(b.value, 160) };
    if (b?.type === "html") return { type: "html", value: sanitizeHtml(clampStr(b.value, 12000)) };
    return { type: "text", value: clampStr(b.value, 4000) };
  }).filter((b) => b.value);
}

async function loadAll() {
  const store = newsStore();
  const { blobs } = await store.list();
  return (await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })))).filter(Boolean);
}

const stripTags = (s) => String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const summary = (a) => ({
  id: a.id, slug: a.slug, title: a.title, banner: a.banner || null,
  authorName: a.authorName || "Gatherly", authorAvatar: a.authorAvatar || null,
  excerpt: a.excerpt || stripTags(a.blocks?.find((b) => b.type === "text" || b.type === "html")?.value || "").slice(0, 180),
  publishedAt: a.publishedAt || a.createdAt, createdAt: a.createdAt,
});

export default async (req) => {
  try { return await handler(req); }
  catch (e) { return json({ error: "Server error: " + (e?.message || "unknown") }, 500); }
};

async function handler(req) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const store = newsStore();

  if (action === "list") {
    const items = (await loadAll()).filter((a) => a.published)
      .sort((a, b) => new Date(b.publishedAt || b.createdAt) - new Date(a.publishedAt || a.createdAt));
    return json({ articles: items.map(summary) });
  }

  if (action === "get") {
    const slug = clampStr(url.searchParams.get("slug"), 80);
    const aid = clampStr(url.searchParams.get("id"), 60);
    const items = await loadAll();
    const a = items.find((x) => (slug && x.slug === slug) || (aid && x.id === aid));
    if (!a || !a.published) return json({ error: "Article not found." }, 404);
    return json({ article: a });
  }

  // ---- writes: executive only ----
  const user = await requireUser(req);
  if (!isExec(user)) return json({ error: "Executive only." }, 403);

  if (action === "admin-list") {
    const items = (await loadAll()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return json({ articles: items });
  }

  if (action === "save" && req.method === "POST") {
    const blocked = await guard(req, user, `news:${user.id}`, 20, 60, { kind: "spam", what: "Rapid news edits." });
    if (blocked) return blocked;
    const b = await req.json().catch(() => ({}));
    const title = clampStr(b.title, 160);
    if (!title) return json({ error: "A title is required." }, 400);
    const existing = b.id ? await store.get(clampStr(b.id, 60), { type: "json" }) : null;
    const wasPublished = existing?.published;
    const aid = existing?.id || id().slice(0, 10);
    const article = {
      id: aid,
      slug: existing?.slug || slugify(title),
      title,
      banner: /^https?:\/\//i.test(b.banner || "") ? clampStr(b.banner, 500) : (existing?.banner || null),
      authorName: clampStr(b.authorName, 60) || user.username,
      authorAvatar: /^https?:\/\//i.test(b.authorAvatar || "") ? clampStr(b.authorAvatar, 500) : (existing?.authorAvatar || null),
      excerpt: clampStr(b.excerpt, 200) || null,
      blocks: cleanBlocks(b.blocks),
      published: Boolean(b.published),
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      publishedAt: b.published ? (existing?.publishedAt || new Date().toISOString()) : null,
    };
    await store.setJSON(aid, article);
    await audit(user, existing ? "news.update" : "news.create", { id: aid, title, published: article.published });
    if (article.published && !wasPublished) {
      await postStaffEvent(brandEmbed({
        title: "News article published",
        description: `**${title}** is now live.`,
        color: 0x7fa8ff,
        thumbnail: article.banner || undefined,
      }));
    }
    return json({ ok: true, article });
  }

  if (action === "delete" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    await store.delete(clampStr(b.id, 60));
    await audit(user, "news.delete", { id: b.id });
    return json({ ok: true });
  }

  return json({ error: "Unknown action." }, 404);
}
