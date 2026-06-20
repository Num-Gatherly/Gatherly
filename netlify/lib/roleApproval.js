// netlify/lib/roleApproval.js
// Every grant of admin/executive, and every removal of admin/executive,
// goes through an approval step instead of applying instantly. A pending
// request is stored, a Components V2 DM with Accept/Deny buttons is sent to
// a single fixed approver, and the role change only actually happens once
// that DM is acted on.
//
// Covers both ways a role can change:
//   - "set-role": an exec directly setting another user's role in the
//     Control Room user list (grant OR removal).
//   - "redeem-code": a user redeeming a pre-generated access code (always a
//     grant of "admin", never executive, never a removal).
import {
  usersStore, roleRequestsStore, codesStore, discordBotFetch, audit, id,
} from "./util.js";
import { text, separator, container, actionRow, actionButton, BSTYLE, GATHERLY_EMOJI_TAG, V2_FLAG } from "./broadcast.js";

export const ROLE_APPROVER_DISCORD_ID = process.env.ROLE_APPROVER_DISCORD_ID || "758444217600704535";

const roleLabel = (r) => (r === "executive" ? "Executive" : r === "admin" ? "Admin" : "no role (removed)");

/* =========================================================================
   PENDING REQUEST STORAGE
   ========================================================================= */
export async function getRoleRequest(reqId) {
  return roleRequestsStore().get(reqId, { type: "json" });
}
async function saveRoleRequest(rec) {
  await roleRequestsStore().setJSON(rec.id, rec);
}

/* =========================================================================
   APPROVAL DM
   ========================================================================= */
function approvalPayload(rec) {
  const isRemoval = !rec.requestedRole;
  const blocks = [
    text([
      `# ${GATHERLY_EMOJI_TAG} Role change request`,
      `> \`-\` **${rec.targetUsername}** is being ${isRemoval ? "removed from" : "granted"} **${roleLabel(rec.requestedRole)}**`,
      `> \`-\` Currently: ${roleLabel(rec.previousRole)}`,
    ].join("\n")),
    separator(),
    text([
      `\`-\` Requested by: ${rec.requestedByUsername}`,
      `\`-\` Method: ${rec.kind === "redeem-code" ? "Access code redemption" : "Direct role change"}`,
      `\`-\` Requested: <t:${Math.floor(new Date(rec.createdAt).getTime() / 1000)}:R>`,
    ].join("\n")),
    separator(),
    text("-# Accept applies the change immediately. Deny discards this request, nothing changes."),
  ];
  const buttons = [
    actionButton("Accept", `role:approve:${rec.id}`, BSTYLE.SUCCESS),
    actionButton("Deny", `role:deny:${rec.id}`, BSTYLE.DANGER),
  ];
  return {
    flags: V2_FLAG,
    components: [container(blocks, isRemoval ? 0xff7a7a : 0x7fa8ff), actionRow(buttons)],
  };
}

async function sendApprovalDm(rec) {
  if (!process.env.DISCORD_BOT_TOKEN) return { ok: false, reason: "bot-not-configured" };
  try {
    const ch = await discordBotFetch("/users/@me/channels", { method: "POST", body: JSON.stringify({ recipient_id: ROLE_APPROVER_DISCORD_ID }) });
    if (!ch.ok) return { ok: false, reason: `discord-${ch.status}` };
    const { id: channelId } = await ch.json();
    const r = await discordBotFetch(`/channels/${channelId}/messages`, { method: "POST", body: JSON.stringify(approvalPayload(rec)) });
    if (!r.ok) {
      let detail = "";
      try { detail = await r.text(); } catch {}
      return { ok: false, reason: `discord-${r.status}`, detail };
    }
    const m = await r.json();
    return { ok: true, messageId: m.id, channelId };
  } catch (e) { return { ok: false, reason: "network-error", detail: e?.message || String(e) }; }
}

/* =========================================================================
   CREATING REQUESTS
   ========================================================================= */
