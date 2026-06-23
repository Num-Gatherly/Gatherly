// bot/index.js
import {
  Client, GatewayIntentBits, Partials, ActivityType,
} from "discord.js";
import { config } from "./config.js";
import { handleSlashCommand } from "./commands/index.js";
import { handlePrefixCommand } from "./prefix.js";
import { monitorMessage } from "./monitor.js";
import { startActivityTimer, resetActivityTimer } from "./activity.js";
import { checkExpiredGiveaways, loadGiveaways, trackReaction } from "./giveaway.js";

export const queues = new Map();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

client.once("ready", async () => {
  console.log(`[Gatherly Bot] Logged in as ${client.user.tag}`);

  client.user.setPresence({
    status: "online",
    activities: [{ name: config.statusUrl, type: ActivityType.Watching }],
  });

  await loadGiveaways(client);
  setInterval(() => checkExpiredGiveaways(client), 30_000);
  startActivityTimer(client);

  console.log("[Gatherly Bot] Ready.");
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  if (message.channelId === config.activityChannelId) {
    resetActivityTimer(client);
  }

  if (message.content.startsWith("-")) {
    await handlePrefixCommand(message, client).catch(console.error);
    return;
  }

  if (config.monitorChannels.includes(message.channelId)) {
    await monitorMessage(message).catch(console.error);
  }
});

client.on("interactionCreate", async (interaction) => {
  if (interaction.isCommand()) {
    await handleSlashCommand(interaction, client).catch(console.error);
  }
});

client.on("messageReactionAdd", async (reaction, user) => {
  if (user.bot) return;
  if (reaction.emoji.name !== config.giveawayEmoji) return;
  await trackReaction(reaction, user, "add").catch(console.error);
});

client.on("messageReactionRemove", async (reaction, user) => {
  if (user.bot) return;
  if (reaction.emoji.name !== config.giveawayEmoji) return;
  await trackReaction(reaction, user, "remove").catch(console.error);
});

client.login(config.token);
