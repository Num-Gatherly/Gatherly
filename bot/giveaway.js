// bot/giveaway.js
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "giveaways.json");

const giveaways = new Map();

export async function loadGiveaways(client) {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const arr = JSON.parse(raw);
    for (const g of arr) giveaways.set(g.messageId, g);
    console.log(`[Giveaway] Loaded ${giveaways.size} giveaway(s) from disk.`);
  } catch {
    // No file yet - fine on first run
  }
}

async function saveGiveaways() {
  await fs.writeFile(DATA_FILE, JSON.stringify([...giveaways.values()], null, 2));
}

function countTotalEntries(g) {
  let count = 0;
  for (const uid of (g.entries || [])) {
    count += (g.x2EntryMap || {})[uid] ? 2 : 1;
  }
  return count;
}

function buildGiveawayBody(g, ended = false) {
  const durationText = ended
    ? `*Ended* <t:${Math.floor(g.endsAt / 1000)}:R>`
    : `<t:${Math.floor(g.endsAt / 1000)}:R> (ends <t:${Math.floor(g.endsAt / 1000)}:F>)`;

  const totalEntries = countTotalEntries(g);

  let x2Section = "";
  if (g.x2Roles && g.x2Roles.length > 0) {
    x2Section = `## <:unknown:1518882409968308324> **Extra Luck (x2)**\n\n` +
      g.x2Roles.map(r => `<:unknown:1518881680168062976>  <@&${r}>`).join("\n") + "\n\n";
  }

  const sponsorSection = g.sponsorId
    ? `<:unknown:1518842601657335949> Thanks to <@${g.sponsorId}> for sponsoring this giveaway! If you would like to sponsor a giveaway, contact us [here](https://discord.com/channels/${config.guildId}/${config.supportChannelId})`
    : "";

  const mainContent = [
    `> <:unknown:1518885110554955857> **Duration**: ${durationText}`,
    `> <:unknown:1518841888969330779> **Hosted By:** <@${g.hostId}>`,
    `> <:unknown:1518842038164918383> **Winners:** ${g.winners}`,
    `## <:unknown:1518882147576840202> **Entries**`,
    `> \`${totalEntries}\``,
    x2Section,
    `> <:unknown:1518884847198933072> Make sure you check out <id:customize> to claim the <@1518886885693460542> role!\n`,
  ].join("\n");

  const innerComponents = [
    { type: 10, content: `# <:unknown:1518844273011720352>  ${ended ? `~~${g.name}~~ - ENDED` : g.name}` },
    { type: 14, spacing: 1 },
    { type: 10, content: mainContent },
    { type: 14 },
  ];

  if (sponsorSection) {
    innerComponents.push({ type: 10, content: sponsorSection });
  }

  return { flags: 32768, components: [{ type: 17, components: innerComponents }] };
}

export async function trackReaction(reaction, user, type) {
  const g = giveaways.get(reaction.message.id);
  if (!g || g.ended) return;

  if (!g.entries) g.entries = [];
  if (!g.x2EntryMap) g.x2EntryMap = {};

  if (type === "add") {
    if (!g.entries.includes(user.id)) {
      g.entries.push(user.id);
      try {
        const member = await reaction.message.guild.members.fetch(user.id);
        const hasX2 = g.x2Roles && g.x2Roles.some(r => member.roles.cache.has(r));
        if (hasX2) g.x2EntryMap[user.id] = true;
      } catch {}
    }
  } else {
    g.entries = g.entries.filter(id => id !== user.id);
    delete g.x2EntryMap[user.id];
  }

  await saveGiveaways();

  try {
    const msg = await reaction.message.channel.messages.fetch(reaction.message.id);
    await msg.edit(buildGiveawayBody(g, false));
  } catch (e) {
    console.error("[Giveaway] Failed to update entry count:", e.message);
  }
}

export async function checkExpiredGiveaways(client) {
  const now = Date.now();
  for (const [messageId, g] of giveaways) {
    if (!g.ended && g.endsAt <= now) {
      await endGiveaway(client, g, messageId).catch(console.error);
    }
  }
}

async function endGiveaway(client, g, messageId) {
  g.ended = true;
  await saveGiveaways();

  try {
    const channel = await client.channels.fetch(g.channelId);
    const msg = await channel.messages.fetch(messageId);
    await msg.edit(buildGiveawayBody(g, true));
    await drawWinners(client, g, channel);
  } catch (e) {
    console.error("[Giveaway] Failed to end:", e.message);
  }
}

