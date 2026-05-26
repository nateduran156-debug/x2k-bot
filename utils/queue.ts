import type { Client, TextChannel } from "discord.js";
import { getGuild, getPoints, savePoints, getRegistered } from "./storage.js";
import { refreshLeaderboard } from "./leaderboard.js";
import { logPoints } from "./botLogger.js";

const QUEUE_GROUP_ID = "703716156";
const POLL_INTERVAL_MS = 45_000;

interface QueueSession {
  guildId: string;
  startedById: string;
  snapshot: Set<number>;
  joined: Map<number, string>;
  intervalId: ReturnType<typeof setInterval>;
}

const activeSessions = new Map<string, QueueSession>();

export function isQueueActive(guildId: string): boolean {
  return activeSessions.has(guildId);
}

export function addManualJoiner(guildId: string, robloxUsername: string, userId: number): boolean {
  const session = activeSessions.get(guildId);
  if (!session) return false;
  if (session.snapshot.has(userId) || session.joined.has(userId)) return false;
  session.joined.set(userId, robloxUsername);
  return true;
}

export function getQueueLog(guildId: string): { usernames: string[]; count: number } | null {
  const session = activeSessions.get(guildId);
  if (!session) return null;
  return { usernames: Array.from(session.joined.values()), count: session.joined.size };
}

export async function fetchGroupMemberIds(): Promise<Map<number, string>> {
  const members = new Map<number, string>();
  let cursor = "";
  let pages = 0;
  const MAX_PAGES = 50;

  while (pages < MAX_PAGES) {
    const url =
      `https://groups.roblox.com/v1/groups/${QUEUE_GROUP_ID}/users?limit=100&sortOrder=Asc` +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
    try {
      const res = await fetch(url);
      if (!res.ok) break;
      const data = (await res.json()) as {
        data: Array<{ user: { userId: number; username: string } }>;
        nextPageCursor: string | null;
      };
      for (const entry of data.data ?? []) {
        members.set(entry.user.userId, entry.user.username);
      }
      if (!data.nextPageCursor) break;
      cursor = data.nextPageCursor;
      pages++;
      await new Promise((r) => setTimeout(r, 300));
    } catch {
      break;
    }
  }

  return members;
}

export async function startQueue(
  guildId: string,
  startedById: string,
): Promise<{ ok: boolean; count: number; reason?: string }> {
  if (activeSessions.has(guildId)) {
    return { ok: false, count: 0, reason: "a queue is already active" };
  }

  const initial = await fetchGroupMemberIds();
  if (initial.size === 0) {
    return { ok: false, count: 0, reason: "couldn't fetch group members — try again in a moment" };
  }

  const session: QueueSession = {
    guildId,
    startedById,
    snapshot: new Set(initial.keys()),
    joined: new Map(),
    intervalId: setInterval(() => { pollQueue(guildId).catch(() => {}); }, POLL_INTERVAL_MS),
  };

  activeSessions.set(guildId, session);
  return { ok: true, count: initial.size };
}

async function pollQueue(guildId: string): Promise<void> {
  const session = activeSessions.get(guildId);
  if (!session) return;

  const current = await fetchGroupMemberIds();
  for (const [userId, username] of current) {
    if (!session.snapshot.has(userId) && !session.joined.has(userId)) {
      session.joined.set(userId, username);
    }
  }
}

export async function endQueue(
  client: Client,
  guildId: string,
): Promise<{ ok: boolean; usernames: string[]; reason?: string }> {
  const session = activeSessions.get(guildId);
  if (!session) {
    return { ok: false, usernames: [], reason: "no active queue" };
  }

  clearInterval(session.intervalId);
  activeSessions.delete(guildId);

  try { await pollQueue(guildId); } catch {}

  const usernames = Array.from(session.joined.values());

  if (usernames.length > 0) {
    const pts = getPoints(guildId);
    const registered = getRegistered();
    const registeredByRoblox = Object.fromEntries(
      Object.entries(registered).map(([discordId, rblx]) => [rblx.toLowerCase(), discordId]),
    );

    for (const username of usernames) {
      const discordId = registeredByRoblox[username.toLowerCase()];
      if (discordId) {
        pts[discordId] = (pts[discordId] ?? 0) + 1;
      }
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
        if (usernames.length === 0) {
          await ch.send({
            embeds: [{
              color: 0xffffff,
              title: "Queue Results — 0 joined",
              description: "nobody from the group joined during this session",
              timestamp: new Date().toISOString(),
            }],
          });
        } else {
          const lines = usernames.map((u, i) => `\`${i + 1}.\` **${u}**`).join("\n");
          await ch.send({
            embeds: [{
              color: 0xffffff,
              title: `Queue Results — ${usernames.length} joined`,
              description: lines,
              footer: { text: "registered members received +1 raid point" },
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
    `Queue ended — **${usernames.length}** member${usernames.length !== 1 ? "s" : ""} joined during the session`,
    [{ name: "Members", value: usernames.slice(0, 30).join(", ") || "none", inline: false }],
  );

  return { ok: true, usernames };
}
