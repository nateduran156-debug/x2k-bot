import { getRobloxCookie } from "./storage.js";

const TAG_GROUP_ID = "396910998";

// Maps tag names to the roblox group they belong to
const TAG_GROUP_MAP: Record<string, string> = {
  "sharingan tag": TAG_GROUP_ID,
  "rockstar": TAG_GROUP_ID,
  "dark": TAG_GROUP_ID,
  "faze": TAG_GROUP_ID,
  "fraid": TAG_GROUP_ID,
  "member": TAG_GROUP_ID,
};

// Maps tag names to the exact role name in the roblox group
// Only needed when the role name doesn't match the tag name
const TAG_ROLE_NAME_MAP: Record<string, string> = {
  "faze": "FaZe",
  "member": "Member",
};

// Tags that require the user to join the group first before being ranked
const JOIN_FIRST_TAGS = new Set(["sharingan tag", "rockstar", "dark", "faze", "fraid", "member"]);

const DEFAULT_GROUP_ID = "396910998";

// Get a CSRF token from Roblox (needed for POST/PATCH/DELETE requests)
async function getCsrfToken(): Promise<string | null> {
  try {
    const cookie = getRobloxCookie();
    const response = await fetch("https://auth.roblox.com/v2/logout", {
      method: "POST",
      headers: cookie ? { Cookie: `.ROBLOSECURITY=${cookie}` } : {},
    });
    return response.headers.get("x-csrf-token");
  } catch {
    return null;
  }
}

// Check if a roblox cookie is valid and return the account info if so
export async function validateCookie(
  cookie: string,
): Promise<{ id: number; name: string } | null> {
  try {
    const response = await fetch("https://users.roblox.com/v1/users/authenticated", {
      headers: { Cookie: `.ROBLOSECURITY=${cookie}` },
    });
    if (!response.ok) return null;
    return (await response.json()) as { id: number; name: string };
  } catch {
    return null;
  }
}

// Look up a roblox user by their username
export async function getUserByUsername(
  username: string,
): Promise<{ id: number; name: string } | null> {
  try {
    const response = await fetch("https://users.roblox.com/v1/usernames/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usernames: [username], excludeBannedUsers: false }),
    });
    const data = (await response.json()) as { data: Array<{ id: number; name: string }> };
    return data.data?.[0] ?? null;
  } catch {
    return null;
  }
}

// Get all groups a roblox user is in
export async function getUserGroups(
  userId: number,
): Promise<Array<{ group: { id: number; name: string } }>> {
  try {
    const response = await fetch(`https://groups.roblox.com/v2/users/${userId}/groups/roles`);
    const data = (await response.json()) as {
      data: Array<{ group: { id: number; name: string } }>;
    };
    return data.data ?? [];
  } catch {
    return [];
  }
}

// Check if a roblox user is in a specific group
export async function isInGroup(userId: number, groupId: string): Promise<boolean> {
  const groups = await getUserGroups(userId);
  return groups.some((entry) => String(entry.group.id) === String(groupId));
}

// Get a user's rank in a specific group
export async function getGroupRank(
  userId: number,
  groupId: string,
): Promise<{ rankId: number; rankName: string } | null> {
  try {
    const response = await fetch(`https://groups.roblox.com/v1/users/${userId}/groups/roles`);
    const data = (await response.json()) as {
      data: Array<{
        group: { id: number };
        role: { id: number; name: string; rank: number };
      }>;
    };
    const match = data.data?.find((entry) => String(entry.group.id) === String(groupId));
    if (!match) return null;
    return { rankId: match.role.rank, rankName: match.role.name };
  } catch {
    return null;
  }
}

interface RobloxRole {
  id: number;
  name: string;
  rank: number;
}

// Get all roles in a roblox group
export async function getGroupRoles(groupId: string): Promise<RobloxRole[]> {
  try {
    const cookie = getRobloxCookie();
    const response = await fetch(`https://groups.roblox.com/v1/groups/${groupId}/roles`, {
      headers: cookie ? { Cookie: `.ROBLOSECURITY=${cookie}` } : {},
    });
    const data = (await response.json()) as { roles: RobloxRole[] };
    return data.roles ?? [];
  } catch {
    return [];
  }
}

