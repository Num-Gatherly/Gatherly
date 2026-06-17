import { boot, api, esc } from "/js/app.js";
boot("/news");

const root = document.getElementById("newsRoot");
const params = new URLSearchParams(location.search);
const slug = params.get("slug") || params.get("article");

const fmtDate = (iso) => new Date(iso).toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" });

function authorRow(a) {
  const av = a.authorAvatar
    ? `<img src="${esc(a.authorAvatar)}" alt="" referrerpolicy="no-referrer" onerror="this.style.display='none'">`
    : `<span class="na-fallback">${esc((a.authorName || "G")[0].toUpperCase())}</span>`;
  return `<div class="news-author">${av}<span>${esc(a.authorName || "Gatherly")}</span></div>`;
}

function renderList(articles) {
  document.title = "News - Gatherly";
  if (!articles.length) {
    root.innerHTML = `<div class="card" style="text-align:center;padding:48px"><h3>No articles yet</h3><p style="margin-top:8px">Check back soon for updates from the Gatherly team.</p></div>`;
    return;
  }
  root.innerHTML = `<div class="news-grid">${articles.map((a) => `
    <article class="news-card" data-slug="${esc(a.slug)}">
      <div class="news-banner">${a.banner ? `<img src="${esc(a.banner)}" alt="" referrerpolicy="no-referrer" onerror="this.parentElement.style.display='none'">` : ""}</div>
      <div class="news-body">
        ${authorRow(a)}
        <h3>${esc(a.title)}</h3>
        <p class="news-excerpt">${esc(a.excerpt || "")}</p>
        <div class="news-date">${fmtDate(a.publishedAt)}</div>
      </div>
    </article>`).join("")}</div>`;
  root.querySelectorAll(".news-card").forEach((c) => c.addEventListener("click", () => { location.href = `/news?slug=${encodeURIComponent(c.dataset.slug)}`; }));
}

function renderArticle(a) {
  document.title = `${a.title} - Gatherly News`;
  const ntitle = document.getElementById("newsTitle"); if (ntitle) ntitle.textContent = a.title;
  const nintro = document.getElementById("newsIntro"); if (nintro) nintro.textContent = `By ${a.authorName || "Gatherly"} · ${fmtDate(a.publishedAt || a.createdAt)}`;
  const blocks = (a.blocks || []).map((b) => {
    if (b.type === "image") return `<img class="article-block-img" src="${esc(b.value)}" alt="" referrerpolicy="no-referrer" onerror="this.style.display='none'">`;
    if (b.type === "heading") return `<h3>${esc(b.value)}</h3>`;
    return `<p>${esc(b.value).replace(/\n/g, "<br>")}</p>`;
  }).join("");
  root.innerHTML = `
    <div class="article">
      <a href="/news" class="back-home">&larr; All news</a>
      ${a.banner ? `<img class="article-banner" src="${esc(a.banner)}" alt="" referrerpolicy="no-referrer" onerror="this.style.display='none'">` : ""}
      ${authorRow(a)}
      ${blocks || `<p>${esc(a.excerpt || "")}</p>`}
    </div>`;
}

(async () => {
  try {
    if (slug) {
      const { article } = await api(`/api/news?action=get&slug=${encodeURIComponent(slug)}`);
      renderArticle(article);
    } else {
      const { articles } = await api("/api/news?action=list");
      renderList(articles);
    }
  } catch (e) {
    root.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`;
  }
})();