// Direct set-role from the Control Room user list. `requestedRole` is
// "admin" | "executive" | null (null = removal back to no special role).
export async function requestSetRole(target, requestedRole, requestedBy) {
  const rec = {
    id: id(),
    kind: "set-role",
    targetUserId: target.id,
    targetUsername: target.username,
    previousRole: target.role || null,
    requestedRole: requestedRole || null,
    requestedBy: requestedBy.id,
    requestedByUsername: requestedBy.username,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  await saveRoleRequest(rec);
  const dm = await sendApprovalDm(rec);
  rec.dmOk = dm.ok;
  if (!dm.ok) rec.dmFailReason = dm.reason;
  await saveRoleRequest(rec);
  await audit(requestedBy, "role.request-created", { targetId: target.id, targetUsername: target.username, requestedRole, kind: "set-role", dmOk: dm.ok });
  return rec;
}

// Access-code redemption. The code itself is validated by the caller before
// this runs, this just parks the grant behind approval instead of applying
// it, the code is only actually consumed (marked redeemed) on Accept.
export async function requestCodeRedemption(target, codeRec, codeStr) {
  const rec = {
    id: id(),
    kind: "redeem-code",
    targetUserId: target.id,
    targetUsername: target.username,
    previousRole: target.role || null,
    requestedRole: codeRec.role === "executive" ? "executive" : "admin",
    requestedBy: target.id,
    requestedByUsername: target.username,
    status: "pending",
    createdAt: new Date().toISOString(),
    codeHash: codeRec.hash,
  };
  await saveRoleRequest(rec);
  const dm = await sendApprovalDm(rec);
  rec.dmOk = dm.ok;
  if (!dm.ok) rec.dmFailReason = dm.reason;
  await saveRoleRequest(rec);
  await audit(target, "role.request-created", { targetId: target.id, targetUsername: target.username, requestedRole: rec.requestedRole, kind: "redeem-code", dmOk: dm.ok });
  return rec;
}

/* =========================================================================
   RESOLVING REQUESTS (called from the interactions endpoint)
   ========================================================================= */
export async function approveRoleRequest(reqId, approverDiscordId) {
  const rec = await getRoleRequest(reqId);
  if (!rec) return { ok: false, reason: "not-found" };
  if (rec.status !== "pending") return { ok: false, reason: "already-resolved", rec };

  const uStore = usersStore();
  const target = await uStore.get(rec.targetUserId, { type: "json" });
  if (!target) {
    rec.status = "denied"; rec.resolvedAt = new Date().toISOString(); rec.resolvedReason = "target-missing";
    await saveRoleRequest(rec);
    return { ok: false, reason: "target-missing", rec };
  }

  await uStore.setJSON(rec.targetUserId, { ...target, role: rec.requestedRole || null, updatedAt: new Date().toISOString() });

  // Code redemptions only get consumed once actually approved, a denied
  // request leaves the code untouched so it isn't burned for nothing.
  if (rec.kind === "redeem-code" && rec.codeHash) {
    const codeRecNow = await codesStore().get(rec.codeHash, { type: "json" });
    if (codeRecNow) {
      codeRecNow.redemptions = codeRecNow.redemptions || [];
      codeRecNow.redemptions.push({ userId: rec.targetUserId, username: rec.targetUsername, at: new Date().toISOString() });
      codeRecNow.lastRedeemedAt = new Date().toISOString();
      await codesStore().setJSON(rec.codeHash, codeRecNow);
    }
  }

  rec.status = "approved";
  rec.resolvedAt = new Date().toISOString();
  rec.resolvedBy = approverDiscordId;
  await saveRoleRequest(rec);
  await audit({ id: "system", username: "Role approval" }, "role.approved", {
    targetId: rec.targetUserId, targetUsername: rec.targetUsername, requestedRole: rec.requestedRole, kind: rec.kind,
  });
  return { ok: true, rec };
}

export async function denyRoleRequest(reqId, approverDiscordId) {
  const rec = await getRoleRequest(reqId);
  if (!rec) return { ok: false, reason: "not-found" };
  if (rec.status !== "pending") return { ok: false, reason: "already-resolved", rec };

  rec.status = "denied";
  rec.resolvedAt = new Date().toISOString();
  rec.resolvedBy = approverDiscordId;
  await saveRoleRequest(rec);
  await audit({ id: "system", username: "Role approval" }, "role.denied", {
    targetId: rec.targetUserId, targetUsername: rec.targetUsername, requestedRole: rec.requestedRole, kind: rec.kind,
  });
  return { ok: true, rec };
}
