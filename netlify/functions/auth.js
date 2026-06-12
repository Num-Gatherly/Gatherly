// /api/auth - Discord OAuth login, session management, server connection settings.
//
// Required Netlify env vars:
//   DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET  (from discord.com/developers → your app → OAuth2)
//   SESSION_SECRET                            (any long random string)
//   SITE_URL                                  (e.g. https://gatherly-erlc.netlify.app - no trailing slash)
//
// Discord OAuth app redirect URL must be set (exactly) to:
//   {SITE_URL}/api/auth?action=callback

import {
  json, redirect, usersStore, eventsStore, requireUser,
  makeSessionCookie, clearSessionCookie, encrypt,
} from "../lib/util.js";

const AUTH_URL = "https://discord.com/oauth2/authorize";
const TOKEN_URL = "https://discord.com/api/oauth2/token";
const USER_URL = "https://discord.com/api/users/@me";

export default async (req) => {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  const siteUrl = (process.env.SITE_URL || `${url.protocol}//${url.host}`).replace(/\/$/, "");
  const redirectUri = `${siteUrl}/api/auth?action=callback`;

  // ---- start: send user to Discord ----
  if (action === "start") {
    if (!clientId || !clientSecret) {
      return redirect("/login?error=" + encodeURIComponent(
        "Discord login is not configured yet. Admin: set DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET in Netlify environment variables."
      ));
    }
    const state = crypto.randomUUID();
    const authorize = `${AUTH_URL}?` + new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "identify",
      state,
      prompt: "consent",
    });
    return redirect(authorize, {
      "Set-Cookie": `gatherly_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    });
  }

  // ---- callback: exchange code, create session ----
  if (action === "callback") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const cookieState = (req.headers.get("cookie") || "").match(/gatherly_state=([^;]+)/)?.[1];
    if (!code || !state || state !== cookieState) {
      return redirect("/login?error=" + encodeURIComponent("Login was cancelled or the state check failed. Try again."));
    }

    const tokenRes = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    });
    if (!tokenRes.ok) {
      return redirect("/login?error=" + encodeURIComponent("Discord rejected the login exchange. Check the OAuth app's redirect URL matches exactly."));
    }
    const tokens = await tokenRes.json();

    const infoRes = await fetch(USER_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!infoRes.ok) {
      return redirect("/login?error=" + encodeURIComponent("Could not fetch your Discord profile."));
    }
    const info = await infoRes.json(); // { id, username, global_name, avatar, ... }

    const store = usersStore();
    const userId = `dsc_${info.id}`;
    const existing = (await store.get(userId, { type: "json" })) || {};
    const avatar = info.avatar
      ? `https://cdn.discordapp.com/avatars/${info.id}/${info.avatar}.png`
      : null;
    await store.setJSON(userId, {
      ...existing,
      id: userId,
      discordId: info.id,
      username: info.global_name || info.username || `user${info.id}`,
      avatar,
      plan: existing.plan || "basic",
      updatedAt: new Date().toISOString(),
    });

    return redirect("/dashboard", { "Set-Cookie": makeSessionCookie(userId) });
  }

  // ---- me: current session user (safe fields only) ----
  if (action === "me") {
    const user = await requireUser(req);
    if (!user) return json({ user: null }, 401);
    return json({
      user: {
        id: user.id,
        username: user.username,
        avatar: user.avatar,
        plan: user.plan,
        role: user.role || null,
        adminRequest: user.adminRequest || null,
        dmOptIn: Boolean(user.dmOptIn),
        hasErlcKey: Boolean(user.erlcKeyEnc),
        hasWebhook: Boolean(user.discordWebhook),
      },
    });
  }

  // ---- logout ----
  if (action === "logout" && req.method === "POST") {
    return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
  }

  // ---- connection: save ER:LC key (encrypted) + Discord webhook ----
  if (action === "connection" && req.method === "POST") {
    const user = await requireUser(req);
    if (!user) return json({ error: "Log in first." }, 401);
    const body = await req.json().catch(() => ({}));

    const update = { ...user, updatedAt: new Date().toISOString() };
    if (body.dmOptIn !== undefined) update.dmOptIn = Boolean(body.dmOptIn);
    if (body.erlcKey) update.erlcKeyEnc = encrypt(String(body.erlcKey).trim());
    if (body.discordWebhook !== undefined) {
      const wh = String(body.discordWebhook || "").trim();
      if (wh && !wh.startsWith("https://discord.com/api/webhooks/")) {
        return json({ error: "Webhook must be a discord.com/api/webhooks URL." }, 400);
      }
      update.discordWebhook = wh || null;
    }
    await usersStore().setJSON(user.id, update);
    return json({ ok: true });
  }

  // ---- disconnect: clear stored ER:LC key and/or webhook ----
  if (action === "disconnect" && req.method === "POST") {
    const user = await requireUser(req);
    if (!user) return json({ error: "Log in first." }, 401);
    const body = await req.json().catch(() => ({}));
    const update = { ...user, updatedAt: new Date().toISOString() };
    if (body.erlcKey) update.erlcKeyEnc = null;
    if (body.discordWebhook) update.discordWebhook = null;
    await usersStore().setJSON(user.id, update);
    return json({ ok: true });
  }

  // ---- delete-account: remove the user record and all their events ----
  if (action === "delete-account" && req.method === "POST") {
    const user = await requireUser(req);
    if (!user) return json({ error: "Log in first." }, 401);
    const evStore = eventsStore();
    const { blobs } = await evStore.list();
    for (const b of blobs) {
      const ev = await evStore.get(b.key, { type: "json" });
      if (ev && ev.hostId === user.id) await evStore.delete(b.key);
    }
    await usersStore().delete(user.id);
    return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
  }
  // ---- claim-executive: become an executive with the setup code ----
  // Admin/role system: an "executive" can promote/demote admins. The first
  // executive claims the role by entering the EXEC_SETUP_CODE env var value.
  if (action === "claim-executive" && req.method === "POST") {
    const user = await requireUser(req);
    if (!user) return json({ error: "Log in first." }, 401);
    const { code } = await req.json().catch(() => ({}));
    const expected = process.env.EXEC_SETUP_CODE;
    if (!expected) return json({ error: "Executive setup isn't configured. Admin: set EXEC_SETUP_CODE in Netlify env vars." }, 400);
    if (!code || code !== expected) return json({ error: "Incorrect code." }, 403);
    await usersStore().setJSON(user.id, { ...user, role: "executive", updatedAt: new Date().toISOString() });
    return json({ ok: true, role: "executive" });
  }

  // ---- staff: list all admins/executives (staff only) ----
  if (action === "staff") {
    const user = await requireUser(req);
    if (!user || (user.role !== "admin" && user.role !== "executive")) {
      return json({ error: "Admin access required." }, 403);
    }
    const store = usersStore();
    const { blobs } = await store.list();
    const users = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
    const staff = users.filter((u) => u && (u.role === "admin" || u.role === "executive"))
      .map((u) => ({ id: u.id, username: u.username, role: u.role }));
    return json({ staff });
  }

  // ---- set-role: executives promote/demote admins ----
  if (action === "set-role" && req.method === "POST") {
    const user = await requireUser(req);
    if (!user || user.role !== "executive") return json({ error: "Executive access required." }, 403);
    const { username, role } = await req.json().catch(() => ({}));
    if (!username || !["admin", "executive", "none"].includes(role)) {
      return json({ error: "Provide a username and a role of 'admin', 'executive', or 'none'." }, 400);
    }
    const store = usersStore();
    const { blobs } = await store.list();
    let target = null;
    for (const b of blobs) {
      const u = await store.get(b.key, { type: "json" });
      if (u && u.username.toLowerCase() === String(username).toLowerCase()) { target = u; break; }
    }
    if (!target) return json({ error: "No user found with that username - they need to have logged in at least once." }, 404);
    if (target.role === "executive") return json({ error: "You can't change another executive's role." }, 403);
    const newRole = role === "none" ? null : role;
    await store.setJSON(target.id, { ...target, role: newRole, adminRequest: null, updatedAt: new Date().toISOString() });
    return json({ ok: true, username: target.username, role: newRole });
  }


  // ---- request-admin: any logged-in user can ask; executives accept/deny ----
  if (action === "request-admin" && req.method === "POST") {
    const user = await requireUser(req);
    if (!user) return json({ error: "Log in first." }, 401);
    if (user.role) return json({ error: "You already have a staff role." }, 400);
    if (user.adminRequest === "pending") return json({ error: "Your request is already pending." }, 400);
    await usersStore().setJSON(user.id, { ...user, adminRequest: "pending", adminRequestAt: new Date().toISOString() });
    return json({ ok: true });
  }

  if (action === "admin-requests") {
    const user = await requireUser(req);
    if (!user || user.role !== "executive") return json({ error: "Executive access required." }, 403);
    const store = usersStore();
    const { blobs } = await store.list();
    const users = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
    const pending = users.filter((u) => u && u.adminRequest === "pending")
      .map((u) => ({ id: u.id, username: u.username, requestedAt: u.adminRequestAt }));
    return json({ requests: pending });
  }

  if (action === "admin-request-decide" && req.method === "POST") {
    const user = await requireUser(req);
    if (!user || user.role !== "executive") return json({ error: "Executive access required." }, 403);
    const { userId, accept } = await req.json().catch(() => ({}));
    const target = await usersStore().get(userId || "", { type: "json" });
    if (!target || target.adminRequest !== "pending") return json({ error: "No pending request for that user." }, 404);
    await usersStore().setJSON(target.id, {
      ...target,
      role: accept ? "admin" : target.role || null,
      adminRequest: accept ? null : "denied",
      updatedAt: new Date().toISOString(),
    });
    return json({ ok: true, username: target.username, accepted: Boolean(accept) });
  }

  return json({ error: "Unknown action." }, 404);
};
