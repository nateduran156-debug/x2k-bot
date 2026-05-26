import type { Client, TextChannel } from "discord.js";
import { getGuild, getPoints, savePoints } from "./storage.js";
import { refreshLeaderboard } from "./leaderboard.js";
import { logPoints } from "./botLogger.js";
import { syncRankRoles } from "./ranks.js";

interface QueueSession {
  guildId: string;
  startedById: string;
  joined: Map<string, string>;
  pointsPerJoin: number;
}

const activeSessions = new Map<string, QueueSession>();

export function isQueueActive(guildId: string): boolean {
  return activeSessions.has(guildId);
}

export function startQueue(guildId: string, startedById: string, pointsPerJoin = 1): boolean {
  if (activeSessions.has(guildId)) return false;
  activeSessions.set(guildId, { guildId, startedById, joined: new Map(), pointsPerJoin });
  return true;
}

export function setQueuePoints(guildId: string, amount: number): boolean {
  const session = activeSessions.get(guildId);
  if (!session) return false;
  session.pointsPerJoin = amount;
  return true;
}

export function getQueuePoints(guildId: string): number | null {
  return activeSessions.get(guildId)?.pointsPerJoin ?? null;
}

export function addJoiner(guildId: string, discordId: string, displayName: string): "added" | "already_in" | "no_queue" {
  const session = activeSessions.get(guildId);
  if (!session) return "no_queue";
  if (session.joined.has(discordId)) return "already_in";
  session.joined.set(discordId, displayName);
  return "added";
}

export function getQueueLog(guildId: string): { entries: Array<{ id: string; name: string }>; count: number; pointsPerJoin: number } | null {
  const session = activeSessions.get(guildId);
  if (!session) return null;
  return {
    entries: Array.from(session.joined.entries()).map(([id, name]) => ({ id, name })),
    count: session.joined.size,
    pointsPerJoin: session.pointsPerJoin,
  };
}

export async function endQueue(
  client: Client,
  guildId: string,
): Promise<{ ok: boolean; entries: Array<{ id: string; name: string }>; pointsPerJoin: number; rankUps: Array<{ id: string; name: string; ranks: string[] }>; reason?: string }> {
  const session = activeSessions.get(guildId);
  if (!session) return { ok: false, entries: [], pointsPerJoin: 1, rankUps: [], reason: "no active queue" };

  activeSessions.delete(guildId);
  const entries = Array.from(session.joined.entries()).map(([id, name]) => ({ id, name }));
  const ptsPerJoin = session.pointsPerJoin;

  const rankUps: Array<{ id: string; name: string; ranks: string[] }> = [];

  if (entries.length > 0) {
    const pts = getPoints(guildId);
    for (const { id } of entries) {
      pts[id] = (pts[id] ?? 0) + ptsPerJoin;
    }
    savePoints(guildId, pts);
    refreshLeaderboard(client, guildId).catch(() => {});

    const guild = client.guilds.cache.get(guildId);
    const s = getGuild(guildId);
    const ranks = s.rankRoles ?? [];

    if (guild && ranks.length > 0) {
      for (const { id, name } of entries) {
        const { gained } = await syncRankRoles(guild, id, pts[id] ?? 0, ranks);
        if (gained.length > 0) {
          rankUps.push({ id, name, ranks: gained });
        }
      }
    }
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
          const rankUpLines = rankUps.length > 0
            ? "\n\n**Rank Ups:**\n" + rankUps.map((r) => `🎖️ **${r.name}** unlocked **${r.ranks.join(", ")}**`).join("\n")
            : "";
          await ch.send({
            embeds: [{
              color: 0xffffff,
              title: `Queue Results — ${entries.length} joined`,
              description: (lines + rankUpLines).slice(0, 4000),
              footer: { text: `each member received +${ptsPerJoin} raid point${ptsPerJoin !== 1 ? "s" : ""}` },
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
    `Queue ended — **${entries.length}** member${entries.length !== 1 ? "s" : ""} joined (+${ptsPerJoin} pts each)`,
    [{ name: "Members", value: entries.map((e) => e.name).slice(0, 30).join(", ") || "none", inline: false }],
  );

  return { ok: true, entries, pointsPerJoin: ptsPerJoin, rankUps };
}
