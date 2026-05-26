import {
  ActivityType, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  PermissionFlagsBits, type ChatInputCommandInteraction, type GuildMember, type TextChannel, type Guild,
} from "discord.js";
import { buildHelpMessage } from "../utils/help.js";
import {
  giveRobloxTagRole, getUserByUsername, getGroupRank, validateCookie,
  getUserGroups, isInGroup, getGroupInfo, getGroupInfoBatch, getUserAvatarUrl,
} from "../utils/roblox.js";
import {
  getGuild, setGuild, getWhitelist, setWhitelist, getPoints, savePoints,
  memberHasTagManagerRole, memberHasPointsRole, memberHasPSR,
  removeVerified, setVerified, setRobloxCookie, createBackup, restoreBackup, setRegistered,
} from "../utils/storage.js";
import { buildLeaderboardEmbed, refreshLeaderboard } from "../utils/leaderboard.js";
import { sendTicketPanel } from "./ticketHandler.js";
import { logCommand, logPoints, logSetup, logInfo } from "../utils/botLogger.js";
import { syncRankRoles } from "../utils/ranks.js";

const WHITE    = 0xffffff;
const GREEN    = 0x00cc55;
const RED      = 0xff3333;
const OWNER_IDS = new Set(["1472482602215538779"]);

const ALWAYS_FLAGGED: Array<{ id: string; name: string }> = [
  { id: "650907997",  name: "YNGS"     },
  { id: "16848719",   name: "Murked"   },
  { id: "214730861",  name: "MTX"      },
  { id: "33861944",   name: "XVII"     },
  { id: "495825805",  name: "Unloyal"  },
  { id: "862795072",  name: "Flaxx"    },
  { id: "32564331",   name: "EXE"      },
  { id: "265955381",  name: "Woken"    },
  { id: "15957207",   name: "GBG"      },
  { id: "1024109775", name: "Paranoia" },
  { id: "872867055",  name: "Laced"    },
  { id: "34546804",   name: "Snowfall" },
  { id: "489845165",  name: "Fraid"    },
  { id: "91960354",   name: "303w"     },
  { id: "580313332",  name: "Fallenk"  },
  { id: "339952823",  name: "Returnw"  },
  { id: "575770529",  name: "RANGERS"  },
  { id: "140364569",  name: "racek"    },
];
const ALWAYS_FLAGGED_MAP = Object.fromEntries(ALWAYS_FLAGGED.map((g) => [g.id, g.name]));
const ALWAYS_FLAGGED_IDS = new Set(ALWAYS_FLAGGED.map((g) => g.id));

function ts() { return new Date().toISOString(); }

function getMember(i: ChatInputCommandInteraction): GuildMember | null {
  return (i.member as GuildMember | null) ?? null;
}

function isOwner(i: ChatInputCommandInteraction) { return OWNER_IDS.has(i.user.id); }

function isSU(i: ChatInputCommandInteraction): boolean {
  const wl = getWhitelist();
  return isOwner(i) || (wl["bot"] ?? []).includes(i.user.id);
}
function admin(i: ChatInputCommandInteraction): boolean {
  return isSU(i);
}
function mgGuild(i: ChatInputCommandInteraction): boolean {
  return isSU(i);
}
function mgRoles(i: ChatInputCommandInteraction): boolean {
  return isSU(i);
}
function hasFullAccess(i: ChatInputCommandInteraction, cmd: string): boolean {
  const m = getMember(i);
  if (!m) return false;
  const wl = getWhitelist();
  const gid = i.guildId ?? "";
  return (
    isOwner(i) ||
    (wl["bot"] ?? []).includes(i.user.id) ||
    (wl[cmd] ?? []).includes(i.user.id) ||
    memberHasTagManagerRole(m, gid) ||
    memberHasPointsRole(m, gid) ||
    memberHasPSR(m, gid)
  );
}

