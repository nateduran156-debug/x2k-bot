import fs from "fs";
import path from "path";

const DATA_DIR = path.resolve(process.cwd(), "data");

export function readJSON<T>(file: string): T {
  const fp = path.join(DATA_DIR, file);
  if (!fs.existsSync(fp)) return {} as T;
  try { return JSON.parse(fs.readFileSync(fp, "utf8")) as T; } catch { return {} as T; }
}

export function writeJSON(file: string, data: unknown): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
}

export interface GuildSettings {
  logChannel?: string;
  tagLogChannel?: string;
  botLogChannel?: string;
  ticketChannel?: string;
  verificationRole?: string;
  groupId?: string;
  flaggedGroups?: string[];
  groupNames?: Record<string, string>;
  commandRoles?: Record<string, string[]>;
  tagManagerRoles?: string[];
  pointsRole?: string;
  tagManagerRole?: string;
  verificationManagerRole?: string;
  verificationManagerRoles?: string[];
  pointsSupportRole?: string;
  prefix?: string;
  leaderboardMessage?: { channelId: string; messageId: string };
  rankRoles?: Array<{ roleId: string; points: number; name: string }>;
  approvedGroups?: Array<{ groupId: string; name: string }>;
  customTags?: string[];
  queueChannel?: string;
}

export interface TicketData {
  channelId: string;
  userId: string;
  guildId: string;
  type: "verification" | "tag" | "raidpoint";
  robloxUsername?: string;
  requestedTag?: string;
  proofUrl?: string;
  messageId?: string;
  messages: Array<{ author: string; authorId: string; content: string; timestamp: number }>;
  openedAt: number;
  closedAt?: number;
  closedBy?: string;
  closedById?: string;
  approvedBy?: string;
  approvedById?: string;
  status?: "open" | "approved" | "denied" | "closed";
}

export function getGuild(guildId: string): GuildSettings {
  const guilds = readJSON<Record<string, GuildSettings>>("guilds.json");
  if (!guilds[guildId]) guilds[guildId] = {};
  return guilds[guildId]!;
}

export function setGuild(guildId: string, data: Partial<GuildSettings>): void {
  const guilds = readJSON<Record<string, GuildSettings>>("guilds.json");
  guilds[guildId] = { ...(guilds[guildId] ?? {}), ...data };
  writeJSON("guilds.json", guilds);
}

export function getTickets(): Record<string, TicketData> {
  return readJSON("tickets.json");
}

export function setTicket(channelId: string, data: TicketData): void {
  const tickets = getTickets();
  tickets[channelId] = data;
  writeJSON("tickets.json", tickets);
}

export function deleteTicket(channelId: string): void {
  const tickets = getTickets();
  delete tickets[channelId];
  writeJSON("tickets.json", tickets);
}

export function addTicketMessage(channelId: string, msg: TicketData["messages"][0]): void {
  const tickets = getTickets();
  if (tickets[channelId]) {
    tickets[channelId]!.messages.push(msg);
    writeJSON("tickets.json", tickets);
  }
}

export function getPoints(guildId: string): Record<string, number> {
  const d = readJSON<Record<string, Record<string, number>>>("points.json");
  return d[guildId] ?? {};
}

export function savePoints(guildId: string, pts: Record<string, number>): void {
  const d = readJSON<Record<string, Record<string, number>>>("points.json");
  d[guildId] = pts;
  writeJSON("points.json", d);
}

export function getVerified(): Record<string, string> {
  return readJSON("verified.json");
}

export function setVerified(userId: string, robloxUsername: string): void {
  const v = getVerified();
  v[userId] = robloxUsername;
  writeJSON("verified.json", v);
}

export function removeVerified(userId: string): void {
  const v = getVerified();
  delete v[userId];
  writeJSON("verified.json", v);
}

export function getWhitelist(): Record<string, string[]> {
  return readJSON("whitelist.json");
}

export function setWhitelist(data: Record<string, string[]>): void {
  writeJSON("whitelist.json", data);
}

export function getRobloxCookie(): string | null {
  const envCookie = process.env["ROBLOX_COOKIE"];
  if (envCookie) return envCookie;
  const d = readJSON<{ cookie?: string }>("roblox.json");
  return d.cookie ?? null;
}

export function setRobloxCookie(cookie: string): void {
  writeJSON("roblox.json", { cookie });
}

export function memberHasCommandRole(
  member: { roles: { cache: Map<string, unknown> } },
  guildId: string,
  commandName: string,
): boolean {
  const s = getGuild(guildId);
  const allowed = (s.commandRoles ?? {})[commandName] ?? [];
  return allowed.some((id) => member.roles.cache.has(id));
}

export function memberHasPointsRole(
  member: { roles: { cache: Map<string, unknown> } },
  guildId: string,
): boolean {
  const s = getGuild(guildId);
  if (!s.pointsRole) return false;
  return member.roles.cache.has(s.pointsRole);
}

export function memberHasTagManagerRole(
  member: { roles: { cache: Map<string, unknown> } },
  guildId: string,
): boolean {
  const s = getGuild(guildId);
  if (!s.tagManagerRole) return false;
  return member.roles.cache.has(s.tagManagerRole);
}

export function memberHasVerificationManagerRole(
  member: { roles: { cache: Map<string, unknown> } },
  guildId: string,
): boolean {
  const s = getGuild(guildId);
  const roles: string[] = [
    ...(s.verificationManagerRoles ?? []),
    ...(s.verificationManagerRole ? [s.verificationManagerRole] : []),
  ];
  return roles.some((id) => member.roles.cache.has(id));
}

export function memberHasPSR(
  member: { roles: { cache: Map<string, unknown> } },
  guildId: string,
): boolean {
  const s = getGuild(guildId);
  if (!s.pointsSupportRole) return false;
  return member.roles.cache.has(s.pointsSupportRole);
}

export function getRegistered(): Record<string, string> {
  return readJSON("registered.json");
}

export function setRegistered(userId: string, robloxUsername: string): void {
  const r = getRegistered();
  r[userId] = robloxUsername;
  writeJSON("registered.json", r);
}

export function removeRegistered(userId: string): void {
  const r = getRegistered();
  delete r[userId];
  writeJSON("registered.json", r);
}

const BACKUP_FILES = ["guilds.json", "points.json", "tickets.json", "whitelist.json", "verified.json", "roblox.json", "registered.json"];

export function createBackup(): { createdAt: string; files: Record<string, unknown> } {
  const backup: Record<string, unknown> = {};
  for (const file of BACKUP_FILES) {
    const fp = path.join(DATA_DIR, file);
    if (fs.existsSync(fp)) {
      try { backup[file] = JSON.parse(fs.readFileSync(fp, "utf8")); } catch { backup[file] = {}; }
    }
  }
  return { createdAt: new Date().toISOString(), files: backup };
}

export function restoreBackup(backup: { files: Record<string, unknown> }): number {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  let restored = 0;
  for (const file of BACKUP_FILES) {
    if (backup.files[file] !== undefined) {
      fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(backup.files[file], null, 2));
      restored++;
    }
  }
  return restored;
}
