// bot/commands/music.js
import {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, getVoiceConnection,
} from "@discordjs/voice";
import { EmbedBuilder } from "discord.js";
import playdl from "play-dl";
import { queues } from "../index.js";
import { config } from "../config.js";

function getQueue(guildId) {
  if (!queues.has(guildId)) {
    queues.set(guildId, {
      connection: null,
      player: null,
      tracks: [],
      current: null,
      volume: 100,
      loop: "off",
      effect: null,
    });
  }
  return queues.get(guildId);
}

async function ensureVoiceConnection(interaction) {
  const voiceChannel = interaction.member?.voice?.channel;

  if (!voiceChannel) {
    await interaction.editReply("You need to be in a voice channel first.");
    return null;
  }

  if (voiceChannel.id !== config.musicVoiceChannelId) {
    await interaction.editReply(`I can only play music in <#${config.musicVoiceChannelId}>. Join that channel first.`);
    return null;
  }

  const q = getQueue(interaction.guildId);

  if (!q.connection) {
    q.connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: interaction.guildId,
      adapterCreator: interaction.guild.voiceAdapterCreator,
      selfDeaf: false,
    });
  }

  return q;
}

function formatDuration(sec) {
  if (!sec) return "Live";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function nowPlayingEmbed(track, q) {
  return new EmbedBuilder()
    .setColor(0x7fa8ff)
    .setTitle("Now Playing")
    .setDescription(`**[${track.title}](${track.url})**`)
    .addFields(
      { name: "Duration", value: formatDuration(track.durationSec), inline: true },
      { name: "Requested by", value: `<@${track.requestedBy}>`, inline: true },
      { name: "Volume", value: `${q.volume}%`, inline: true },
      { name: "Loop", value: q.loop, inline: true },
      { name: "Effect", value: q.effect || "None", inline: true },
      { name: "Queue", value: `${q.tracks.length} track(s) remaining`, inline: true },
    )
    .setThumbnail(track.thumbnail || null)
    .setFooter({ text: "Gatherly Music" });
}

async function playNext(guildId) {
  const q = queues.get(guildId);
  if (!q) return;

  if (q.loop === "track" && q.current) {
    q.tracks.unshift(q.current);
  } else if (q.loop === "queue" && q.current) {
    q.tracks.push(q.current);
  }

  if (q.tracks.length === 0) {
    q.current = null;
    return;
  }

  q.current = q.tracks.shift();

  try {
    const stream = await playdl.stream(q.current.url, { quality: 2 });
    const resource = createAudioResource(stream.stream, {
      inputType: stream.type,
      inlineVolume: true,
    });
    resource.volume?.setVolume(q.volume / 100);
    q.player.play(resource);
  } catch (e) {
    console.error("[Music] Stream error:", e.message);
    await playNext(guildId);
  }
}

export async function handleMusicCommand(interaction, client, cmd) {
  await interaction.deferReply();

  const q = getQueue(interaction.guildId);

  // --- Commands that don't require voice ---

  if (cmd === "queue") {
    if (!q.current && q.tracks.length === 0) return interaction.editReply("The queue is empty.");
    const lines = [];
    if (q.current) lines.push(`**Now playing:** ${q.current.title} [${formatDuration(q.current.durationSec)}]`);
    q.tracks.slice(0, 20).forEach((t, i) => lines.push(`${i + 1}. ${t.title} [${formatDuration(t.durationSec)}]`));
    if (q.tracks.length > 20) lines.push(`...and ${q.tracks.length - 20} more.`);
    return interaction.editReply(lines.join("\n"));
  }

  if (cmd === "nowplaying") {
    if (!q.current) return interaction.editReply("Nothing is playing right now.");
    return interaction.editReply({ embeds: [nowPlayingEmbed(q.current, q)] });
  }

  // --- Play ---

  if (cmd === "play") {
    const qConn = await ensureVoiceConnection(interaction);
    if (!qConn) return;

    const query = interaction.options.getString("query");

    if (!q.player) {
      q.player = createAudioPlayer();
      q.connection.subscribe(q.player);
      q.player.on(AudioPlayerStatus.Idle, () => playNext(interaction.guildId).catch(console.error));
      q.player.on("error", (e) => {
        console.error("[Music] Player error:", e.message);
        playNext(interaction.guildId).catch(console.error);
      });
    }

    try {
      let tracks = [];

      const ytValidate = playdl.yt_validate(query);

      if (ytValidate === "video") {
        const info = await playdl.video_info(query);
        tracks.push({
          url: query,
          title: info.video_details.title,
          durationSec: info.video_details.durationInSec,
          thumbnail: info.video_details.thumbnails?.[0]?.url || null,
          requestedBy: interaction.user.id,
        });
      } else if (ytValidate === "playlist") {
        const pl = await playdl.playlist_info(query, { incomplete: true });
        const videos = await pl.all_videos();
        tracks = videos.slice(0, 50).map(v => ({
          url: v.url,
          title: v.title,
          durationSec: v.durationInSec,
          thumbnail: v.thumbnails?.[0]?.url || null,
          requestedBy: interaction.user.id,
        }));
        await interaction.editReply(`Adding **${tracks.length}** tracks from playlist...`);
      } else {
        const results = await playdl.search(query, { source: { youtube: "video" }, limit: 1 });
        if (!results.length) return interaction.editReply("No results found for that query.");
        const v = results[0];
        tracks.push({
          url: v.url,
          title: v.title,
          durationSec: v.durationInSec,
          thumbnail: v.thumbnails?.[0]?.url || null,
          requestedBy: interaction.user.id,
        });
      }

      q.tracks.push(...tracks);

      const wasIdle = q.player.state.status === AudioPlayerStatus.Idle || !q.current;
      if (wasIdle) {
        await playNext(interaction.guildId);
        return interaction.editReply({ embeds: [nowPlayingEmbed(q.current || tracks[0], q)] });
      } else {
        return interaction.editReply(
          tracks.length === 1
            ? `Added **${tracks[0].title}** to the queue at position **${q.tracks.length}**.`
            : `Added **${tracks.length}** tracks to the queue.`
        );
      }
    } catch (e) {
      console.error("[Music] Play error:", e);
      return interaction.editReply(`Error: ${e.message}`);
    }
  }

  // --- Controls ---

  if (cmd === "skip") {
    if (!q.player || !q.current) return interaction.editReply("Nothing is playing.");
    const title = q.current.title;
    q.player.stop();
    return interaction.editReply(`Skipped **${title}**.`);
  }

  if (cmd === "stop") {
    q.tracks = [];
    q.current = null;
    q.loop = "off";
    if (q.player) q.player.stop();
    return interaction.editReply("Stopped playback and cleared the queue.");
  }

  if (cmd === "pause") {
    if (!q.player) return interaction.editReply("Nothing is playing.");
    q.player.pause();
    return interaction.editReply("Paused.");
  }

  if (cmd === "resume") {
    if (!q.player) return interaction.editReply("Nothing is playing.");
    q.player.unpause();
    return interaction.editReply("Resumed.");
  }

  if (cmd === "volume") {
    const level = interaction.options.getInteger("level");
    q.volume = level;
    const res = q.player?.state?.resource;
    if (res?.volume) res.volume.setVolume(level / 100);
    return interaction.editReply(`Volume set to **${level}%**.`);
  }

  if (cmd === "shuffle") {
    if (q.tracks.length === 0) return interaction.editReply("The queue is empty.");
    for (let i = q.tracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [q.tracks[i], q.tracks[j]] = [q.tracks[j], q.tracks[i]];
    }
    return interaction.editReply(`Queue shuffled. **${q.tracks.length}** tracks remaining.`);
  }

  if (cmd === "loop") {
    const mode = interaction.options.getString("mode");
    q.loop = mode;
    return interaction.editReply(`Loop mode set to **${mode}**.`);
  }

  if (cmd === "seek") {
    if (!q.current) return interaction.editReply("Nothing is playing.");
    const seconds = interaction.options.getInteger("seconds");
    try {
      const stream = await playdl.stream(q.current.url, { seek: seconds, quality: 2 });
      const resource = createAudioResource(stream.stream, { inputType: stream.type, inlineVolume: true });
      resource.volume?.setVolume(q.volume / 100);
      q.player.play(resource);
      return interaction.editReply(`Seeked to **${formatDuration(seconds)}**.`);
    } catch (e) {
      return interaction.editReply(`Seek failed: ${e.message}`);
    }
  }

  if (cmd === "remove") {
    const pos = interaction.options.getInteger("position") - 1;
    if (pos < 0 || pos >= q.tracks.length) return interaction.editReply("Invalid position.");
    const [removed] = q.tracks.splice(pos, 1);
    return interaction.editReply(`Removed **${removed.title}** from the queue.`);
  }

  if (cmd === "move") {
    const from = interaction.options.getInteger("from") - 1;
    const to = interaction.options.getInteger("to") - 1;
    if (from < 0 || from >= q.tracks.length || to < 0 || to >= q.tracks.length) {
      return interaction.editReply("Invalid position(s).");
    }
    const [track] = q.tracks.splice(from, 1);
    q.tracks.splice(to, 0, track);
    return interaction.editReply(`Moved **${track.title}** to position **${to + 1}**.`);
  }

  if (cmd === "dj") {
    const effect = interaction.options.getString("effect");
    const effectLabels = {
      bassboost: "Bass Boost", nightcore: "Nightcore", vaporwave: "Vaporwave",
      "8d": "8D Audio", karaoke: "Karaoke", clear: null,
    };
    q.effect = effectLabels[effect];
    if (effect === "clear") return interaction.editReply("Audio effects cleared. Will apply on next track.");
    return interaction.editReply(`Effect **${effectLabels[effect]}** set. Use \`/skip\` to apply it to the current track immediately.`);
  }

  if (cmd === "lyrics") {
    const query = interaction.options.getString("song") || q.current?.title;
    if (!query) return interaction.editReply("Nothing is playing and no song specified.");
    try {
      const res = await fetch(`https://lyrist.vercel.app/api/${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error("Not found");
      const data = await res.json();
      if (!data.lyrics) throw new Error("No lyrics");
      const lyrics = data.lyrics.slice(0, 1900);
      return interaction.editReply(`**${data.title}** - ${data.artist}\n\n${lyrics}${data.lyrics.length > 1900 ? "\n..." : ""}`);
    } catch {
      return interaction.editReply(`Could not find lyrics for **${query}**. Try a more specific song title.`);
    }
  }

  if (cmd === "disconnect") {
    q.tracks = [];
    q.current = null;
    if (q.player) { q.player.stop(); q.player = null; }
    if (q.connection) { q.connection.destroy(); q.connection = null; }
    queues.delete(interaction.guildId);
    return interaction.editReply("Disconnected from voice channel.");
  }
}