async function fetchImage(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleSlashCommand(i: ChatInputCommandInteraction): Promise<any> {
  const guildId = i.guildId ?? "";

  switch (i.commandName) {

    // ── help ────────────────────────────────────────────────────────────────
    case "help": {
      return i.reply({ ...(buildHelpMessage("setup") as Parameters<typeof i.reply>[0]) });
    }

    // ── cookie ───────────────────────────────────────────────────────────────
    case "cookie": {
      if (!isOwner(i)) return i.reply({ content: "only the bot owner can set the cookie", ephemeral: true });
      const cookie = i.options.getString("cookie", true).trim();
      await i.deferReply({ ephemeral: true });
      const valid = await validateCookie(cookie);
      if (!valid) return i.editReply({ content: "that cookie doesn't work — double-check it and try again" });
      setRobloxCookie(cookie);
      return i.editReply({ content: `cookie set — logged in as **${valid.name}**` });
    }

    // ── sr ───────────────────────────────────────────────────────────────────
    case "sr": {
      if (!admin(i)) return i.reply({ content: "you're not authorized to use that command", ephemeral: true });
      const name = i.options.getString("name", true).trim().toLowerCase();
      if (!name) return i.reply({ content: "please provide a valid tag name", ephemeral: true });
      const s        = getGuild(guildId);
      const existing = s.customTags ?? [];
      if (existing.includes(name)) return i.reply({ content: `\`${name}\` is already a tag option`, ephemeral: true });
      existing.push(name);
      setGuild(guildId, { customTags: existing });
      return i.reply({ content: `tag option \`${name}\` added — it can now be used with \`/role\`` });
    }

    // ── role ─────────────────────────────────────────────────────────────────
    case "role": {
      const m   = getMember(i);
      const wl  = getWhitelist();
      const inDM = !i.guildId;

      const allowed = inDM
        ? (isOwner(i) || (wl["bot"] ?? []).includes(i.user.id))
        : (!!m && (admin(i) || memberHasTagManagerRole(m, guildId)));

      if (!allowed) return i.reply({ content: "you're not authorized to use that command", ephemeral: true });

      const s        = inDM ? { groupId: null, tagLogChannel: null, logChannel: null, customTags: [] } : getGuild(guildId);
      const customTags = (s as ReturnType<typeof getGuild>).customTags ?? [];
      const STATIC_TAGS = ["sharingan tag", "rockstar", "dark", "faze", "fraid", "member"];
      const ALL_TAGS    = [...STATIC_TAGS, ...customTags.map((t) => t.toLowerCase())];

      const username = i.options.getString("roblox", true).trim();
      const tag      = i.options.getString("tag", true).toLowerCase();
      if (!ALL_TAGS.includes(tag)) {
        const available = ALL_TAGS.length > 0 ? ALL_TAGS.map((t) => `\`${t}\``).join(", ") : "none — use /sr to add one";
        return i.reply({ content: `\`${tag}\` is not a valid tag. available tags: ${available}`, ephemeral: true });
      }
      await i.deferReply();
      const user = await getUserByUsername(username);
      if (!user) return i.editReply({ content: `can't find **${username}** on roblox` });

      const rankInfo    = s.groupId ? await getGroupRank(user.id, s.groupId).catch(() => null) : null;
      const currentRank = rankInfo ? `${rankInfo.rankName} (rank ${rankInfo.rankId})` : null;

      let robloxNote = "";
      const result = await giveRobloxTagRole(username, tag, customTags);
      robloxNote = result.ok ? `tag **${tag}** assigned on roblox` : `roblox role failed: ${result.reason}`;
      await i.editReply({
        embeds: [{
          color: WHITE,
          description: [
            `**${user.name}**`,
            currentRank ? `rank: ${currentRank}` : null,
            `tag: \`${tag}\``,
            robloxNote,
          ].filter(Boolean).join("\n"),
          footer: { text: `given by ${i.user.username}` },
          timestamp: ts(),
        }],
      });

      if (!inDM) {
        const logChannelId = (s as ReturnType<typeof getGuild>).tagLogChannel ?? (s as ReturnType<typeof getGuild>).logChannel;
        if (logChannelId) {
          const logCh = i.guild?.channels.cache.get(logChannelId) as TextChannel | undefined;
          if (logCh) {
            await logCh.send({
              embeds: [{
                color: WHITE,
                title: "Tag Given",
                description: [
                  `**Roblox:** \`${user.name}\``,
                  `**Given By:** <@${i.user.id}> (${i.user.username})`,
                  `**Tag:** \`${tag}\``,
                  rankInfo ? `**Previous Rank:** ${rankInfo.rankName}` : null,
                ].filter(Boolean).join("\n"),
                timestamp: ts(),
              }],
            }).catch(() => {});
          }
        }
        await logCommand(guildId, "Command: /role",
          `<@${i.user.id}> gave tag \`${tag}\` to **${user.name}**`,
          [{ name: "Roblox", value: user.name, inline: true }, { name: "Tag", value: tag, inline: true }],
        );
      }
      return;
    }

    // ── gc ───────────────────────────────────────────────────────────────────
    case "gc": {
      const username = i.options.getString("username", true).trim();
      await i.deferReply();
      const user = await getUserByUsername(username);
      if (!user) return i.editReply({ content: `couldn't find **${username}** on roblox` });
      const s       = getGuild(guildId);
      const groupId = s.groupId ?? "703716156";
      const [groups, inGroup, avatarUrl] = await Promise.all([
        getUserGroups(user.id),
        isInGroup(user.id, groupId).catch(() => false),
        getUserAvatarUrl(user.id).catch(() => null),
      ]);
      const guildFlaggedIds = s.flaggedGroups ?? [];
      const flaggedHits     = groups.filter((g) =>
        guildFlaggedIds.includes(String(g.group.id)) || ALWAYS_FLAGGED_IDS.has(String(g.group.id)),
      );
      const isFlagged  = flaggedHits.length > 0;
      const embedColor = isFlagged ? RED : inGroup ? GREEN : WHITE;
      const profileUrl = `https://www.roblox.com/users/${user.id}/profile`;
      const header     = `**[${user.name}](${profileUrl})**\n\n**Groups**\n`;
      const MAX_DESC   = 4096;
      const groupLines = groups.length > 0
        ? groups.map((g) => `• [${g.group.name}](https://www.roblox.com/groups/${g.group.id})`)
        : ["• none"];
      let groupList = "";
      for (const line of groupLines) {
        if ((header + groupList + line + "\n").length > MAX_DESC - 30) {
          groupList += `… and ${groups.length - groupList.split("\n").filter(Boolean).length} more`;
          break;
        }
        groupList += line + "\n";
      }
      groupList = groupList.trimEnd() || "• none";
      const mainEmbed: Record<string, unknown> = {
        color: embedColor,
        description: `${header}${groupList}`,
        footer: { text: i.client.user?.username ?? "bot" },
        timestamp: ts(),
      };
      if (avatarUrl) mainEmbed["thumbnail"] = { url: avatarUrl };
      const embeds: object[] = [mainEmbed];
      if (isFlagged) {
        embeds.push({
          color: RED,
          description: `**[${user.name}](${profileUrl})** is not cleared — ask them to leave:\n\n${flaggedHits.map((m) => `• [${m.group.name}](https://www.roblox.com/groups/${m.group.id})`).join("\n")}`,
          timestamp: ts(),
        });
      }
      embeds.push({
        color: embedColor,
        description: inGroup
          ? `✓ **[${user.name}](${profileUrl})** is in the group and good to verify\n\n**Group ID:** \`${groupId}\`\n**Link:** [Join Here](https://www.roblox.com/communities/${groupId})`
          : `✗ **[${user.name}](${profileUrl})** is not in the group\n\n**Group ID:** \`${groupId}\`\n**Link:** [Join Here](https://www.roblox.com/communities/${groupId})`,
        timestamp: ts(),
      });
      return i.editReply({ embeds });
    }

    // ── flag ─────────────────────────────────────────────────────────────────
    case "flag": {
      if (!mgGuild(i)) return i.reply({ content: "you're not authorized to use that command", ephemeral: true });
      const gid = i.options.getString("groupid", true).trim();
      if (isNaN(Number(gid))) return i.reply({ content: "please provide a valid group id", ephemeral: true });
      if (ALWAYS_FLAGGED_IDS.has(gid)) return i.reply({ content: `\`${gid}\` is already in the global flag list`, ephemeral: true });
      const s       = getGuild(guildId);
      const flagged = s.flaggedGroups ?? [];
      if (flagged.includes(gid)) return i.reply({ content: `\`${gid}\` is already flagged`, ephemeral: true });
      await i.deferReply();
      flagged.push(gid);
      const info       = await getGroupInfo(gid).catch(() => null);
      const groupNames = s.groupNames ?? {};
      if (info?.name) groupNames[String(gid)] = info.name;
      setGuild(guildId, { flaggedGroups: flagged, groupNames });
      await logSetup(guildId, "Group Flagged", `<@${i.user.id}> flagged **${info?.name ?? gid}** (\`${gid}\`)`);
      return i.editReply({ content: `flagged **${info?.name ?? gid}** (\`${gid}\`)` });
    }

    // ── unflag ───────────────────────────────────────────────────────────────
    case "unflag": {
      if (!mgGuild(i)) return i.reply({ content: "you're not authorized to use that command", ephemeral: true });
      const gid = i.options.getString("groupid", true).trim();
      if (ALWAYS_FLAGGED_IDS.has(gid)) return i.reply({ content: `\`${gid}\` is in the global list and can't be unflagged`, ephemeral: true });
      const s       = getGuild(guildId);
      const flagged = s.flaggedGroups ?? [];
      if (!flagged.includes(gid)) return i.reply({ content: `\`${gid}\` isn't on the list`, ephemeral: true });
      setGuild(guildId, { flaggedGroups: flagged.filter((g) => g !== gid) });
      await logSetup(guildId, "Group Unflagged", `<@${i.user.id}> unflagged group \`${gid}\``);
      return i.reply({ content: `unflagged \`${gid}\`` });
    }

    // ── flist ────────────────────────────────────────────────────────────────
    case "flist": {
      await i.deferReply();
      const s        = getGuild(guildId);
      const custom   = s.flaggedGroups ?? [];
      const combined = [...new Set([...ALWAYS_FLAGGED.map((g) => g.id), ...custom])];
      const apiMap      = await getGroupInfoBatch(combined);
      const storedNames = s.groupNames ?? {};
      const lines = combined.map((id, idx) => {
        const name = apiMap[id] ?? ALWAYS_FLAGGED_MAP[id] ?? storedNames[id] ?? "Unknown Group";
        return `\`${idx + 1}.\` [${name}](https://www.roblox.com/groups/${id}) \`${id}\``;
      });
      const MAX = 4000;
      const pages: string[] = [];
      let cur = "";
      for (const line of lines) {
        const next = cur ? cur + "\n" + line : line;
        if (next.length > MAX) { pages.push(cur); cur = line; } else { cur = next; }
      }
      if (cur) pages.push(cur);
      await i.editReply({
        embeds: [{ color: WHITE, title: `flagged groups (${combined.length})`, description: pages[0], footer: { text: i.client.user?.username ?? "bot" }, timestamp: ts() }],
      });
      for (let p = 1; p < pages.length; p++) {
        await (i.channel as TextChannel)?.send({ embeds: [{ color: WHITE, description: pages[p], footer: { text: `page ${p + 1}/${pages.length}` } }] });
      }
      return;
    }

    // ── verify ───────────────────────────────────────────────────────────────
    case "verify": {
      if (!mgRoles(i)) return i.reply({ content: "you're not authorized to use that command", ephemeral: true });
      const target     = i.options.getUser("user", true);
      const robloxName = i.options.getString("roblox") ?? null;
      const s          = getGuild(guildId);
      if (!s.verificationRole) return i.reply({ content: "no verification role set — run `/vset @role` first", ephemeral: true });
      const member = await i.guild?.members.fetch(target.id).catch(() => null);
      if (!member) return i.reply({ content: "couldn't find that member", ephemeral: true });
      await member.roles.add(s.verificationRole).catch(() => {});
      if (robloxName) setVerified(target.id, robloxName);
      await logCommand(guildId, "Manual Verify",
        `<@${i.user.id}> verified <@${target.id}>${robloxName ? ` as **${robloxName}**` : ""}`,
        [{ name: "User", value: `<@${target.id}>`, inline: true }, { name: "Roblox", value: robloxName ?? "N/A", inline: true }],
      );
      return i.reply({ content: `verified <@${target.id}>${robloxName ? ` as **${robloxName}**` : ""}` });
    }

    // ── unverify ─────────────────────────────────────────────────────────────
    case "unverify": {
      if (!mgRoles(i)) return i.reply({ content: "you're not authorized to use that command", ephemeral: true });
      const target = i.options.getUser("user", true);
      const s      = getGuild(guildId);
      const member = await i.guild?.members.fetch(target.id).catch(() => null);
      if (member && s.verificationRole) await member.roles.remove(s.verificationRole).catch(() => {});
      removeVerified(target.id);
      await logCommand(guildId, "Manual Unverify", `<@${i.user.id}> unverified <@${target.id}>`);
      return i.reply({ content: `removed verification from <@${target.id}>` });
    }

    // ── setupticket ──────────────────────────────────────────────────────────
    case "setupticket": {
      if (!mgGuild(i)) return i.reply({ content: "you're not authorized to use that command", ephemeral: true });
      const ch   = i.options.getChannel("channel", true) as TextChannel;
      const type = (i.options.getString("type") ?? "both") as "verification" | "tag" | "both";
      await i.deferReply();
      await sendTicketPanel(ch, type);
      setGuild(guildId, { ticketChannel: ch.id });
      await logSetup(guildId, "Ticket Panel Set Up",
        `<@${i.user.id}> set up the ticket panel`,
        [{ name: "Type", value: type, inline: true }, { name: "Channel", value: `<#${ch.id}>`, inline: true }],
      );
      return i.editReply({ content: `panel sent to <#${ch.id}>` });
    }

    // ── logset ───────────────────────────────────────────────────────────────
    case "logset": {
      if (!mgGuild(i)) return i.reply({ content: "you're not authorized to use that command", ephemeral: true });
      const ch = i.options.getChannel("channel", true) as TextChannel;
      setGuild(guildId, { logChannel: ch.id });
      await logSetup(guildId, "Log Channel Set", `<@${i.user.id}> set the log channel to <#${ch.id}>`);
      return i.reply({ content: `logs going to <#${ch.id}> now` });
    }

    // ── taglogset ────────────────────────────────────────────────────────────
    case "taglogset": {
      if (!mgGuild(i)) return i.reply({ content: "you're not authorized to use that command", ephemeral: true });
      const ch = i.options.getChannel("channel", true) as TextChannel;
      setGuild(guildId, { tagLogChannel: ch.id });
      await logSetup(guildId, "Tag Log Channel Set", `<@${i.user.id}> set the tag log channel to <#${ch.id}>`);
      return i.reply({ content: `tag logs going to <#${ch.id}> now` });
    }

    // ── botlogset ────────────────────────────────────────────────────────────
    case "botlogset": {
      if (!admin(i)) return i.reply({ content: "you're not authorized to use that command", ephemeral: true });
      const ch = i.options.getChannel("channel", true) as TextChannel;
      setGuild(guildId, { botLogChannel: ch.id });
      await logInfo(guildId, "Bot Log Channel Set",
        `<@${i.user.id}> set this channel as the bot log channel. all bot activity will be logged here.`,
      );
      return i.reply({ content: `bot logs going to <#${ch.id}> now` });
    }

    // ── vset ─────────────────────────────────────────────────────────────────
    case "vset": {
      if (!mgGuild(i)) return i.reply({ content: "you're not authorized to use that command", ephemeral: true });
      const role = i.options.getRole("role", true);
      setGuild(guildId, { verificationRole: role.id });
      await logSetup(guildId, "Verification Role Set", `<@${i.user.id}> set the verification role to <@&${role.id}>`);
      return i.reply({ content: `verification role is now <@&${role.id}>` });
    }

    // ── gid ──────────────────────────────────────────────────────────────────
    case "gid": {
      if (!mgGuild(i)) return i.reply({ content: "you're not authorized to use that command", ephemeral: true });
      const groupId = i.options.getString("groupid", true).trim();
      if (isNaN(Number(groupId))) return i.reply({ content: "please provide a valid Roblox group id", ephemeral: true });
      setGuild(guildId, { groupId });
      await logSetup(guildId, "Group ID Set", `<@${i.user.id}> set the group ID to \`${groupId}\``);
      return i.reply({ content: `group id set to \`${groupId}\`` });
    }

    // ── prefix ───────────────────────────────────────────────────────────────
    case "prefix": {
      if (!admin(i)) return i.reply({ content: "you're not authorized to use that command", ephemeral: true });
      const newPrefix = i.options.getString("prefix", true);
      if (newPrefix.length > 5) return i.reply({ content: "keep it under 5 characters", ephemeral: true });
      setGuild(guildId, { prefix: newPrefix });
      await logSetup(guildId, "Prefix Changed", `<@${i.user.id}> changed the prefix to \`${newPrefix}\``);
      return i.reply({ content: `prefix is now \`${newPrefix}\`` });
    }

    // ── wl ───────────────────────────────────────────────────────────────────
    case "wl": {
      if (!admin(i)) return i.reply({ content: "you're not authorized to use that command", ephemeral: true });
      const sub = i.options.getSubcommand();
      if (sub === "bot") {
        const t      = i.options.getUser("user", true);
        const wlData = getWhitelist();
        wlData["bot"] = wlData["bot"] ?? [];
        if (wlData["bot"].includes(t.id)) return i.reply({ content: `<@${t.id}> already has full access`, ephemeral: true });
        wlData["bot"].push(t.id);
        setWhitelist(wlData);
        await logSetup(guildId, "Whitelist Updated", `<@${i.user.id}> gave <@${t.id}> full bot access`);
        return i.reply({ content: `<@${t.id}> now has access to all commands` });
      }
      if (sub === "command") {
        const cmdName = i.options.getString("name", true);
        const t       = i.options.getUser("user", true);
        const wlData  = getWhitelist();
        wlData[cmdName] = wlData[cmdName] ?? [];
        if (wlData[cmdName]!.includes(t.id)) return i.reply({ content: `<@${t.id}> can already use \`${cmdName}\``, ephemeral: true });
        wlData[cmdName]!.push(t.id);
        setWhitelist(wlData);
        await logSetup(guildId, "Whitelist Updated", `<@${i.user.id}> gave <@${t.id}> access to \`${cmdName}\``);
        return i.reply({ content: `<@${t.id}> can now use \`${cmdName}\`` });
      }
      return;
    }

    // ── wlrole ───────────────────────────────────────────────────────────────
    case "wlrole": {
      if (!mgGuild(i)) return i.reply({ content: "you're not authorized to use that command", ephemeral: true });
      const role    = i.options.getRole("role", true);
      const cmdName = i.options.getString("command")?.toLowerCase() ?? null;
      const s       = getGuild(guildId);
      if (!cmdName) {
        const roles = s.tagManagerRoles ?? [];
        if (roles.includes(role.id)) return i.reply({ content: `<@&${role.id}> is already a tag manager role`, ephemeral: true });
        roles.push(role.id);
        setGuild(guildId, { tagManagerRoles: roles });
        await logSetup(guildId, "Role Whitelisted", `<@${i.user.id}> made <@&${role.id}> a tag manager role`);
        return i.reply({ content: `<@&${role.id}> can now manage tag tickets` });
      }
      const commandRoles = s.commandRoles ?? {};
      commandRoles[cmdName] = commandRoles[cmdName] ?? [];
      if (commandRoles[cmdName]!.includes(role.id)) return i.reply({ content: `<@&${role.id}> already has access to \`${cmdName}\``, ephemeral: true });
      commandRoles[cmdName]!.push(role.id);
      setGuild(guildId, { commandRoles });
      await logSetup(guildId, "Role Whitelisted", `<@${i.user.id}> gave <@&${role.id}> access to \`${cmdName}\``);
      return i.reply({ content: `<@&${role.id}> can now use \`${cmdName}\`` });
    }

    // ── wlp ──────────────────────────────────────────────────────────────────
    case "wlp": {
      if (!admin(i)) return i.reply({ content: "you're not authorized to use that command", ephemeral: true });
      const role = i.options.getRole("role", true);
      const s    = getGuild(guildId);
      if (s.pointsRole === role.id) return i.reply({ content: `<@&${role.id}> already manages points`, ephemeral: true });
      setGuild(guildId, { pointsRole: role.id });
      await logSetup(guildId, "Points Role Set", `<@${i.user.id}> gave <@&${role.id}> full points access`);
      return i.reply({ content: `<@&${role.id}> can now use all raid points commands` });
    }

    // ── tmr ──────────────────────────────────────────────────────────────────
    case "tmr": {
      if (!admin(i)) return i.reply({ content: "you're not authorized to use that command", ephemeral: true });
      const role = i.options.getRole("role", true);
      setGuild(guildId, { tagManagerRole: role.id });
      await logSetup(guildId, "Tag Manager Role Set", `<@${i.user.id}> set the tag manager role to <@&${role.id}>`);
      return i.reply({ content: `<@&${role.id}> is now the tag manager role — they can use \`/role\`` });
    }

    // ── vmr ──────────────────────────────────────────────────────────────────
    case "vmr": {
      if (!admin(i)) return i.reply({ content: "you're not authorized to use that command", ephemeral: true });
      const sub  = i.options.getSubcommand();
      const role = i.options.getRole("role");
      const s    = getGuild(guildId);

      if (sub === "list") {
        const roles: string[] = [
          ...(s.verificationManagerRoles ?? []),
          ...(s.verificationManagerRole ? [s.verificationManagerRole] : []),
        ];
        if (roles.length === 0) return i.reply({ content: "no verification manager roles configured yet", ephemeral: true });
        return i.reply({ embeds: [{ color: WHITE, title: "verification manager roles", description: roles.map((id) => `<@&${id}>`).join("\n"), footer: { text: i.guild?.name ?? "bot" }, timestamp: ts() }] });
      }

      if (sub === "remove") {
        if (!role) return i.reply({ content: "please select a role to remove", ephemeral: true });
        const current = s.verificationManagerRoles ?? [];
        if (!current.includes(role.id)) return i.reply({ content: `<@&${role.id}> isn't in the VMR list`, ephemeral: true });
        setGuild(guildId, { verificationManagerRoles: current.filter((id) => id !== role.id) });
        await logSetup(guildId, "VMR Role Removed", `<@${i.user.id}> removed <@&${role.id}> from the verification manager roles`);
        return i.reply({ content: `<@&${role.id}> has been removed from the verification manager roles` });
      }

      // sub === "add"
      if (!role) return i.reply({ content: "please select a role to add", ephemeral: true });
      const current = s.verificationManagerRoles ?? [];
      if (current.includes(role.id)) return i.reply({ content: `<@&${role.id}> is already a verification manager role`, ephemeral: true });
      current.push(role.id);
      setGuild(guildId, { verificationManagerRoles: current });
      await logSetup(guildId, "VMR Role Added", `<@${i.user.id}> added <@&${role.id}> as a verification manager role`);
      return i.reply({ content: `<@&${role.id}> added to the verification manager roles — they can use the Verify, Kick, and Close buttons in verification tickets` });
    }

    // ── psr ──────────────────────────────────────────────────────────────────
    case "psr": {
      if (!admin(i)) return i.reply({ content: "you're not authorized to use that command", ephemeral: true });
      const role = i.options.getRole("role", true);
      setGuild(guildId, { pointsSupportRole: role.id });
      await logSetup(guildId, "Points Support Role Set", `<@${i.user.id}> set the points support role to <@&${role.id}>`);
      return i.reply({ content: `<@&${role.id}> is now the points support role — they can use \`/check\`, \`/leaderboard\`, and \`/rankup\`` });
    }

    // ── whitelisted ──────────────────────────────────────────────────────────
    case "whitelisted": {
      if (!admin(i)) return i.reply({ content: "you're not authorized to use that command", ephemeral: true });
      const wlData       = getWhitelist();
      const s            = getGuild(guildId);
      const lines: string[] = [];
      for (const k of Object.keys(wlData)) {
        if ((wlData[k] ?? []).length > 0) {
          lines.push(`**\`${k}\`** (users)\n${wlData[k]!.map((id) => `<@${id}>`).join(", ")}`);
        }
      }
      const commandRoles = s.commandRoles ?? {};
      for (const k of Object.keys(commandRoles)) {
        if ((commandRoles[k] ?? []).length > 0) {
          lines.push(`**\`${k}\`** (roles)\n${commandRoles[k]!.map((id) => `<@&${id}>`).join(", ")}`);
        }
      }
      if ((s.tagManagerRoles ?? []).length > 0) lines.push(`**tag manager** (roles)\n${s.tagManagerRoles!.map((id) => `<@&${id}>`).join(", ")}`);
      if (s.tagManagerRole) lines.push(`**tag manager role** (/tmr)\n<@&${s.tagManagerRole}> — can use \`/role\``);
      if (s.pointsRole) lines.push(`**points manager** (role)\n<@&${s.pointsRole}>`);
      if (s.pointsSupportRole) lines.push(`**points support role** (/psr)\n<@&${s.pointsSupportRole}> — can use \`/check\`, \`/leaderboard\`, \`/rankup\``);
      if (lines.length === 0) return i.reply({ content: "nothing whitelisted yet", ephemeral: true });
      return i.reply({ embeds: [{ color: WHITE, description: lines.join("\n\n"), footer: { text: i.guild?.name ?? "bot" }, timestamp: ts() }] });
    }

    // ── rankup ───────────────────────────────────────────────────────────────
    case "rankup": {
      if (!hasFullAccess(i, "rankup")) return i.reply({ content: "you're not authorized to use that command", ephemeral: true });
      const target = i.options.getUser("user", true);
      const amount = i.options.getInteger("amount") ?? 1;
      await i.deferReply();
      const pts = getPoints(guildId);
      pts[target.id] = (pts[target.id] ?? 0) + amount;
      savePoints(guildId, pts);
      refreshLeaderboard(i.client, guildId).catch(() => {});
      const { gained } = await syncRankRoles(i.guild!, target.id, pts[target.id] ?? 0, getGuild(guildId).rankRoles ?? []);
      const promotionNote = gained.length > 0 ? `\nrank${gained.length > 1 ? "s" : ""} unlocked: ${gained.join(", ")}` : "";
      await logPoints(guildId, "Points Added",
        `<@${i.user.id}> gave **+${amount}** to <@${target.id}>`,
        [{ name: "New Total", value: `${pts[target.id]} pts`, inline: true }],
      );
      return i.editReply({ embeds: [{ color: WHITE, description: `+**${amount}** to <@${target.id}> — **${pts[target.id]}** pt${pts[target.id] !== 1 ? "s" : ""} total${promotionNote}`, footer: { text: `given by ${i.user.username}` }, timestamp: ts() }] });
    }

    // ── removepoints ─────────────────────────────────────────────────────────
    case "removepoints": {
      if (!hasFullAccess(i, "remove")) return i.reply({ content: "you're not authorized to use that command", ephemeral: true });
      const target = i.options.getUser("user", true);
      const amount = i.options.getInteger("amount") ?? 1;
      await i.deferReply();
      const pts = getPoints(guildId);
      pts[target.id] = Math.max(0, (pts[target.id] ?? 0) - amount);
      savePoints(guildId, pts);
      refreshLeaderboard(i.client, guildId).catch(() => {});
      const { lost } = await syncRankRoles(i.guild!, target.id, pts[target.id] ?? 0, getGuild(guildId).rankRoles ?? []);
      const demotionNote = lost.length > 0 ? `\nrank${lost.length > 1 ? "s" : ""} removed: ${lost.join(", ")}` : "";
      await logPoints(guildId, "Points Removed",
        `<@${i.user.id}> removed **-${amount}** from <@${target.id}>`,
        [{ name: "New Total", value: `${pts[target.id]} pts`, inline: true }],
      );
      return i.editReply({ embeds: [{ color: WHITE, description: `-**${amount}** from <@${target.id}> — **${pts[target.id]}** pt${pts[target.id] !== 1 ? "s" : ""} total${demotionNote}`, footer: { text: `removed by ${i.user.username}` }, timestamp: ts() }] });
    }

    // ── resetall ─────────────────────────────────────────────────────────────
    case "resetall": {
      const m = getMember(i);
      const hasAccess = admin(i) || (m && memberHasPointsRole(m, guildId));
      if (!hasAccess) return i.reply({ content: "you're not authorized to use that command", ephemeral: true });
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("resetall_confirm").setLabel("reset all points").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("resetall_cancel").setLabel("cancel").setStyle(ButtonStyle.Secondary),
      );
      await i.reply({
        embeds: [{ color: WHITE, title: "reset all points", description: "this wipes **every** raid point in the server and can't be undone", footer: { text: `requested by ${i.user.username}` }, timestamp: ts() }],
        components: [row],
        ephemeral: true,
      });
      const msg = await i.fetchReply();
      const collector = msg.createMessageComponentCollector({ filter: (btn) => btn.user.id === i.user.id, time: 15000 });
      collector.on("collect", async (btn) => {
        if (btn.customId === "resetall_confirm") {
          const { readJSON, writeJSON } = await import("../utils/storage.js");
          const d = readJSON<Record<string, unknown>>("points.json");
          d[guildId] = {};
          writeJSON("points.json", d);
          const rankCfgReset = getGuild(guildId);
          for (const rank of rankCfgReset.rankRoles ?? []) {
            const rankRole = i.guild!.roles.cache.get(rank.roleId);
            if (rankRole) {
              for (const [, roleMember] of rankRole.members) {
                await roleMember.roles.remove(rank.roleId).catch(() => {});
              }
            }
          }
          await logPoints(guildId, "Points Reset", `<@${i.user.id}> wiped all raid points and rank roles in this server`);
          await btn.update({ embeds: [{ color: WHITE, title: "points wiped", description: "all raid points cleared and all rank roles removed", footer: { text: `done by ${i.user.username}` }, timestamp: ts() }], components: [] });
        } else {
          await btn.update({ embeds: [{ color: WHITE, title: "cancelled", description: "nothing changed", timestamp: ts() }], components: [] });
        }
        collector.stop();
      });
      collector.on("end", (_, reason) => { if (reason === "time") i.editReply({ components: [] }).catch(() => {}); });
      return;
    }

    // ── register ─────────────────────────────────────────────────────────────
    case "register": {
      const robloxName = i.options.getString("username", true).trim();
      await i.deferReply({ ephemeral: true });
      const robloxUser = await getUserByUsername(robloxName).catch(() => null);
      if (!robloxUser) {
        return i.editReply({ content: `could not find **${robloxName}** on Roblox — double-check the spelling and try again.` });
      }
      setRegistered(i.user.id, robloxUser.name);
      return i.editReply({
        embeds: [{
          color: WHITE,
          title: "Registration Confirmed",
          description: [
            `**Discord:** ${i.user.username}`,
            `**Roblox:** ${robloxUser.name}`,
            "Your account has been linked. Run `/register` again at any time to update your username.",
          ].join("\n"),
          timestamp: ts(),
        }],
      });
    }

    case "check": {
      const target = i.options.getUser("user");
      const m      = getMember(i);
      if (target && target.id !== i.user.id) {
        if (!hasFullAccess(i, "check") && !(m && memberHasPSR(m, guildId))) {
          return i.reply({ content: "you're not authorized to use that command", ephemeral: true });
        }
      }
      const subject = target ?? i.user;
      const pts     = getPoints(guildId);
      const p       = pts[subject.id] ?? 0;
      return i.reply({ embeds: [{ color: WHITE, description: `<@${subject.id}> — **${p}** pt${p !== 1 ? "s" : ""}`, footer: { text: i.guild?.name ?? "bot" }, timestamp: ts() }] });
    }

    // ── leaderboard ──────────────────────────────────────────────────────────
    case "leaderboard": {
      const pts   = getPoints(guildId);
      const embed = buildLeaderboardEmbed(pts, i.guild?.name ?? "server");
      if (!embed) return i.reply({ content: "nobody has any points yet. be the first!", ephemeral: true });
      await i.reply({ embeds: [embed] });
      const msg = await i.fetchReply();
      setGuild(guildId, { leaderboardMessage: { channelId: i.channelId, messageId: msg.id } });
      return;
    }

    // ── leaderboardpanel ─────────────────────────────────────────────────────
    case "leaderboardpanel": {
      if (!mgGuild(i)) return i.reply({ content: "you're not authorized to use that command", ephemeral: true });
      await i.deferReply({ ephemeral: true });
      const ch    = (i.options.getChannel("channel", true)) as import("discord.js").TextChannel;
      const pts   = getPoints(guildId);
      const embed = buildLeaderboardEmbed(pts, i.guild?.name ?? "server");
      if (!embed) return i.editReply({ content: "nobody has any points yet — the leaderboard will appear here once points are awarded." });
      const msg = await ch.send({ embeds: [embed] });
      setGuild(guildId, { leaderboardMessage: { channelId: ch.id, messageId: msg.id } });
      return i.editReply({ content: `leaderboard panel sent to <#${ch.id}> — it will automatically refresh every 10 minutes.` });
    }

    // ── raidpointspanel ──────────────────────────────────────────────────────
    case "raidpointspanel": {
      if (!mgGuild(i)) return i.reply({ content: "you're not authorized to use that command", ephemeral: true });
      await i.deferReply({ ephemeral: true });
      const ch  = (i.options.getChannel("channel", true)) as import("discord.js").TextChannel;
      const btn = new ButtonBuilder()
        .setCustomId("raid_point_request")
        .setLabel("Request a Raid Point")
        .setStyle(ButtonStyle.Primary);
      await ch.send({
        embeds: [{
          color: 0xffffff,
          title: "Raid Points",
          description: "Click the button below to submit a raid point request. You will be prompted to provide your Roblox username and a screenshot confirming your participation in the raid. All submissions are reviewed by staff before points are awarded.",
          footer: { text: "submissions that cannot be verified will be denied" },
          timestamp: new Date().toISOString(),
        }],
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(btn)],
      });
      return i.editReply({ content: `raid point panel sent to <#${ch.id}>.` });
    }

    // ── addrank ──────────────────────────────────────────────────────────────
    case "addrank": {
      if (!mgGuild(i)) return i.reply({ content: "you're not authorized to use that command", ephemeral: true });
      const roleId   = i.options.getString("roleid", true).replace(/\D/g, "");
      const points   = i.options.getInteger("points", true);
      const rankName = i.options.getString("name") ?? null;
      if (!roleId) return i.reply({ content: "please provide a valid role id", ephemeral: true });
      const role = i.guild?.roles.cache.get(roleId);
      if (!role) return i.reply({ content: `couldn't find a role with id \`${roleId}\``, ephemeral: true });
      const s     = getGuild(guildId);
      const ranks = s.rankRoles ?? [];
      if (ranks.length >= 30) return i.reply({ content: "you've hit the 30 rank limit — remove one before adding another", ephemeral: true });
      if (ranks.some((r) => r.roleId === roleId)) return i.reply({ content: `<@&${roleId}> is already configured as a rank`, ephemeral: true });
      ranks.push({ roleId, points, name: rankName ?? role.name });
      setGuild(guildId, { rankRoles: ranks });
      await logSetup(guildId, "Rank Added", `<@${i.user.id}> added rank **${rankName ?? role.name}** at **${points}** pts`);
      return i.reply({ content: `rank added — <@&${roleId}> unlocks at **${points}** points as **${rankName ?? role.name}**` });
    }

    // ── removerank ───────────────────────────────────────────────────────────
    case "removerank": {
      if (!mgGuild(i)) return i.reply({ content: "you're not authorized to use that command", ephemeral: true });
      const roleId = i.options.getString("roleid", true).replace(/\D/g, "");
      const s      = getGuild(guildId);
      const ranks  = s.rankRoles ?? [];
      const idx    = ranks.findIndex((r) => r.roleId === roleId);
      if (idx === -1) return i.reply({ content: `\`${roleId}\` isn't configured as a rank`, ephemeral: true });
      const [removed] = ranks.splice(idx, 1);
      setGuild(guildId, { rankRoles: ranks });
      await logSetup(guildId, "Rank Removed", `<@${i.user.id}> removed rank **${removed!.name}**`);
      return i.reply({ content: `removed **${removed!.name}** from the rank configuration` });
    }

    // ── ranks ────────────────────────────────────────────────────────────────
    case "ranks": {
      const s     = getGuild(guildId);
      const ranks = (s.rankRoles ?? []).sort((a, b) => a.points - b.points);
      if (ranks.length === 0) return i.reply({ content: "no ranks configured yet — use `/addrank` to get started", ephemeral: true });
      const lines = ranks.map((r, idx) => `\`${idx + 1}.\` <@&${r.roleId}> — **${r.points}** pts — \`${r.name}\``);
      return i.reply({ embeds: [{ color: WHITE, title: `rank configuration (${ranks.length}/30)`, description: lines.join("\n"), footer: { text: i.guild?.name ?? "bot" }, timestamp: ts() }] });
    }

    // ── setstatus ────────────────────────────────────────────────────────────
    case "setstatus": {
      if (!admin(i)) return i.reply({ content: "you're not authorized to use that command", ephemeral: true });
      const text = i.options.getString("text", true);
      if (text.toLowerCase() === "clear") {
        i.client.user?.setPresence({ activities: [] });
        await logInfo(guildId, "Status Cleared", `<@${i.user.id}> cleared the bot status`);
        return i.reply({ content: "status cleared" });
      }
      i.client.user?.setPresence({ activities: [{ name: text, type: ActivityType.Playing }] });
      await logInfo(guildId, "Status Updated", `<@${i.user.id}> set the bot status to: **${text}**`);
      return i.reply({ content: `status set to **${text}**` });
    }

    // ── setpresence ──────────────────────────────────────────────────────────
    case "setpresence": {
      if (!admin(i)) return i.reply({ content: "you're not authorized to use that command", ephemeral: true });
      const status = i.options.getString("status", true) as "online" | "idle" | "dnd" | "invisible";
      i.client.user?.setPresence({ status });
      await logInfo(guildId, "Presence Updated", `<@${i.user.id}> set bot presence to **${status}**`);
      return i.reply({ content: `presence set to **${status}**` });
    }

    // ── setavatar ────────────────────────────────────────────────────────────
    case "setavatar": {
      if (!admin(i)) return i.reply({ content: "you're not authorized to use that command", ephemeral: true });
      const url        = i.options.getString("url") ?? i.options.getAttachment("image")?.url;
      if (!url) return i.reply({ content: "please provide a url or attach an image", ephemeral: true });
      await i.deferReply();
      try {
        const buffer = await fetchImage(url);
        await i.client.user!.setAvatar(buffer);
        await logInfo(guildId, "Avatar Updated", `<@${i.user.id}> changed the bot's profile picture`);
        return i.editReply({ content: "pfp updated" });
      } catch (e: unknown) {
        return i.editReply({ content: `couldn't update it — ${String(e)}` });
      }
    }

    // ── setbanner ────────────────────────────────────────────────────────────
    case "setbanner": {
      if (!admin(i)) return i.reply({ content: "you're not authorized to use that command", ephemeral: true });
      const url = i.options.getString("url") ?? i.options.getAttachment("image")?.url;
      if (!url) return i.reply({ content: "please provide a url or attach an image", ephemeral: true });
      await i.deferReply();
      try {
        const buffer = await fetchImage(url);
        await (i.client.user as import("discord.js").ClientUser & { setBanner: (b: Buffer) => Promise<unknown> }).setBanner(buffer);
        await logInfo(guildId, "Banner Updated", `<@${i.user.id}> changed the bot's banner`);
        return i.editReply({ content: "banner updated" });
      } catch (e: unknown) {
        return i.editReply({ content: `couldn't update it — make sure the bot has nitro. error: ${String(e)}` });
      }
    }

    // ── setusername ──────────────────────────────────────────────────────────
    case "setusername": {
      if (!admin(i)) return i.reply({ content: "you're not authorized to use that command", ephemeral: true });
      const name = i.options.getString("name", true);
      if (name.length < 2 || name.length > 32) return i.reply({ content: "name has to be between 2 and 32 characters", ephemeral: true });
      await i.deferReply();
      try {
        await i.client.user!.setUsername(name);
        await logInfo(guildId, "Username Updated", `<@${i.user.id}> changed the bot username to **${name}**`);
        return i.editReply({ content: `username is now **${name}**` });
      } catch (e: unknown) {
        return i.editReply({ content: `couldn't update it — discord rate-limits username changes, wait a bit. error: ${String(e)}` });
      }
    }

    // ── setnickname ──────────────────────────────────────────────────────────
    case "setnickname": {
      if (!admin(i)) return i.reply({ content: "you're not authorized to use that command", ephemeral: true });
      const nick = i.options.getString("name") ?? null;
      await i.deferReply();
      try {
        const botMember = i.guild!.members.cache.get(i.client.user!.id)
          ?? await i.guild!.members.fetch(i.client.user!.id);
        await botMember.setNickname(nick);
        await logInfo(guildId, "Nickname Updated",
          nick
            ? `<@${i.user.id}> set the bot nickname to **${nick}**`
            : `<@${i.user.id}> cleared the bot nickname`,
        );
        return i.editReply({ content: nick ? `nickname is now **${nick}**` : "nickname cleared" });
      } catch (e: unknown) {
        return i.editReply({ content: `couldn't do it — ${String(e)}` });
      }
    }

    // ── backup ───────────────────────────────────────────────────────────────
    case "backup": {
      if (!admin(i)) return i.reply({ content: "you're not authorized to use that command", ephemeral: true });
      await i.deferReply();
      const backup = createBackup();
      const buffer = Buffer.from(JSON.stringify(backup, null, 2), "utf8");
      await logInfo(guildId, "Backup Created", `<@${i.user.id}> created a data backup (${Object.keys(backup.files).length} files)`);
      return i.editReply({
        embeds: [{ color: WHITE, description: `backed up **${Object.keys(backup.files).length}** files`, footer: { text: i.guild?.name ?? "bot" }, timestamp: ts() }],
        files: [new AttachmentBuilder(buffer, { name: `x2k-backup-${Date.now()}.json` })],
      });
    }

    // ── restore ──────────────────────────────────────────────────────────────
    case "restore": {
      if (!admin(i)) return i.reply({ content: "you're not authorized to use that command", ephemeral: true });
      const attachment = i.options.getAttachment("file", true);
      if (!attachment.name.endsWith(".json")) return i.reply({ content: "attach a valid `.json` backup file", ephemeral: true });
      await i.deferReply();
      let raw: string;
      try { raw = await fetch(attachment.url).then((r) => r.text()); }
      catch { return i.editReply({ content: "couldn't download the file" }); }
      let backup: { files: Record<string, unknown> };
      try { backup = JSON.parse(raw); }
      catch { return i.editReply({ content: "that file is unreadable" }); }
      if (!backup.files || typeof backup.files !== "object") return i.editReply({ content: "that doesn't look like a valid /x2k backup" });
      const restored = restoreBackup(backup);
      await logInfo(guildId, "Backup Restored", `<@${i.user.id}> restored a backup (${restored} files)`);
      return i.editReply({ embeds: [{ color: WHITE, description: `restored **${restored}** files`, footer: { text: i.guild?.name ?? "bot" }, timestamp: ts() }] });
    }

    default:
      return i.reply({ content: "unknown command", ephemeral: true });
  }
}
