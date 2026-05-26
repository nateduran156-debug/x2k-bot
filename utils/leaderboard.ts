import type { Client } from "discord.js";
import { readJSON, getGuild } from "./storage.js";

export function buildLeaderboardEmbed(
  guildPts: Record<string, number>,
  guildName: string,
): object | null {
  const sorted = Object.entries(guildPts)
    .filter(([, pts]) => pts > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 15);

  if (sorted.length === 0) return null;

  const list = sorted
    .map(([id, pts], i) => `\`${i + 1}.\` <@${id}> — **${pts}** pt${pts !== 1 ? "s" : ""}`)
    .join("\n");

  const now = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  return {
    color: 0xffffff,
    title: "Leaderboard",
    description: list,
    footer: { text: `${guildName} • updated ${now}` },
    timestamp: new Date().toISOString(),
  };
}

export async function refreshLeaderboard(client: Client, guildId: string): Promise<void> {
  try {
    const settings = getGuild(guildId);
    const lbMsg    = settings.leaderboardMessage;
    if (!lbMsg) return;

    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;

    const channel = guild.channels.cache.get(lbMsg.channelId);
    if (!channel || !("messages" in channel)) return;

    const msg = await (channel as import("discord.js").TextChannel).messages
      .fetch(lbMsg.messageId)
      .catch(() => null);
    if (!msg) return;

    const data     = readJSON<Record<string, Record<string, number>>>("points.json");
    const guildPts = data[guildId] ?? {};
    const embed    = buildLeaderboardEmbed(guildPts, guild.name);
    if (!embed) return;

    await msg.edit({ embeds: [embed] });
  } catch {
    // probably got deleted or something, ignore it
  }
}
