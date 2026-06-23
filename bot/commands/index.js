// bot/commands/index.js
import { config } from "../config.js";
import { handleGiveaway, handleGiveawayEnd, handleGiveawayReroll } from "../giveaway.js";
import { handleSay } from "./say.js";
import { handleMusicCommand } from "./music.js";

const MUSIC_COMMANDS = new Set([
  "play", "skip", "stop", "pause", "resume", "queue", "volume",
  "nowplaying", "shuffle", "loop", "seek", "remove", "move",
  "dj", "lyrics", "disconnect",
]);

const ALL_STAFF_COMMANDS = new Set([
  "giveaway", "giveaway-end", "giveaway-reroll", "say",
  ...MUSIC_COMMANDS,
]);

function hasStaffRole(member) {
  if (!member) return false;
  return config.staffRoles.some(r => member.roles.cache.has(r));
}

export async function handleSlashCommand(interaction, client) {
  const cmd = interaction.commandName;

  if (ALL_STAFF_COMMANDS.has(cmd) && !hasStaffRole(interaction.member)) {
    return interaction.reply({ content: "You do not have permission to use this command.", ephemeral: true });
  }

  if (cmd === "giveaway") return handleGiveaway(interaction, client);
  if (cmd === "giveaway-end") return handleGiveawayEnd(interaction, client);
  if (cmd === "giveaway-reroll") return handleGiveawayReroll(interaction, client);
  if (cmd === "say") return handleSay(interaction, client);
  if (MUSIC_COMMANDS.has(cmd)) return handleMusicCommand(interaction, client, cmd);
}
