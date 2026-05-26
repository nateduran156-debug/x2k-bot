import type { Client, TextChannel } from "discord.js";
import { getGuild, getPoints, savePoints } from "./storage.js";
import { refreshLeaderboard } from "./leaderboard.js";
import { logPoints } from "./botLogger.js";

interface QueueSession {
  guildId: string;
  startedById: string;
  joined: Map<string, string>;
}

const activeSessions = new Map<string, QueueSession>();

export function isQueueActive(guildId: string): boolean {
  return activeSessions.has(guildId);
}

export function startQueue(guildId: string, startedById: string): boolean {
  if (activeSessions.has(guildId)) return false;
  activeSessions.set(guildId, { guildId, startedById, joined: new Map() });
  return true;
}

export function addJoiner(guildId: string, discordId: string, displayName: string): "added" | "already_in" | "no_queue" {
  const session = activeSessions.get(guildId);
  if (!session) return "no_queue";
  if (session.joined.has(discordId)) return "already_in";
  session.joined.set(discordId, displayName);
  return "added";
}

export function getQueueLog(guildId: string): { entries: Array<{ id: string; name: string }>; count: number } | null {
  const session = activeSessions.get(guildId);
  if (!session) return null;
  return {
    entries: Array.from(session.joined.entries()).map(([id, name]) => ({ id, name })),
    count: session.joined.size,
  };
}

export async function endQueue(
  client: Client,
  guildId: string,
): Promise<{ ok: boolean; entries: Array<{ id: string; name: string }>; reason?: string }> {
  const session = activeSessions.get(guildId);
  if (!session) return { ok: false, entries: [], reason: "no active queue" };

  activeSessions.delete(guildId);
  const entries = Array.from(session.joined.entries()).map(([id, name]) => ({ id, name }));

  if (entries.length > 0) {
    const pts = getPoints(guildId);
    for (const { id } of entries) {
      pts[id] = (pts[id] ?? 0) + 1;
    }
    savePoints(guildId, pts);
    refreshLeaderboard(client, guildId).catch(() => {});
  }

  const s = getGuild(guildId);
  if (s.queueChannel) {
    try {
      const guild = client.guilds.cache.get(guildId);
      const ch = guild?.channels.cache.get(s.queueChannel) as TextChannel | undefined;
      if (ch) {
        if (entries.length === 0) {
          await ch.send({
            embeds: [{
              color: 0xffffff,
              title: "Queue Results — 0 joined",
              description: "nobody joined the queue during this session",
              timestamp: new Date().toISOString(),
            }],
          });
        } else {
          const lines = entries.map((e, i) => `\`${i + 1}.\` **${e.name}** (<@${e.id}>)`).join("\n");
          await ch.send({
            embeds: [{
              color: 0xffffff,
              title: `Queue Results — ${entries.length} joined`,
              description: lines.slice(0, 4000),
              footer: { text: "each member received +1 raid point" },
              timestamp: new Date().toISOString(),
            }],
          });
        }
      }
    } catch {}
  }

  await logPoints(
    guildId,
    "Queue Ended",
    `Queue ended — **${entries.length}** member${entries.length !== 1 ? "s" : ""} joined`,
    [{ name: "Members", value: entries.map((e) => e.name).slice(0, 30).join(", ") || "none", inline: false }],
  );

  return { ok: true, entries };
}
