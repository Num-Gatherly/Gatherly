// bot/activity.js
import { config } from "./config.js";

let activityTimer = null;

const ERLC_PROMPTS = [
  "**ER:LC Fun Fact:** The game was originally developed by the Police Roleplay Community (PRC) and released in 2017, making it one of the longest-running serious roleplay experiences on Roblox.",
  "**ER:LC Fun Fact:** The map, Rockport City, contains over 40 unique buildings across its downtown, suburbs, and industrial zones.",
  "**ER:LC Question:** What does your department do when there is a mass casualty incident? Share your SOP below.",
  "**ER:LC Fun Fact:** Custom Servers let owners whitelist specific users, enabling fully private law enforcement roleplay communities.",
  "**ER:LC Question:** Which division in your server is the hardest to staff consistently, and why?",
  "**ER:LC Fun Fact:** Fire Department calls can range from car fires to building fires requiring ladder trucks. How does your FD handle multi-unit responses?",
  "**ER:LC Question:** What is the best roleplay scenario you have ever been part of in ER:LC? Drop it below.",
  "**ER:LC Fun Fact:** ER:LC supports custom liveries through the in-game creator, meaning no two serious RP communities look exactly the same.",
  "**ER:LC Question:** Pursuits - high priority or terminate early? What is your server's pursuit policy?",
  "**ER:LC Fun Fact:** Private server capacity can be set between 12 and 40 players, letting communities control population density during events.",
  "**ER:LC Question:** What is the most creative event your community has ever hosted on ER:LC?",
  "**ER:LC Fun Fact:** The in-game CAD lets dispatch assign units, track vehicles, and manage active incidents in real time - one of the most realistic dispatch simulations on Roblox.",
  "**ER:LC Question:** Does your server have a ride-along program for new members? How do you run it?",
  "**ER:LC Fun Fact:** Fire Rescue vehicles include an Engine, Ladder Truck, and Rescue unit, enough for a realistic tiered response system.",
  "**ER:LC Question:** What is your hottest take on ER:LC roleplay etiquette?",
  "**ER:LC Fun Fact:** ER:LC has a dedicated developer team that rolls out updates including new vehicles, map changes, and CAD improvements on a regular cadence.",
  "**ER:LC Question:** How does your server handle inter-department communication during a major incident?",
  "**ER:LC Fun Fact:** The ER:LC radio system supports multiple channels, letting departments operate on separate frequencies simultaneously.",
  "**ER:LC Question:** What is the one rule every serious ER:LC server should have but most do not?",
  "**ER:LC Question:** Civilian roleplay - underrated or overrated? What role does it play in your server?",
];

async function sendActivityPrompt(client) {
  try {
    const channel = await client.channels.fetch(config.activityChannelId);
    if (!channel?.isTextBased()) return;
    const prompt = ERLC_PROMPTS[Math.floor(Math.random() * ERLC_PROMPTS.length)];
    await channel.send(prompt);
    console.log("[Activity] Sent ER:LC prompt to general chat.");
  } catch (e) {
    console.error("[Activity] Failed to send prompt:", e.message);
  }
}

export function startActivityTimer(client) {
  if (activityTimer) clearTimeout(activityTimer);
  activityTimer = setTimeout(async () => {
    await sendActivityPrompt(client);
    startActivityTimer(client); // reset for the next 6 hours
  }, config.activityTimeoutMs);
}

export function resetActivityTimer(client) {
  startActivityTimer(client);
}
