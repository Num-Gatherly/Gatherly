// bot/config.js
export const config = {
  token: process.env.DISCORD_BOT_TOKEN,
  clientId: process.env.DISCORD_CLIENT_ID,
  guildId: process.env.GATHERLY_GUILD_ID || "1513859432109445181",
  anthropicKey: process.env.ANTHROPIC_API_KEY,

  // Role IDs that can use staff commands
  staffRoles: [
    "1516346050829615114",
    "1515856136576696472",
  ],

  // Voice channel the bot joins via -join
  musicVoiceChannelId: "1513859432587726942",

  // Channels to monitor for bot/website complaints
  monitorChannels: [
    "1513859432587726941",
    "1514839340923224094",
    "1515971053875367956",
  ],

  // Support channel to redirect people to
  supportChannelId: "1514948957229547680",

  // General chat channel for activity detection
  activityChannelId: "1513859432587726941",

  // 6 hours silence before sending an ER:LC prompt
  activityTimeoutMs: 6 * 60 * 60 * 1000,

  // Giveaway reaction emoji
  giveawayEmoji: "🎉",

  // Pricing page URL shown as bot status
  statusUrl: "https://gatherly-erlc.xyz/pricing",
};
