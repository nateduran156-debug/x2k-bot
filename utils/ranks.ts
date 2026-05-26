import type { Guild } from "discord.js";

export async function syncRankRoles(
  guild: Guild,
  userId: string,
  currentPoints: number,
  ranks: Array<{ roleId: string; points: number; name: string }>,
): Promise<{ gained: string[]; lost: string[] }> {
  if (ranks.length === 0) return { gained: [], lost: [] };
  const gMember = await guild.members.fetch(userId).catch(() => null);
  if (!gMember) return { gained: [], lost: [] };
  const gained: string[] = [];
  const lost:   string[] = [];
  for (const rank of ranks) {
    const qualifies = currentPoints >= rank.points;
    const hasRole   = gMember.roles.cache.has(rank.roleId);
    if (qualifies && !hasRole) {
      await gMember.roles.add(rank.roleId).catch(() => {});
      gained.push(rank.name);
    } else if (!qualifies && hasRole) {
      await gMember.roles.remove(rank.roleId).catch(() => {});
      lost.push(rank.name);
    }
  }
  return { gained, lost };
}
