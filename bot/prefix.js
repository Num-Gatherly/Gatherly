// bot/prefix.js
// Handles prefix commands. -join is open to everyone.
import { joinVoiceChannel } from "@discordjs/voice";
import { config } from "./config.js";

export async function handlePrefixCommand(message, client) {
  const args = message.content.slice(1).trim().split(/\s+/);
  const cmd = args.shift().toLowerCase();

  if (cmd === "join") {
    const voiceChannel = message.member?.voice?.channel;

    if (!voiceChannel) {
      return message.reply("You need to be in a voice channel to use `-join`.");
    }

    if (voiceChannel.id !== config.musicVoiceChannelId) {
      return message.reply(`I can only join <#${config.musicVoiceChannelId}>.`);
    }

    try {
      joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: message.guild.id,
        adapterCreator: message.guild.voiceAdapterCreator,
        selfDeaf: false,
      });
      return message.reply(`Joined **${voiceChannel.name}**! Use \`/play <song>\` to queue music.`);
    } catch (e) {
      console.error("[join]", e);
      return message.reply("Could not join that voice channel. Check my permissions.");
    }
  }
}
