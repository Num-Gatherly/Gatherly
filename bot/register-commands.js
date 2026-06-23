// bot/register-commands.js
// Run once: node register-commands.js
// Set GATHERLY_GUILD_ID for instant guild registration, or leave blank for global (1hr delay).

import { REST, Routes, SlashCommandBuilder } from "discord.js";

const commands = [
  new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Start a new giveaway")
    .addStringOption(o => o.setName("name").setDescription("Prize name").setRequired(true))
    .addIntegerOption(o => o.setName("days").setDescription("Duration - days").setMinValue(0))
    .addIntegerOption(o => o.setName("hours").setDescription("Duration - hours").setMinValue(0))
    .addIntegerOption(o => o.setName("minutes").setDescription("Duration - minutes").setMinValue(1))
    .addIntegerOption(o => o.setName("winners").setDescription("Number of winners").setMinValue(1).setMaxValue(20))
    .addStringOption(o => o.setName("x2role1").setDescription("Extra luck role ID 1"))
    .addStringOption(o => o.setName("x2role2").setDescription("Extra luck role ID 2"))
    .addStringOption(o => o.setName("x2role3").setDescription("Extra luck role ID 3"))
    .addUserOption(o => o.setName("sponsor").setDescription("Sponsoring user")),

  new SlashCommandBuilder()
    .setName("giveaway-end")
    .setDescription("Manually end a giveaway early")
    .addStringOption(o => o.setName("message_id").setDescription("Message ID of the giveaway").setRequired(true)),

  new SlashCommandBuilder()
    .setName("giveaway-reroll")
    .setDescription("Reroll winners for an ended giveaway")
    .addStringOption(o => o.setName("message_id").setDescription("Message ID of the ended giveaway").setRequired(true)),

  new SlashCommandBuilder()
    .setName("say")
    .setDescription("Send a message as Gatherly in any channel")
    .addChannelOption(o => o.setName("channel").setDescription("Channel to send in").setRequired(true))
    .addStringOption(o => o.setName("message").setDescription("Message to send").setRequired(true)),

  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play music in your voice channel")
    .addStringOption(o => o.setName("query").setDescription("Song name or YouTube URL").setRequired(true)),

  new SlashCommandBuilder().setName("skip").setDescription("Skip the current song"),
  new SlashCommandBuilder().setName("stop").setDescription("Stop music and clear the queue"),
  new SlashCommandBuilder().setName("pause").setDescription("Pause the current song"),
  new SlashCommandBuilder().setName("resume").setDescription("Resume playback"),
  new SlashCommandBuilder().setName("queue").setDescription("View the current music queue"),

  new SlashCommandBuilder()
    .setName("volume")
    .setDescription("Set playback volume (1-100)")
    .addIntegerOption(o => o.setName("level").setDescription("Volume level").setRequired(true).setMinValue(1).setMaxValue(100)),

  new SlashCommandBuilder().setName("nowplaying").setDescription("Show what is currently playing"),
  new SlashCommandBuilder().setName("shuffle").setDescription("Shuffle the queue"),

  new SlashCommandBuilder()
    .setName("loop")
    .setDescription("Toggle loop mode")
    .addStringOption(o => o.setName("mode").setDescription("Loop mode").setRequired(true)
      .addChoices(
        { name: "Off", value: "off" },
        { name: "Track", value: "track" },
        { name: "Queue", value: "queue" }
      )),

  new SlashCommandBuilder()
    .setName("seek")
    .setDescription("Seek to a position in the current song")
    .addIntegerOption(o => o.setName("seconds").setDescription("Position in seconds").setRequired(true).setMinValue(0)),

  new SlashCommandBuilder()
    .setName("remove")
    .setDescription("Remove a song from the queue by position")
    .addIntegerOption(o => o.setName("position").setDescription("Queue position (1-based)").setRequired(true).setMinValue(1)),

  new SlashCommandBuilder()
    .setName("move")
    .setDescription("Move a song to a different queue position")
    .addIntegerOption(o => o.setName("from").setDescription("Current position").setRequired(true).setMinValue(1))
    .addIntegerOption(o => o.setName("to").setDescription("New position").setRequired(true).setMinValue(1)),

  new SlashCommandBuilder()
    .setName("dj")
    .setDescription("Apply a DJ audio effect")
    .addStringOption(o => o.setName("effect").setDescription("Effect to apply").setRequired(true)
      .addChoices(
        { name: "Bass Boost", value: "bassboost" },
        { name: "Nightcore", value: "nightcore" },
        { name: "Vaporwave", value: "vaporwave" },
        { name: "8D Audio", value: "8d" },
        { name: "Karaoke", value: "karaoke" },
        { name: "Clear Effects", value: "clear" }
      )),

  new SlashCommandBuilder()
    .setName("lyrics")
    .setDescription("Get lyrics for the current or a specified song")
    .addStringOption(o => o.setName("song").setDescription("Song to search (leave blank for current)")),

  new SlashCommandBuilder().setName("disconnect").setDescription("Disconnect the bot from voice"),
].map(c => c.toJSON());

const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.GATHERLY_GUILD_ID;

if (!token || !clientId) {
  console.error("DISCORD_BOT_TOKEN and DISCORD_CLIENT_ID must be set.");
  process.exit(1);
}

const rest = new REST({ version: "10" }).setToken(token);

(async () => {
  try {
    console.log("Registering slash commands...");
    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
      console.log(`Registered ${commands.length} commands to guild ${guildId} (instant)`);
    } else {
      await rest.put(Routes.applicationCommands(clientId), { body: commands });
      console.log(`Registered ${commands.length} commands globally (up to 1hr to appear)`);
    }
  } catch (e) {
    console.error(e);
  }
})();
