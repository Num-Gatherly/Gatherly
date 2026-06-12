// /api/auth - Discord OAuth login, session management, server connection settings.

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

  // ✅ FIX: always use origin (prevents mismatches)
  const siteUrl = (process.env.SITE_URL || url.origin).replace(/\/$/, "");

  // ✅ FIX: build redirect URI safely
  const redirectUriObj = new URL("/api/auth", siteUrl);
  redirectUriObj.searchParams.set("action", "callback");
  const redirectUri = redirectUriObj.toString();

  // ---- start: send user to Discord ----
  if (action === "start") {
    if (!clientId || !clientSecret) {
      return redirect("/login?error=" + encodeURIComponent(
        "Discord login is not configured. Set env vars in Netlify."
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

  // ---- callback ----
  if (action === "callback") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    const cookieState =
      (req.headers.get("cookie") || "").match(/gatherly_state=([^;]+)/)?.[1];

    if (!code || !state || state !== cookieState) {
      return redirect("/login?error=" + encodeURIComponent("State mismatch. Try again."));
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
      return redirect("/login?error=" + encodeURIComponent(
        "Discord rejected login. Check redirect URL in Discord Developer Portal."
      ));
    }

    const tokens = await tokenRes.json();

    const infoRes = await fetch(USER_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!infoRes.ok) {
      return redirect("/login?error=" + encodeURIComponent("Failed to fetch Discord profile."));
    }

    const info = await infoRes.json();

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
      username: info.global_name || info.username,
      avatar,
      plan: existing.plan || "basic",
      updatedAt: new Date().toISOString(),
    });

    return redirect("/dashboard", {
      "Set-Cookie": makeSessionCookie(userId),
    });
  }

  // ---- me ----
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
      },
    });
  }

  // ---- logout ----
  if (action === "logout" && req.method === "POST") {
    return json({ ok: true }, 200, {
      "Set-Cookie": clearSessionCookie(),
    });
  }

  return json({ error: "Unknown action." }, 404);
};