async function drawWinners(client, g, channel) {
  const pool = [];
  for (const uid of (g.entries || [])) {
    pool.push(uid);
    if ((g.x2EntryMap || {})[uid]) pool.push(uid);
  }

  if (pool.length === 0) {
    await channel.send({
      flags: 32768,
      components: [{ type: 17, components: [{ type: 10, content: `No valid entries for **${g.name}**. No winner could be drawn.` }] }],
    });
    return;
  }

  const shuffled = pool.sort(() => Math.random() - 0.5);
  const winners = [];
  const seen = new Set();
  for (const uid of shuffled) {
    if (!seen.has(uid)) {
      seen.add(uid);
      winners.push(uid);
      if (winners.length >= g.winners) break;
    }
  }

  g.pastWinners = winners;
  await saveGiveaways();

  for (const winnerId of winners) {
    const winMsg = {
      flags: 32768,
      components: [{
        type: 17,
        components: [
          { type: 10, content: `<:unknown:1518842038164918383> Congratulations <@${winnerId}>, you won the giveaway for **${g.name}!**` },
          { type: 14 },
          { type: 10, content: `-# > \`-\` Your prize has either been automatically added to your account, or you can claim it [here](https://discord.com/channels/${config.guildId}/${config.supportChannelId})` },
        ],
      }],
    };

    await channel.send(winMsg);

    try {
      const user = await client.users.fetch(winnerId);
      await user.send(winMsg);
    } catch {
      // DMs closed - that is fine
    }
  }
}

// --- Slash command handlers ---

export async function handleGiveaway(interaction, client) {
  await interaction.deferReply({ ephemeral: true });

  const name = interaction.options.getString("name");
  const days = interaction.options.getInteger("days") || 0;
  const hours = interaction.options.getInteger("hours") || 0;
  const minutes = interaction.options.getInteger("minutes") || 0;
  const winners = interaction.options.getInteger("winners") || 1;
  const sponsor = interaction.options.getUser("sponsor");
  const x2Roles = ["x2role1", "x2role2", "x2role3"].map(k => interaction.options.getString(k)).filter(Boolean);

  const totalMs = (days * 86400 + hours * 3600 + minutes * 60) * 1000;
  if (totalMs < 60000) return interaction.editReply("Duration must be at least 1 minute.");

  const g = {
    name,
    hostId: interaction.user.id,
    channelId: interaction.channelId,
    winners,
    endsAt: Date.now() + totalMs,
    x2Roles,
    sponsorId: sponsor?.id || null,
    entries: [],
    x2EntryMap: {},
    ended: false,
    messageId: null,
    pastWinners: [],
  };

  try {
    const msg = await interaction.channel.send(buildGiveawayBody(g, false));
    await msg.react(config.giveawayEmoji);
    g.messageId = msg.id;
    giveaways.set(msg.id, g);
    await saveGiveaways();
    await interaction.editReply(`Giveaway **${name}** started! Ends <t:${Math.floor(g.endsAt / 1000)}:R>.`);
  } catch (e) {
    console.error("[Giveaway] Post failed:", e);
    await interaction.editReply(`Failed to post giveaway: ${e.message}`);
  }
}

export async function handleGiveawayEnd(interaction, client) {
  await interaction.deferReply({ ephemeral: true });
  const messageId = interaction.options.getString("message_id");
  const g = giveaways.get(messageId);
  if (!g) return interaction.editReply("No active giveaway found with that message ID.");
  if (g.ended) return interaction.editReply("That giveaway has already ended.");
  await endGiveaway(client, g, messageId);
  await interaction.editReply("Giveaway ended and winners drawn.");
}

export async function handleGiveawayReroll(interaction, client) {
  await interaction.deferReply({ ephemeral: true });
  const messageId = interaction.options.getString("message_id");
  const g = giveaways.get(messageId);
  if (!g) return interaction.editReply("No giveaway found with that message ID.");
  if (!g.ended) return interaction.editReply("That giveaway has not ended yet.");
  const channel = await client.channels.fetch(g.channelId);
  await drawWinners(client, g, channel);
  await interaction.editReply("Winners rerolled.");
}