// Get basic info about a roblox group
export async function getGroupInfo(groupId: string): Promise<{ id: number; name: string } | null> {
  try {
    const response = await fetch(`https://groups.roblox.com/v1/groups/${groupId}`);
    if (!response.ok) return null;
    return (await response.json()) as { id: number; name: string };
  } catch {
    return null;
  }
}

// Get group names for multiple group IDs at once
export async function getGroupInfoBatch(groupIds: string[]): Promise<Record<string, string>> {
  const nameMap: Record<string, string> = {};
  const CHUNK_SIZE = 10;

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  for (let i = 0; i < groupIds.length; i += CHUNK_SIZE) {
    const chunk = groupIds.slice(i, i + CHUNK_SIZE);

    await Promise.all(
      chunk.map(async (groupId) => {
        const info = await getGroupInfo(groupId).catch(() => null);
        if (info?.name) {
          nameMap[String(groupId)] = info.name;
        }
      }),
    );

    // Wait a bit between chunks to avoid hitting rate limits
    if (i + CHUNK_SIZE < groupIds.length) {
      await sleep(300);
    }
  }

  return nameMap;
}

// Set a user's rank in a roblox group using the bot's cookie
export async function setGroupRank(
  groupId: string,
  userId: number,
  rankId: number,
): Promise<{ ok: boolean; reason?: string }> {
  const cookie = getRobloxCookie();
  if (!cookie) {
    return { ok: false, reason: "no cookie set — use /cookie to set one" };
  }

  try {
    const csrfToken = await getCsrfToken();
    if (!csrfToken) {
      return { ok: false, reason: "couldn't get csrf token" };
    }

    const response = await fetch(`https://groups.roblox.com/v1/groups/${groupId}/users/${userId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: `.ROBLOSECURITY=${cookie}`,
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({ roleId: rankId }),
    });

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as {
        errors?: Array<{ message: string }>;
      };
      const reason = errorData?.errors?.[0]?.message ?? `status ${response.status}`;
      return { ok: false, reason };
    }

    return { ok: true };
  } catch (error: unknown) {
    return { ok: false, reason: String(error) };
  }
}

// Get pending join requests for a group
export async function getPendingJoinRequests(
  groupId: string,
): Promise<Array<{ userId: number; username: string }>> {
  const cookie = getRobloxCookie();
  if (!cookie) return [];

  try {
    const response = await fetch(
      `https://groups.roblox.com/v1/groups/${groupId}/join-requests?limit=100`,
      {
        headers: { Cookie: `.ROBLOSECURITY=${cookie}` },
      },
    );

    if (!response.ok) return [];

    const data = (await response.json()) as {
      data: Array<{ requester: { userId: number; username: string } }>;
    };

    return (data.data ?? []).map((entry) => ({
      userId: entry.requester.userId,
      username: entry.requester.username,
    }));
  } catch {
    return [];
  }
}

// Accept a user's join request for a roblox group
export async function acceptJoinRequest(
  groupId: string,
  userId: number,
): Promise<{ ok: boolean; reason?: string }> {
  const cookie = getRobloxCookie();
  if (!cookie) {
    return { ok: false, reason: "no cookie set — use /cookie to configure one" };
  }

  try {
    const csrfToken = await getCsrfToken();
    if (!csrfToken) {
      return { ok: false, reason: "couldn't retrieve CSRF token" };
    }

    const response = await fetch(
      `https://groups.roblox.com/v1/groups/${groupId}/join-requests/users/${userId}`,
      {
        method: "POST",
        headers: {
          Cookie: `.ROBLOSECURITY=${cookie}`,
          "x-csrf-token": csrfToken,
          "Content-Type": "application/json",
        },
      },
    );

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as {
        errors?: Array<{ message: string }>;
      };
      const reason = errorData?.errors?.[0]?.message ?? `status ${response.status}`;
      return { ok: false, reason };
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, reason: String(error) };
  }
}

