import { getRobloxCookie } from "./storage.js";

const TAG_GROUP_ID = "396910998";

const TAG_GROUP_MAP: Record<string, string> = {
  "sharingan tag": TAG_GROUP_ID,
  "rockstar":      TAG_GROUP_ID,
  "dark":          TAG_GROUP_ID,
  "faze":          TAG_GROUP_ID,
  "fraid":         TAG_GROUP_ID,
  "member":        TAG_GROUP_ID,
};

const TAG_ROLE_NAME_MAP: Record<string, string> = {
  "faze": "FaZe",
};

async function getCsrfToken(): Promise<string | null> {
  try {
    const cookie = getRobloxCookie();
    const res = await fetch("https://auth.roblox.com/v2/logout", {
      method: "POST",
      headers: cookie ? { Cookie: `.ROBLOSECURITY=${cookie}` } : {},
    });
    return res.headers.get("x-csrf-token");
  } catch { return null; }
}

export async function validateCookie(cookie: string): Promise<{ id: number; name: string } | null> {
  try {
    const res = await fetch("https://users.roblox.com/v1/users/authenticated", {
      headers: { Cookie: `.ROBLOSECURITY=${cookie}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as { id: number; name: string };
  } catch { return null; }
}

export async function getUserByUsername(username: string): Promise<{ id: number; name: string } | null> {
  try {
    const res = await fetch("https://users.roblox.com/v1/usernames/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usernames: [username], excludeBannedUsers: false }),
    });
    const data = (await res.json()) as { data: Array<{ id: number; name: string }> };
    return data.data?.[0] ?? null;
  } catch { return null; }
}

export async function getUserGroups(userId: number): Promise<Array<{ group: { id: number; name: string } }>> {
  try {
    const res  = await fetch(`https://groups.roblox.com/v2/users/${userId}/groups/roles`);
    const data = (await res.json()) as { data: Array<{ group: { id: number; name: string } }> };
    return data.data ?? [];
  } catch { return []; }
}

export async function isInGroup(userId: number, groupId: string): Promise<boolean> {
  const groups = await getUserGroups(userId);
  return groups.some((g) => String(g.group.id) === String(groupId));
}

export async function getGroupRank(
  userId: number,
  groupId: string,
): Promise<{ rankId: number; rankName: string } | null> {
  try {
    const res  = await fetch(`https://groups.roblox.com/v1/users/${userId}/groups/roles`);
    const data = (await res.json()) as {
      data: Array<{ group: { id: number }; role: { id: number; name: string; rank: number } }>;
    };
    const match = data.data?.find((g) => String(g.group.id) === String(groupId));
    if (!match) return null;
    return { rankId: match.role.rank, rankName: match.role.name };
  } catch { return null; }
}

interface RobloxRole { id: number; name: string; rank: number; }

export async function getGroupRoles(groupId: string): Promise<RobloxRole[]> {
  try {
    const cookie = getRobloxCookie();
    const res    = await fetch(`https://groups.roblox.com/v1/groups/${groupId}/roles`, {
      headers: cookie ? { Cookie: `.ROBLOSECURITY=${cookie}` } : {},
    });
    const data = (await res.json()) as { roles: RobloxRole[] };
    return data.roles ?? [];
  } catch { return []; }
}

export async function getGroupInfo(groupId: string): Promise<{ id: number; name: string } | null> {
  try {
    const res = await fetch(`https://groups.roblox.com/v1/groups/${groupId}`);
    if (!res.ok) return null;
    return (await res.json()) as { id: number; name: string };
  } catch { return null; }
}

export async function getGroupInfoBatch(groupIds: string[]): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  const CHUNK = 10;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < groupIds.length; i += CHUNK) {
    const chunk = groupIds.slice(i, i + CHUNK);
    await Promise.all(
      chunk.map(async (id) => {
        const info = await getGroupInfo(id).catch(() => null);
        if (info?.name) map[String(id)] = info.name;
      }),
    );
    if (i + CHUNK < groupIds.length) await sleep(300);
  }
  return map;
}

export async function setGroupRank(
  groupId: string,
  userId: number,
  rankId: number,
): Promise<{ ok: boolean; reason?: string }> {
  const cookie = getRobloxCookie();
  if (!cookie) return { ok: false, reason: "no cookie set — use /cookie to set one" };
  try {
    const csrf = await getCsrfToken();
    if (!csrf) return { ok: false, reason: "couldnt get csrf token" };
    const res = await fetch(`https://groups.roblox.com/v1/groups/${groupId}/users/${userId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: `.ROBLOSECURITY=${cookie}`,
        "x-csrf-token": csrf,
      },
      body: JSON.stringify({ roleId: rankId }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { errors?: Array<{ message: string }> };
      return { ok: false, reason: err?.errors?.[0]?.message ?? `status ${res.status}` };
    }
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, reason: String(e) };
  }
}

export async function getPendingJoinRequests(
  groupId: string,
): Promise<Array<{ userId: number; username: string }>> {
  const cookie = getRobloxCookie();
  if (!cookie) return [];
  try {
    const res  = await fetch(`https://groups.roblox.com/v1/groups/${groupId}/join-requests?limit=100`, {
      headers: { Cookie: `.ROBLOSECURITY=${cookie}` },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { data: Array<{ requester: { userId: number; username: string } }> };
    return (data.data ?? []).map((r) => ({ userId: r.requester.userId, username: r.requester.username }));
  } catch { return []; }
}

export async function acceptJoinRequest(
  groupId: string,
  userId: number,
): Promise<{ ok: boolean; reason?: string }> {
  const cookie = getRobloxCookie();
  if (!cookie) return { ok: false, reason: "no cookie set — use /cookie to configure one" };
  try {
    const csrf = await getCsrfToken();
    if (!csrf) return { ok: false, reason: "couldn't retrieve CSRF token" };
    const res = await fetch(`https://groups.roblox.com/v1/groups/${groupId}/join-requests/users/${userId}`, {
      method: "POST",
      headers: {
        Cookie: `.ROBLOSECURITY=${cookie}`,
        "x-csrf-token": csrf,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { errors?: Array<{ message: string }> };
      return { ok: false, reason: err?.errors?.[0]?.message ?? `status ${res.status}` };
    }
    return { ok: true };
  } catch (e) { return { ok: false, reason: String(e) }; }
}

export async function getUserAvatarUrl(userId: number): Promise<string | null> {
  try {
    const res  = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=false`);
    const data = (await res.json()) as { data: Array<{ imageUrl: string; state: string }> };
    return data.data?.[0]?.imageUrl ?? null;
  } catch { return null; }
}

export async function kickFromGroup(
  groupId: string,
  userId: number,
): Promise<{ ok: boolean; reason?: string }> {
  const cookie = getRobloxCookie();
  if (!cookie) return { ok: false, reason: "no cookie set" };
  try {
    const csrf = await getCsrfToken();
    if (!csrf) return { ok: false, reason: "couldn't retrieve CSRF token" };
    const res = await fetch(`https://groups.roblox.com/v1/groups/${groupId}/users/${userId}`, {
      method: "DELETE",
      headers: {
        Cookie: `.ROBLOSECURITY=${cookie}`,
        "x-csrf-token": csrf,
      },
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { errors?: Array<{ message: string }> };
      return { ok: false, reason: err?.errors?.[0]?.message ?? `status ${res.status}` };
    }
    return { ok: true };
  } catch (e) { return { ok: false, reason: String(e) }; }
}

const JOIN_FIRST_TAGS = new Set(["sharingan tag", "rockstar", "dark", "faze", "fraid"]);

const DEFAULT_GROUP_ID = "396910998";

export async function giveRobloxTagRole(
  robloxUsername: string,
  tagName: string,
  customTags?: string[],
): Promise<{ ok: boolean; reason?: string }> {
  const lowerTag = tagName.toLowerCase();

  let groupId = TAG_GROUP_MAP[lowerTag];
  if (!groupId) {
    const isCustom = customTags?.map((t) => t.toLowerCase()).includes(lowerTag);
    if (isCustom) {
      groupId = DEFAULT_GROUP_ID;
    } else {
      return { ok: false, reason: `unknown tag: ${tagName}` };
    }
  }

  const user = await getUserByUsername(robloxUsername);
  if (!user) return { ok: false, reason: `roblox user not found: ${robloxUsername}` };

  if (JOIN_FIRST_TAGS.has(lowerTag)) {
    await acceptJoinRequest(groupId, user.id).catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));
  }

  const roleName = TAG_ROLE_NAME_MAP[lowerTag] ?? lowerTag;
  const roles = await getGroupRoles(groupId);
  const role  = roles.find((r) => r.name.toLowerCase() === roleName);
  if (!role) return { ok: false, reason: `role "${roleName}" not found in group ${groupId} — make sure the role name in the group matches exactly` };

  const result = await setGroupRank(groupId, user.id, role.id);
  if (!result.ok && JOIN_FIRST_TAGS.has(lowerTag)) {
    return { ok: false, reason: `couldn't rank up ${robloxUsername} — make sure they've requested to join the group first, then use .accept to bring them in before approving` };
  }
  return result;
}
