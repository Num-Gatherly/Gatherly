// /api/news — Gatherly news / blog.
//   Public:   list                 -> published articles (newest first)
//             get?slug= | ?id=      -> a single published article (full body)
//   Executive (Control Room -> News):
//             save (POST)           -> create or update an article
//             delete (POST)         -> remove an article
//             admin-list            -> all articles incl. drafts
//
// Articles are built from ordered blocks so images can sit between paragraphs,
// like a real reporting document.
import {
  json, requireUser, isExec, newsStore, audit, clampStr, id, guard,
  postStaffEvent, brandEmbed,
} from "../lib/util.js";

const slugify = (s) => clampStr(s, 80).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || id().slice(0, 8);

// Sanitise editor blocks: text/heading keep plain text; image keeps an https URL.
function cleanBlocks(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 60).map((b) => {
    if (b?.type === "image" && /^https?:\/\//i.test(b.value || "")) return { type: "image", value: clampStr(b.value, 500) };
    if (b?.type === "heading") return { type: "heading", value: clampStr(b.value, 160) };
    return { type: "text", value: clampStr(b.value, 4000) };
  }).filter((b) => b.value);
}

async function loadAll() {
  const store = newsStore();
  const { blobs } = await store.list();
  return (await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })))).filter(Boolean);
}

const summary = (a) => ({
  id: a.id, slug: a.slug, title: a.title, banner: a.banner || null,
  authorName: a.authorName || "Gatherly", authorAvatar: a.authorAvatar || null,
  excerpt: a.excerpt || (a.blocks?.find((b) => b.type === "text")?.value || "").slice(0, 180),
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