// Get a roblox user's avatar headshot URL
export async function getUserAvatarUrl(userId: number): Promise<string | null> {
  try {
    const response = await fetch(
      `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=false`,
    );
    const data = (await response.json()) as {
      data: Array<{ imageUrl: string; state: string }>;
    };
    return data.data?.[0]?.imageUrl ?? null;
  } catch {
    return null;
  }
}

// Kick a user from a roblox group
export async function kickFromGroup(
  groupId: string,
  userId: number,
): Promise<{ ok: boolean; reason?: string }> {
  const cookie = getRobloxCookie();
  if (!cookie) {
    return { ok: false, reason: "no cookie set" };
  }

  try {
    const csrfToken = await getCsrfToken();
    if (!csrfToken) {
      return { ok: false, reason: "couldn't retrieve CSRF token" };
    }

    const response = await fetch(
      `https://groups.roblox.com/v1/groups/${groupId}/users/${userId}`,
      {
        method: "DELETE",
        headers: {
          Cookie: `.ROBLOSECURITY=${cookie}`,
          "x-csrf-token": csrfToken,
        },
      },
    );

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as {
        errors?: Array<{ message: string }>;
      };
      const reason = errorData?.errors?.[0]?.message ?? `status ${response.status}`;
      return { ok: false, reason };
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, reason: String(error) };
  }
}

// Give a roblox user a tag role in the group
export async function giveRobloxTagRole(
  robloxUsername: string,
  tagName: string,
  customTags?: string[],
): Promise<{ ok: boolean; reason?: string }> {
  const lowerTag = tagName.toLowerCase();

  // Find which group this tag belongs to
  let groupId = TAG_GROUP_MAP[lowerTag];
  if (!groupId) {
    const isCustomTag = customTags?.map((tag) => tag.toLowerCase()).includes(lowerTag);
    if (isCustomTag) {
      groupId = DEFAULT_GROUP_ID;
    } else {
      return { ok: false, reason: `unknown tag: ${tagName}` };
    }
  }

  // Look up the roblox user
  const user = await getUserByUsername(robloxUsername);
  if (!user) {
    return { ok: false, reason: `roblox user not found: ${robloxUsername}` };
  }

  // Accept their join request first if this tag requires group membership
  if (JOIN_FIRST_TAGS.has(lowerTag)) {
    await acceptJoinRequest(groupId, user.id).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  // Find the matching role in the group (case-insensitive)
  const roleName = TAG_ROLE_NAME_MAP[lowerTag] ?? lowerTag;
  const groupRoles = await getGroupRoles(groupId);
  const matchingRole = groupRoles.find(
    (role) => role.name.toLowerCase() === roleName.toLowerCase(),
  );

  if (!matchingRole) {
    return {
      ok: false,
      reason: `role "${roleName}" not found in group ${groupId} — make sure the role name in the group matches exactly`,
    };
  }

  // Set their rank in the group
  const result = await setGroupRank(groupId, user.id, matchingRole.id);

  if (!result.ok && JOIN_FIRST_TAGS.has(lowerTag)) {
    return {
      ok: false,
      reason: `couldn't rank up ${robloxUsername} — make sure they've requested to join the group first, then use .accept to bring them in before approving`,
    };
  }

  return result;
}

// Get all members in a roblox group that have a specific role
export async function getGroupMembersByRole(
  groupId: string,
  roleId: number,
): Promise<Array<{ userId: number; username: string }>> {
  const cookie = getRobloxCookie();
  const members: Array<{ userId: number; username: string }> = [];
  let cursor = "";

  do {
    try {
      const url = `https://groups.roblox.com/v1/groups/${groupId}/roles/${roleId}/users?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const response = await fetch(url, {
        headers: cookie ? { Cookie: `.ROBLOSECURITY=${cookie}` } : {},
      });
      if (!response.ok) break;
      const data = (await response.json()) as {
        data: Array<{ userId: number; username: string }>;
        nextPageCursor: string | null;
      };
      members.push(...(data.data ?? []));
      cursor = data.nextPageCursor ?? "";
    } catch {
      break;
    }
  } while (cursor);

  return members;
}
