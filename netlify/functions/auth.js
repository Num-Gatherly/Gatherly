// /api/auth - Discord OAuth login, session management
import {
  json, redirect, usersStore, requireUser,
  makeSessionCookie, clearSessionCookie,
} from "../lib/util.js";
import crypto from "node:crypto";

const AUTH_URL = "https://discord.com/oauth2/authorize";
const TOKEN_URL = "https://discord.com/api/oauth2/token";
const USER_URL = "https://discord.com/api/users/@me";

export default async (req) => {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  const SITE_URL = (process.env.SITE_URL || "https://gatherly-erlc.xyz").replace(/\/$/, "");
  const redirectUri = `${SITE_URL}/api/auth?action=callback`;

  if (action === "start") {
    if (!clientId || !clientSecret) return redirect("/login?error=Discord not configured");
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

  if (action === "callback") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const cookieState = (req.headers.get("cookie") || "").match(/gatherly_state=([^;]+)/)?.[1];
    if (!code || !state || state !== cookieState) return redirect("/login?error=Invalid state");

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
    if (!tokenRes.ok) return redirect("/login?error=Discord rejected login (redirect mismatch)");

    const tokens = await tokenRes.json();
    const infoRes = await fetch(USER_URL, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    if (!infoRes.ok) return redirect("/login?error=Failed to fetch Discord user");

    const info = await infoRes.json();
    const store = usersStore();
    const userId = `dsc_${info.id}`;

    // avatar hash only - full URL built client-side so it can vary by size.
    const avatarHash = info.avatar || null;

    const existing = (await store.get(userId, { type: "json" })) || {};
    await store.setJSON(userId, {
      ...existing,
      id: userId,
      discordId: info.id,
      // username = real unique Discord username (e.g. johndoe or johndoe#1234 legacy).
      // globalName = display name the user sets (can be anything, changes often).
      username: info.username,
      globalName: info.global_name || info.username,
      avatar: avatarHash,
      updatedAt: new Date().toISOString(),
      createdAt: existing.createdAt || new Date().toISOString(),
    });

    return redirect("/dashboard", { "Set-Cookie": makeSessionCookie(userId) });
  }

  if (action === "me") {
    const user = await requireUser(req);
    if (!user) return json({ user: null }, 401);
    return json({ user });
  }

  if (action === "logout" && req.method === "POST") {
    return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
  }

  return json({ error: "Unknown action" }, 404);
};
