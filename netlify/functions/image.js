// /api/image - banner upload + serving.
// Event banners are enforced at exactly 1200x480 (2.5:1). Ad banners (kind=ad)
// are enforced at exactly 960x600 (16:10), matching the .ad-banner display
// everywhere on the site so an uploaded banner is never cropped or distorted.
// Dimensions are parsed from the file bytes server-side, so client checks
// cannot be bypassed.

import { json, requireUser, imagesStore, id, rateLimit } from "../lib/util.js";

const MAX_BYTES = 2 * 1024 * 1024;
const SPECS = {
  event: { w: 1200, h: 480 },
  ad: { w: 960, h: 600 },
};

function sniff(buf) {
  // PNG
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) {
    return { type: "image/png", w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  // JPEG: walk segments to SOF0/SOF2
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { type: "image/jpeg", h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
    return null;
  }
  // WebP (VP8 / VP8L / VP8X)
  if (buf.length > 30 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const fmt = buf.toString("ascii", 12, 16);
    if (fmt === "VP8X") {
      return {
        type: "image/webp",
        w: 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16)),
        h: 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16)),
      };
    }
    if (fmt === "VP8 ") {
      return { type: "image/webp", w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    }
    if (fmt === "VP8L") {
      const b = buf.readUInt32LE(21);
      return { type: "image/webp", w: 1 + (b & 0x3fff), h: 1 + ((b >> 14) & 0x3fff) };
    }
  }
  return null;
}

export default async (req) => {
  const url = new URL(req.url);
  const store = imagesStore();

  // ---- serve ----
  if (req.method === "GET") {
    const imgId = url.searchParams.get("id") || "";
    if (!/^[\w-]{1,40}$/.test(imgId)) return json({ error: "Bad id." }, 400);
    const meta = await store.getMetadata(imgId);
    const blob = await store.get(imgId, { type: "arrayBuffer" });
    if (!blob) return json({ error: "Not found." }, 404);
    return new Response(blob, {
      headers: {
        "Content-Type": meta?.metadata?.type || "image/jpeg",
        "Cache-Control": "public, max-age=86400",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
      },
    });
  }

  // ---- upload ----
  if (req.method === "POST") {
    const user = await requireUser(req);
    if (!user) return json({ error: "Log in first." }, 401);
    if (!(await rateLimit(`upload:${user.id}`, 15, 3600))) return json({ error: "Upload limit reached. Try again later." }, 429);

    const kind = SPECS[url.searchParams.get("kind")] ? url.searchParams.get("kind") : "event";
    const { w: REQUIRED_W, h: REQUIRED_H } = SPECS[kind];

    const buf = Buffer.from(await req.arrayBuffer());
    if (buf.length === 0) return json({ error: "Empty upload." }, 400);
    if (buf.length > MAX_BYTES) return json({ error: "Banner must be under 2MB." }, 413);

    const info = sniff(buf);
    if (!info) return json({ error: "File must be a JPG, PNG, or WebP image." }, 415);
    if (info.w !== REQUIRED_W || info.h !== REQUIRED_H) {
      return json({ error: `Banner must be exactly ${REQUIRED_W}x${REQUIRED_H}px. Yours is ${info.w}x${info.h}px.` }, 400);
    }

    const imgId = id();
    await store.set(imgId, buf, { metadata: { type: info.type, by: user.id, kind } });
    return json({ ok: true, id: imgId, url: `/api/image?id=${imgId}` });
  }

  return json({ error: "Unknown action." }, 404);
};
