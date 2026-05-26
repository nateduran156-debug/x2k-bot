import {
  ActivityType, ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle,
  PermissionFlagsBits, type Client, type Message, type GuildMember, type TextChannel, type Guild,
} from "discord.js";
import {
  getGuild, setGuild, getWhitelist, setWhitelist, getPoints, savePoints,
  memberHasCommandRole, memberHasPointsRole, memberHasTagManagerRole, memberHasPSR,
  memberHasVerificationManagerRole,
  removeVerified, setVerified, createBackup, restoreBackup, readJSON, writeJSON, setRegistered,
} from "../utils/storage.js";
import { getUserByUsername, getUserGroups, isInGroup, getGroupInfo, getGroupInfoBatch, getGroupRank, giveRobloxTagRole, getUserAvatarUrl, getPendingJoinRequests, acceptJoinRequest } from "../utils/roblox.js";
import { buildLeaderboardEmbed, refreshLeaderboard } from "../utils/leaderboard.js";
import { buildHelpMessage } from "../utils/help.js";
import { sendTicketPanel, handleTagManagerMessage, closeTicketByMessage } from "../handlers/ticketHandler.js";
import { logCommand, logPoints, logSetup, logInfo, logError } from "../utils/botLogger.js";

const WHITE    = 0xffffff;
const GREEN    = 0x00cc55;
const RED      = 0xff3333;
const OWNER_IDS = new Set(["1472482602215538779", "1127140523719798864"]);

// these are always shown in .flist regardless of what each server has configured
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

function hasFullAccess(member: GuildMember, guildId: string, wl: Record<string, string[]>, cmd: string): boolean {
  return (
    OWNER_IDS.has(member.id) ||
    (wl["bot"] ?? []).includes(member.id) ||
    (wl[cmd] ?? []).includes(member.id) ||
    memberHasCommandRole(member, guildId, cmd) ||
    memberHasPointsRole(member, guildId) ||
    memberHasPSR(member, guildId)
  );
}

async function fetchImage(urlOrAttachment: string): Promise<Buffer> {
  const res = await fetch(urlOrAttachment);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export function registerMessageCreate(client: Client) {
  client.on("messageCreate", async (message: Message) => {
    if (message.author.bot) return;
    if (!message.guild) return;

    const member   = message.member as GuildMember;
    const settings = getGuild(message.guild.id);
    const PREFIX   = settings.prefix ?? ".";

    await handleTagManagerMessage(message).catch(() => {});

    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
    const cmd  = args.shift()?.toLowerCase();
    if (!cmd) return;

    try {
      await dispatch(cmd, args, message, member, client);
    } catch (err) {
      console.error(`[prefix:${cmd}]`, err);
      await logError(message.guild.id, `Command Error: .${cmd}`,
        `something went wrong when <@${message.author.id}> ran \`.${cmd}\``,
        [{ name: "Error", value: String(err).slice(0, 1000) }],
      );
      await message.reply("something went wrong on my end — try again in a moment").catch(() => {});
    }
  });
}

async function syncRankRoles(
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function dispatch(cmd: string, args: string[], message: Message, member: GuildMember, client: Client): Promise<any> {
  const guildId = message.guild!.id;
  const wl      = getWhitelist();
  const isSU    = () => OWNER_IDS.has(member.id) || (wl["bot"] ?? []).includes(member.id);
  const admin   = () => isSU();
  const mgGuild = () => isSU();
  const mgRoles = () => isSU();

  switch (cmd) {

    case "sr": {
      if (!admin()) return message.reply("you're not authorized to use that command");
      const name = args[0]?.toLowerCase().trim();
      if (!name) return message.reply("`.sr <role name>`");
      const s        = getGuild(guildId);
      const existing = s.customTags ?? [];
      if (existing.includes(name)) return message.reply(`\`${name}\` is already a tag option`);
      existing.push(name);
      setGuild(guildId, { customTags: existing });
      return message.reply(`tag option \`${name}\` added — it can now be used with \`.role\``);
    }

    case "role": {
      if (!admin() && !memberHasTagManagerRole(member, guildId)) return message.reply("you're not authorized to use that command");

      const s          = getGuild(guildId);
      const customTags = s.customTags ?? [];
      const STATIC_TAGS = ["ryuk tag", "bunni tag", "bunni knife"];
      const ALL_TAGS    = [...STATIC_TAGS, ...customTags.map((t) => t.toLowerCase())];

      const username = args[0];
      const tagInput = args.slice(1).join(" ").toLowerCase();

      if (!username || !tagInput) {
        const available = ALL_TAGS.length > 0 ? ALL_TAGS.map((t) => `\`${t}\``).join(", ") : "none — use .sr to add one";
        return message.reply(`\`.role <roblox username> <tag>\`\navailable tags: ${available}`);
      }
      if (!ALL_TAGS.includes(tagInput)) {
        const available = ALL_TAGS.length > 0 ? ALL_TAGS.map((t) => `\`${t}\``).join(", ") : "none — use .sr to add one";
        return message.reply(`\`${tagInput}\` is not a valid tag. available tags: ${available}`);
      }

      const loading = await message.reply(`looking up **${username}**...`);
      const user    = await getUserByUsername(username);
      if (!user) return loading.edit({ content: `can't find **${username}** on roblox` });

      const rankInfo    = s.groupId ? await getGroupRank(user.id, s.groupId).catch(() => null) : null;
      const currentRank = rankInfo ? `${rankInfo.rankName} (rank ${rankInfo.rankId})` : "not in group";

      let robloxNote = "";
      const result = await giveRobloxTagRole(username, tagInput, customTags);
      robloxNote = result.ok
        ? `roblox role **${tagInput}** assigned`
        : `roblox role failed: ${result.reason}`;

      await loading.edit({
        content: null,
        embeds: [{
          color: WHITE,
          description: [
            `**${user.name}**`,
            `rank: ${currentRank}`,
            `tag: \`${tagInput}\``,
            robloxNote,
          ].filter(Boolean).join("\n"),
          footer: { text: `given by ${message.author.username}` },
          timestamp: ts(),
        }],
      });

      const logChannelId = s.tagLogChannel ?? s.logChannel;
      if (logChannelId) {
        const logChannel = message.guild!.channels.cache.get(logChannelId) as TextChannel | undefined;
        if (logChannel) {
          await logChannel.send({
            embeds: [{
              color: WHITE,
              title: "Tag Given",
              description: [
                `**Roblox:** ${user.name}`,
                `**Given By:** <@${message.author.id}> (${message.author.username})`,
                `**Tag:** \`${tagInput}\``,
                rankInfo ? `**Previous Rank:** ${rankInfo.rankName}` : null,
              ].filter(Boolean).join("\n"),
              timestamp: ts(),
            }],
          }).catch(() => {});
        }
      }

      await logCommand(guildId, "Command: .role",
        `<@${message.author.id}> gave tag \`${tagInput}\` to **${user.name}**`,
        [{ name: "Roblox", value: user.name, inline: true }, { name: "Tag", value: tagInput, inline: true }],
      );
      return;
    }

    case "setupticket": {
      if (!mgGuild()) return message.reply("you're not authorized to use that command");
      const channels = message.mentions.channels;
      const type = (args.find((a) => ["verification", "tag", "both"].includes(a)) ?? "both") as "verification" | "tag" | "both";
      if (channels.size === 0) return message.reply("mention a channel. example: `.setupticket #tickets both`");
      for (const [, ch] of channels) {
        await sendTicketPanel(ch as TextChannel, type);
        setGuild(guildId, { ticketChannel: ch.id });
      }
      await logSetup(guildId, "Ticket Panel Set Up",
        `<@${message.author.id}> set up the ticket panel`,
        [{ name: "Type", value: type, inline: true }, { name: "Channel", value: `<#${channels.first()?.id}>`, inline: true }],
      );
      return message.reply(`panel sent to ${[...channels.values()].map((c) => `<#${c.id}>`).join(", ")}`);
    }

    case "logset": {
      if (!mgGuild()) return message.reply("you're not authorized to use that command");
      const ch = message.mentions.channels.first() ?? message.channel;
      setGuild(guildId, { logChannel: (ch as TextChannel).id });
      await logSetup(guildId, "Log Channel Set", `<@${message.author.id}> set the log channel to <#${ch.id}>`);
      return message.reply(`logs going to <#${ch.id}> now`);
    }

    case "taglogset": {
      if (!mgGuild()) return message.reply("you're not authorized to use that command");
      const ch = message.mentions.channels.first() ?? message.channel;
      setGuild(guildId, { tagLogChannel: (ch as TextChannel).id });
      await logSetup(guildId, "Tag Log Channel Set", `<@${message.author.id}> set the tag log channel to <#${ch.id}>`);
      return message.reply(`tag logs going to <#${ch.id}> now`);
    }

    case "botlogset": {
      if (!admin()) return message.reply("you're not authorized to use that command");
      const ch = message.mentions.channels.first() ?? message.channel;
      setGuild(guildId, { botLogChannel: (ch as TextChannel).id });
      await logInfo(guildId, "Bot Log Channel Set",
        `<@${message.author.id}> set this channel as the bot log channel. all bot activity will be logged here.`,
      );
      return message.reply(`bot logs going to <#${ch.id}> now`);
    }

    case "vset": {
      if (!mgGuild()) return message.reply("you're not authorized to use that command");
      const role = message.mentions.roles.first();
      if (!role) return message.reply("mention the role you want to use for verification");
      setGuild(guildId, { verificationRole: role.id });
      await logSetup(guildId, "Verification Role Set", `<@${message.author.id}> set the verification role to <@&${role.id}>`);
      return message.reply(`verification role is now <@&${role.id}>`);
    }

    case "gid": {
      if (!mgGuild()) return message.reply("you're not authorized to use that command");
      const groupId = args[0];
      if (!groupId || isNaN(Number(groupId))) return message.reply("please provide a valid Roblox group id");
      setGuild(guildId, { groupId });
      await logSetup(guildId, "Group ID Set", `<@${message.author.id}> set the group ID to \`${groupId}\``);
      return message.reply(`group id set to \`${groupId}\``);
    }

    case "prefix": {
      if (!admin()) return message.reply("you're not authorized to use that command");
      const newPrefix = args[0];
      if (!newPrefix) return message.reply("`.prefix <new>`");
      if (newPrefix.length > 5) return message.reply("keep it under 5 characters");
      setGuild(guildId, { prefix: newPrefix });
      await logSetup(guildId, "Prefix Changed", `<@${message.author.id}> changed the prefix to \`${newPrefix}\``);
      return message.reply(`prefix is now \`${newPrefix}\``);
    }

    case "flag": {
      if (!mgGuild()) return message.reply("you're not authorized to use that command");
      const gid = args[0];
      if (!gid || isNaN(Number(gid))) return message.reply("please provide a valid group id");
      if (ALWAYS_FLAGGED_IDS.has(gid)) return message.reply(`\`${gid}\` is already in the global flag list`);
      const s       = getGuild(guildId);
      const flagged = s.flaggedGroups ?? [];
      if (flagged.includes(gid)) return message.reply(`\`${gid}\` is already flagged`);
      flagged.push(gid);
      const info       = await getGroupInfo(gid).catch(() => null);
      const groupNames = s.groupNames ?? {};
      if (info?.name) groupNames[String(gid)] = info.name;
      setGuild(guildId, { flaggedGroups: flagged, groupNames });
      await logSetup(guildId, "Group Flagged", `<@${message.author.id}> flagged **${info?.name ?? gid}** (\`${gid}\`)`);
      return message.reply(`flagged **${info?.name ?? gid}** (\`${gid}\`)`);
    }

    case "unflag": {
      if (!mgGuild()) return message.reply("you're not authorized to use that command");
      const gid = args[0];
      if (!gid) return message.reply("please provide a group id to unflag");
      if (ALWAYS_FLAGGED_IDS.has(gid)) return message.reply(`\`${gid}\` is in the global list and can't be unflagged`);
      const s       = getGuild(guildId);
      const flagged = s.flaggedGroups ?? [];
      if (!flagged.includes(gid)) return message.reply(`\`${gid}\` isn't on the list`);
      setGuild(guildId, { flaggedGroups: flagged.filter((g) => g !== gid) });
      await logSetup(guildId, "Group Unflagged", `<@${message.author.id}> unflagged group \`${gid}\``);
      return message.reply(`unflagged \`${gid}\``);
    }

    case "flist": {
      const s      = getGuild(guildId);
      const custom = s.flaggedGroups ?? [];

      // merge always-flagged + guild custom, no duplicates
      const alwaysIds = ALWAYS_FLAGGED.map((g) => g.id);
      const combined  = [...new Set([...alwaysIds, ...custom])];

      const loading     = await message.reply("pulling group info...");
      const apiMap      = await getGroupInfoBatch(combined);
      const storedNames = s.groupNames ?? {};

      const lines = combined.map((id, i) => {
        const name = apiMap[id] ?? ALWAYS_FLAGGED_MAP[id] ?? storedNames[id] ?? "Unknown Group";
        // format: number. [Name](link)  |  `id`
        return `\`${i + 1}.\` [${name}](https://www.roblox.com/groups/${id}) \`${id}\``;
      });

      // chunk into pages in case theres a ton of groups
      const MAX = 4000;
      const pages: string[] = [];
      let cur = "";
      for (const line of lines) {
        const next = cur ? cur + "\n" + line : line;
        if (next.length > MAX) { pages.push(cur); cur = line; } else { cur = next; }
      }
      if (cur) pages.push(cur);

      // FIX: was `flagged.length` (undefined) — now correctly uses `combined.length`
      await loading.edit({
        content: null,
        embeds: [{ color: WHITE, title: `flagged groups (${combined.length})`, description: pages[0], footer: { text: message.client.user?.username ?? "bot" }, timestamp: ts() }],
      });
      for (let p = 1; p < pages.length; p++) {
        await (message.channel as TextChannel).send({ embeds: [{ color: WHITE, description: pages[p], footer: { text: `page ${p + 1}/${pages.length}` } }] });
      }
      return;
    }

    case "gc": {
      const username = args[0];
      if (!username) { await message.reply("please provide a username"); return; }
      const loading  = await message.reply(`checking **${username}**...`);
      const user     = await getUserByUsername(username);
      if (!user) return loading.edit({ content: `couldn't find **${username}** on Roblox` });

      const s       = getGuild(guildId);
      const groupId = s.groupId ?? "396910998";

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
        color:       embedColor,
        description: `${header}${groupList}`,
        footer:      { text: message.client.user?.username ?? "bot" },
        timestamp:   ts(),
      };
      if (avatarUrl) mainEmbed["thumbnail"] = { url: avatarUrl };

      const embeds: object[] = [mainEmbed];

      if (isFlagged) {
        embeds.push({
          color:       RED,
          description: `**[${user.name}](${profileUrl})** is not cleared — ask them to leave:\n\n${flaggedHits.map((m) => `• [${m.group.name}](https://www.roblox.com/groups/${m.group.id})`).join("\n")}`,
          timestamp:   ts(),
        });
      }

      embeds.push({
        color:       embedColor,
        description: inGroup
          ? `✓ **[${user.name}](${profileUrl})** is in the group and good to verify\n\n**Group ID:** \`${groupId}\`\n**Link:** [Join Here](https://www.roblox.com/communities/${groupId})`
          : `✗ **[${user.name}](${profileUrl})** is not in the group\n\n**Group ID:** \`${groupId}\`\n**Link:** [Join Here](https://www.roblox.com/communities/${groupId})`,
        timestamp: ts(),
      });

      return loading.edit({ content: null, embeds });
    }

    case "verify": {
      if (!mgRoles()) return message.reply("you're not authorized to use that command");
      const target     = message.mentions.members?.first();
      if (!target) return message.reply("mention the user you want to verify");
      const robloxName = args[1] ?? null;
      const s          = getGuild(guildId);
      if (!s.verificationRole) return message.reply("no verification role set — run `.vset @role` first");
      await target.roles.add(s.verificationRole).catch(() => {});
      await target.roles.remove("1493486362165252177").catch(() => {});
      if (robloxName) setVerified(target.id, robloxName);
      await logCommand(guildId, "Manual Verify",
        `<@${message.author.id}> verified <@${target.id}>${robloxName ? ` as **${robloxName}**` : ""}`,
        [{ name: "User", value: `<@${target.id}>`, inline: true }, { name: "Roblox", value: robloxName ?? "N/A", inline: true }],
      );
      return message.reply(`verified <@${target.id}>${robloxName ? ` as **${robloxName}**` : ""}`);
    }

    case "unverify": {
      if (!mgRoles()) return message.reply("you're not authorized to use that command");
      const target = message.mentions.members?.first();
      if (!target) return message.reply("mention the user you want to unverify");
      const s = getGuild(guildId);
      if (s.verificationRole) await target.roles.remove(s.verificationRole).catch(() => {});
      removeVerified(target.id);
      await logCommand(guildId, "Manual Unverify", `<@${message.author.id}> unverified <@${target.id}>`);
      return message.reply(`removed verification from <@${target.id}>`);
    }

    case "wl": {
      if (!admin()) return message.reply("you're not authorized to use that command");
      const sub = args[0];
      if (sub === "bot") {
        const t = message.mentions.users.first();
        if (!t) return message.reply("mention the user you want to whitelist");
        const wlData  = getWhitelist();
        wlData["bot"] = wlData["bot"] ?? [];
        if (wlData["bot"].includes(t.id)) return message.reply(`<@${t.id}> already has full access`);
        wlData["bot"].push(t.id);
        setWhitelist(wlData);
        await logSetup(guildId, "Whitelist Updated", `<@${message.author.id}> gave <@${t.id}> full bot access`);
        return message.reply(`<@${t.id}> now has access to all commands`);
      }
      if (sub === "command") {
        const cmdName = args[1];
        const t       = message.mentions.users.first();
        if (!cmdName || !t) return message.reply("`.wl command <name> @user`");
        const wlData    = getWhitelist();
        wlData[cmdName] = wlData[cmdName] ?? [];
        if (wlData[cmdName]!.includes(t.id)) return message.reply(`<@${t.id}> can already use \`.${cmdName}\``);
        wlData[cmdName]!.push(t.id);
        setWhitelist(wlData);
        await logSetup(guildId, "Whitelist Updated", `<@${message.author.id}> gave <@${t.id}> access to \`.${cmdName}\``);
        return message.reply(`<@${t.id}> can now use \`.${cmdName}\``);
      }
      return message.reply("`.wl bot @user` or `.wl command <name> @user`");
    }

    case "wlrole": {
      if (!mgGuild()) return message.reply("you're not authorized to use that command");
      const role = message.mentions.roles.first();
      if (!role) return message.reply("`.wlrole @role [command]`");
      const cmdName = args[1]?.toLowerCase();
      const s       = getGuild(guildId);
      if (!cmdName) {
        const roles = s.tagManagerRoles ?? [];
        if (roles.includes(role.id)) return message.reply(`<@&${role.id}> is already a tag manager role`);
        roles.push(role.id);
        setGuild(guildId, { tagManagerRoles: roles });
        await logSetup(guildId, "Role Whitelisted", `<@${message.author.id}> made <@&${role.id}> a tag manager role`);
        return message.reply(`<@&${role.id}> can now manage tag tickets`);
      }
      const commandRoles = s.commandRoles ?? {};
      commandRoles[cmdName] = commandRoles[cmdName] ?? [];
      if (commandRoles[cmdName]!.includes(role.id)) return message.reply(`<@&${role.id}> already has access to \`.${cmdName}\``);
      commandRoles[cmdName]!.push(role.id);
      setGuild(guildId, { commandRoles });
      await logSetup(guildId, "Role Whitelisted", `<@${message.author.id}> gave <@&${role.id}> access to \`.${cmdName}\``);
      return message.reply(`<@&${role.id}> can now use \`.${cmdName}\``);
    }

    case "wlp": {
      if (!admin()) return message.reply("you're not authorized to use that command");
      const role = message.mentions.roles.first();
      if (!role) return message.reply("`.wlp @role`");
      const s = getGuild(guildId);
      if (s.pointsRole === role.id) return message.reply(`<@&${role.id}> already manages points`);
      setGuild(guildId, { pointsRole: role.id });
      await logSetup(guildId, "Points Role Set", `<@${message.author.id}> gave <@&${role.id}> full points access`);
      return message.reply(`<@&${role.id}> can now use all raid points commands`);
    }

    case "tmr": {
      if (!admin()) return message.reply("you're not authorized to use that command");
      const roleArg = args[0];
      if (!roleArg) return message.reply("`.tmr @role` or `.tmr <role id>`");
      const role = message.mentions.roles.first() ?? message.guild!.roles.cache.get(roleArg.replace(/\D/g, ""));
      if (!role) return message.reply("couldn't find that role — mention it or give me a valid id");
      setGuild(guildId, { tagManagerRole: role.id });
      await logSetup(guildId, "Tag Manager Role Set", `<@${message.author.id}> set the tag manager role to <@&${role.id}>`);
      return message.reply(`<@&${role.id}> is now the tag manager role — they can use \`.role\``);
    }

    case "vmr": {
      if (!admin()) return message.reply("you're not authorized to use that command");
      const sub = args[0]?.toLowerCase();

      if (sub === "list") {
        const s = getGuild(guildId);
        const roles: string[] = [
          ...(s.verificationManagerRoles ?? []),
          ...(s.verificationManagerRole ? [s.verificationManagerRole] : []),
        ];
        if (roles.length === 0) return message.reply("no verification manager roles configured yet");
        return message.reply({ embeds: [{ color: WHITE, title: "verification manager roles", description: roles.map((id) => `<@&${id}>`).join("\n"), footer: { text: message.guild!.name }, timestamp: ts() }] });
      }

      if (sub === "remove") {
        const roleArg = args[1];
        if (!roleArg) return message.reply("`.vmr remove @role` or `.vmr remove <role id>`");
        const role = message.mentions.roles.first() ?? message.guild!.roles.cache.get(roleArg.replace(/\D/g, ""));
        if (!role) return message.reply("couldn't find that role — mention it or give me a valid id");
        const s = getGuild(guildId);
        const current = s.verificationManagerRoles ?? [];
        if (!current.includes(role.id)) return message.reply(`<@&${role.id}> isn't in the VMR list`);
        setGuild(guildId, { verificationManagerRoles: current.filter((id) => id !== role.id) });
        await logSetup(guildId, "VMR Role Removed", `<@${message.author.id}> removed <@&${role.id}> from the verification manager roles`);
        return message.reply(`<@&${role.id}> has been removed from the verification manager roles`);
      }

      // default: add a role
      const roleArg = sub === "add" ? args[1] : args[0];
      if (!roleArg) return message.reply("`.vmr @role` — add a role  |  `.vmr remove @role` — remove  |  `.vmr list` — view all");
      const role = message.mentions.roles.first() ?? message.guild!.roles.cache.get(roleArg.replace(/\D/g, ""));
      if (!role) return message.reply("couldn't find that role — mention it or give me a valid id");
      const s = getGuild(guildId);
      const current = s.verificationManagerRoles ?? [];
      if (current.includes(role.id)) return message.reply(`<@&${role.id}> is already a verification manager role`);
      current.push(role.id);
      setGuild(guildId, { verificationManagerRoles: current });
      await logSetup(guildId, "VMR Role Added", `<@${message.author.id}> added <@&${role.id}> as a verification manager role`);
      return message.reply(`<@&${role.id}> added to the verification manager roles — they can use the Verify, Kick, and Close buttons in verification tickets`);
    }

    case "psr": {
      if (!admin()) return message.reply("you're not authorized to use that command");
      const roleArg = args[0];
      if (!roleArg) return message.reply("`.psr @role` or `.psr <role id>`");
      const role = message.mentions.roles.first() ?? message.guild!.roles.cache.get(roleArg.replace(/\D/g, ""));
      if (!role) return message.reply("couldn't find that role — mention it or give me a valid id");
      setGuild(guildId, { pointsSupportRole: role.id });
      await logSetup(guildId, "Points Support Role Set", `<@${message.author.id}> set the points support role to <@&${role.id}>`);
      return message.reply(`<@&${role.id}> is now the points support role — they can use \`.check\`, \`.lb\`, and \`.rankup\``);
    }

    case "whitelisted": {
      if (!admin()) return message.reply("you're not authorized to use that command");
      const wlData       = getWhitelist();
      const s            = getGuild(guildId);
      const lines: string[] = [];
      for (const k of Object.keys(wlData)) {
        if ((wlData[k] ?? []).length > 0) {
          lines.push(`**\`.${k}\`** (users)\n${wlData[k]!.map((id) => `<@${id}>`).join(", ")}`);
        }
      }
      const commandRoles = s.commandRoles ?? {};
      for (const k of Object.keys(commandRoles)) {
        if ((commandRoles[k] ?? []).length > 0) {
          lines.push(`**\`.${k}\`** (roles)\n${commandRoles[k]!.map((id) => `<@&${id}>`).join(", ")}`);
        }
      }
      if ((s.tagManagerRoles ?? []).length > 0) lines.push(`**tag manager** (roles)\n${s.tagManagerRoles!.map((id) => `<@&${id}>`).join(", ")}`);
      if (s.tagManagerRole) lines.push(`**tag manager role** (.tmr)\n<@&${s.tagManagerRole}> — can use \`.role\``);
      if (s.pointsRole) lines.push(`**points manager** (role)\n<@&${s.pointsRole}>`);
      if (s.pointsSupportRole) lines.push(`**points support role** (.psr)\n<@&${s.pointsSupportRole}> — can use \`.check\`, \`.lb\`, \`.rankup\``);
      if (lines.length === 0) return message.reply("nothing whitelisted yet");
      await message.reply({ embeds: [{ color: WHITE, description: lines.join("\n\n"), footer: { text: message.guild!.name }, timestamp: ts() }] });
      return;
    }

    case "register": {
      const robloxName = args[0];
      if (!robloxName) {
        return message.reply({ embeds: [{ color: WHITE, description: "`.register <roblox username>` — links your Discord account to your Roblox username.", timestamp: ts() }] });
      }
      const loadMsg = await message.reply("looking up that username...");
      const robloxUser = await getUserByUsername(robloxName).catch(() => null);
      if (!robloxUser) {
        return loadMsg.edit({ content: null, embeds: [{ color: RED, description: `could not find **${robloxName}** on Roblox — double-check the spelling and try again.`, timestamp: ts() }] });
      }
      setRegistered(message.author.id, robloxUser.name);
      return loadMsg.edit({
        content: null,
        embeds: [{
          color: WHITE,
          title: "Registration Confirmed",
          description: [
            `**Discord:** ${message.author.username}`,
            `**Roblox:** ${robloxUser.name}`,
            "Your account has been linked. Run \`.register\` again at any time to update your username.",
          ].join("\n"),
          timestamp: ts(),
        }],
      });
    }

    case "rankup": {
      if (!hasFullAccess(member, guildId, wl, "rankup")) return message.reply("you're not authorized to use that command");
      let amount = 1;
      const target = message.mentions.users.first();
      if (!target) return message.reply("mention a user to give points to");
      if (args.length >= 2 && !isNaN(Number(args[0]))) amount = parseInt(args[0]!);
      if (amount <= 0) return message.reply("amount has to be more than 0");
      const pts = getPoints(guildId);
      pts[target.id] = (pts[target.id] ?? 0) + amount;
      savePoints(guildId, pts);
      refreshLeaderboard(client, guildId).catch(() => {});

      const { gained } = await syncRankRoles(
        message.guild!, target.id, pts[target.id] ?? 0, getGuild(guildId).rankRoles ?? [],
      );
      const promotionNote = gained.length > 0 ? `\nrank${gained.length > 1 ? "s" : ""} unlocked: ${gained.join(", ")}` : "";

      await logPoints(guildId, "Points Added",
        `<@${message.author.id}> gave **+${amount}** to <@${target.id}>`,
        [{ name: "New Total", value: `${pts[target.id]} pts`, inline: true }],
      );
      return message.reply({ embeds: [{ color: WHITE, description: `+**${amount}** to <@${target.id}> — **${pts[target.id]}** pt${pts[target.id] !== 1 ? "s" : ""} total${promotionNote}`, footer: { text: `given by ${message.author.username}` }, timestamp: ts() }] });
    }

    case "remove": {
      if (!hasFullAccess(member, guildId, wl, "remove")) return message.reply("you're not authorized to use that command");
      let amount = 1;
      const target = message.mentions.users.first();
      if (!target) return message.reply("mention a user to remove points from");
      if (args.length >= 2 && !isNaN(Number(args[0]))) amount = parseInt(args[0]!);
      if (amount <= 0) return message.reply("amount has to be more than 0");
      const pts = getPoints(guildId);
      pts[target.id] = Math.max(0, (pts[target.id] ?? 0) - amount);
      savePoints(guildId, pts);
      refreshLeaderboard(client, guildId).catch(() => {});

      const { lost } = await syncRankRoles(
        message.guild!, target.id, pts[target.id] ?? 0, getGuild(guildId).rankRoles ?? [],
      );
      const demotionNote = lost.length > 0 ? `\nrank${lost.length > 1 ? "s" : ""} removed: ${lost.join(", ")}` : "";

      await logPoints(guildId, "Points Removed",
        `<@${message.author.id}> removed **-${amount}** from <@${target.id}>`,
        [{ name: "New Total", value: `${pts[target.id]} pts`, inline: true }],
      );
      return message.reply({ embeds: [{ color: WHITE, description: `-**${amount}** from <@${target.id}> — **${pts[target.id]}** pt${pts[target.id] !== 1 ? "s" : ""} total${demotionNote}`, footer: { text: `removed by ${message.author.username}` }, timestamp: ts() }] });
    }

    case "resetall": {
      const hasAccess = admin() || memberHasPointsRole(member, guildId);
      if (!hasAccess) return message.reply("you're not authorized to use that command");
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("resetall_confirm").setLabel("reset all points").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("resetall_cancel").setLabel("cancel").setStyle(ButtonStyle.Secondary),
      );
      const msg = await message.reply({
        embeds: [{ color: WHITE, title: "reset all points", description: "this wipes **every** raid point in the server and can't be undone", footer: { text: `requested by ${message.author.username}` }, timestamp: ts() }],
        components: [row],
      });
      const collector = msg.createMessageComponentCollector({ filter: (i) => i.user.id === message.author.id, time: 15000 });
      collector.on("collect", async (i) => {
        if (i.customId === "resetall_confirm") {
          const d = readJSON<Record<string, unknown>>("points.json");
          d[guildId] = {};
          writeJSON("points.json", d);

          // strip every rank role from everyone who has one
          const rankCfgReset = getGuild(guildId);
          for (const rank of rankCfgReset.rankRoles ?? []) {
            const rankRole = message.guild!.roles.cache.get(rank.roleId);
            if (rankRole) {
              for (const [, roleMember] of rankRole.members) {
                await roleMember.roles.remove(rank.roleId).catch(() => {});
              }
            }
          }

          await logPoints(guildId, "Points Reset", `<@${message.author.id}> wiped all raid points and rank roles in this server`);
          await i.update({ embeds: [{ color: WHITE, title: "points wiped", description: "all raid points cleared and all rank roles removed", footer: { text: `done by ${message.author.username}` }, timestamp: ts() }], components: [] });
        } else {
          await i.update({ embeds: [{ color: WHITE, title: "cancelled", description: "nothing changed", timestamp: ts() }], components: [] });
        }
        collector.stop();
      });
      collector.on("end", (_, reason) => { if (reason === "time") msg.edit({ components: [] }).catch(() => {}); });
      return;
    }

    case "check": {
      const target = message.mentions.users.first();
      if (target && target.id !== message.author.id) {
        if (!hasFullAccess(member, guildId, wl, "check") && !memberHasPSR(member, guildId)) { await message.reply("you're not authorized to use that command"); return; }
      }
      const subject = target ?? message.author;
      const pts     = getPoints(guildId);
      const p       = pts[subject.id] ?? 0;
      await message.reply({ embeds: [{ color: WHITE, description: `<@${subject.id}> — **${p}** pt${p !== 1 ? "s" : ""}`, footer: { text: message.guild!.name }, timestamp: ts() }] });
      return;
    }

    case "leaderboard":
    case "lb": {
      const pts   = getPoints(guildId);
      const embed = buildLeaderboardEmbed(pts, message.guild!.name);
      if (!embed) { await message.reply("nobody has any points yet. be the first!"); return; }
      const msg = await message.reply({ embeds: [embed] });
      setGuild(guildId, { leaderboardMessage: { channelId: message.channel.id, messageId: msg.id } });
      return;
    }

    case "status": {
      if (!admin()) { await message.reply("you're not authorized to use that command"); return; }
      const text = args.join(" ");
      if (!text) { await message.reply("`.status <text>` or `.status clear`"); return; }
      if (text.toLowerCase() === "clear") {
        client.user?.setPresence({ activities: [] });
        await logInfo(guildId, "Status Cleared", `<@${message.author.id}> cleared the bot status`);
        await message.reply("status cleared");
        return;
      }
      client.user?.setPresence({ activities: [{ name: text, type: ActivityType.Playing }] });
      await logInfo(guildId, "Status Updated", `<@${message.author.id}> set the bot status to: **${text}**`);
      await message.reply(`status set to **${text}**`);
      return;
    }

    case "presence": {
      if (!admin()) { await message.reply("you're not authorized to use that command"); return; }
      const valid = ["online", "idle", "dnd", "invisible"] as const;
      const s = args[0]?.toLowerCase() as typeof valid[number] | undefined;
      if (!s || !valid.includes(s)) { await message.reply("`.presence <online|idle|dnd|invisible>`"); return; }
      client.user?.setPresence({ status: s });
      await logInfo(guildId, "Presence Updated", `<@${message.author.id}> set bot presence to **${s}**`);
      await message.reply(`presence set to **${s}**`);
      return;
    }

    case "setavatar":
    case "setpfp": {
      if (!admin()) { await message.reply("you're not authorized to use that command"); return; }
      const url = message.attachments.first()?.url ?? args[0];
      if (!url) { await message.reply("attach an image or give me a url. example: `.setavatar https://...`"); return; }
      const loading = await message.reply("updating pfp...");
      try {
        const buffer = await fetchImage(url);
        await client.user!.setAvatar(buffer);
        await logInfo(guildId, "Avatar Updated", `<@${message.author.id}> changed the bot's profile picture`);
        await loading.edit("pfp updated");
      } catch (e: unknown) {
        await loading.edit(`couldn't update it — ${String(e)}`);
      }
      return;
    }

    case "setbanner": {
      if (!admin()) { await message.reply("you're not authorized to use that command"); return; }
      const url = message.attachments.first()?.url ?? args[0];
      if (!url) { await message.reply("attach an image or give me a url. example: `.setbanner https://...`"); return; }
      const loading = await message.reply("updating banner...");
      try {
        const buffer = await fetchImage(url);
        await (client.user as import("discord.js").ClientUser & { setBanner: (b: Buffer) => Promise<unknown> }).setBanner(buffer);
        await logInfo(guildId, "Banner Updated", `<@${message.author.id}> changed the bot's banner`);
        await loading.edit("banner updated");
      } catch (e: unknown) {
        await loading.edit(`couldn't update it — make sure the bot account has nitro, that's required for banners. error: ${String(e)}`);
      }
      return;
    }

    case "setusername": {
      if (!admin()) { await message.reply("you're not authorized to use that command"); return; }
      const name = args.join(" ");
      if (!name) { await message.reply("`.setusername <new name>`"); return; }
      if (name.length < 2 || name.length > 32) { await message.reply("name has to be between 2 and 32 characters"); return; }
      const loading = await message.reply("updating username...");
      try {
        await client.user!.setUsername(name);
        await logInfo(guildId, "Username Updated", `<@${message.author.id}> changed the bot username to **${name}**`);
        await loading.edit(`username is now **${name}**`);
      } catch (e: unknown) {
        await loading.edit(`couldn't update it — discord rate limits username changes, wait a bit and try again. error: ${String(e)}`);
      }
      return;
    }

    case "setnickname":
    case "setnick": {
      if (!admin()) { await message.reply("you're not authorized to use that command"); return; }
      const nick = args.join(" ") || null;
      const loading = await message.reply(nick ? "updating nickname..." : "clearing nickname...");
      try {
        const botMember = message.guild!.members.cache.get(client.user!.id)
          ?? await message.guild!.members.fetch(client.user!.id);
        await botMember.setNickname(nick);
        await logInfo(guildId, "Nickname Updated",
          nick
            ? `<@${message.author.id}> set the bot nickname to **${nick}** in this server`
            : `<@${message.author.id}> cleared the bot nickname in this server`,
        );
        await loading.edit(nick ? `nickname is now **${nick}**` : "nickname cleared");
      } catch (e: unknown) {
        await loading.edit(`couldn't do it — ${String(e)}`);
      }
      return;
    }

    case "backup": {
      if (!admin()) { await message.reply("you're not authorized to use that command"); return; }
      const backup = createBackup();
      const buffer = Buffer.from(JSON.stringify(backup, null, 2), "utf8");
      await logInfo(guildId, "Backup Created", `<@${message.author.id}> created a data backup (${Object.keys(backup.files).length} files)`);
      await message.reply({
        embeds: [{ color: WHITE, description: `backed up **${Object.keys(backup.files).length}** files`, footer: { text: message.guild!.name }, timestamp: ts() }],
        files: [new AttachmentBuilder(buffer, { name: `x2k-backup-${Date.now()}.json` })],
      });
      return;
    }

    case "restore": {
      if (!admin()) { await message.reply("you're not authorized to use that command"); return; }
      const attachment = message.attachments.first();
      if (!attachment?.name.endsWith(".json")) { await message.reply("attach a valid `.json` backup file"); return; }
      const loading = await message.reply("restoring...");
      let raw: string;
      try { raw = await fetch(attachment.url).then((r) => r.text()); } catch { await loading.edit({ content: "couldn't download the file" }); return; }
      let backup: { files: Record<string, unknown> };
      try { backup = JSON.parse(raw); } catch { await loading.edit({ content: "that file is unreadable" }); return; }
      if (!backup.files || typeof backup.files !== "object") { await loading.edit({ content: "that doesn't look like a valid /x2k backup" }); return; }
      const restored = restoreBackup(backup);
      await logInfo(guildId, "Backup Restored", `<@${message.author.id}> restored a backup (${restored} files)`);
      await loading.edit({ embeds: [{ color: WHITE, description: `restored **${restored}** files`, footer: { text: message.guild!.name }, timestamp: ts() }] });
      return;
    }

    case "help":
    case "h":
    case "commands": {
      await message.reply(buildHelpMessage() as Parameters<typeof message.reply>[0]);
      return;
    }

    case "addrank": {
      if (!mgGuild()) return message.reply("you don't have permission to configure ranks");
      const roleId   = args[0]?.replace(/\D/g, "");
      const points   = parseInt(args[1] ?? "");
      const rankName = args.slice(2).join(" ") || null;
      if (!roleId || isNaN(points) || points < 1) return message.reply("`.addrank <roleId> <points> [name]`\nexample: `.addrank 123456789 10 Private`");
      const role = message.guild!.roles.cache.get(roleId);
      if (!role) return message.reply(`couldn't find a role with id \`${roleId}\` — make sure the id is correct`);
      const s     = getGuild(guildId);
      const ranks = s.rankRoles ?? [];
      if (ranks.length >= 30) return message.reply("you've hit the 30 rank limit — remove one before adding another");
      if (ranks.some((r) => r.roleId === roleId)) return message.reply(`<@&${roleId}> is already configured as a rank`);
      ranks.push({ roleId, points, name: rankName ?? role.name });
      setGuild(guildId, { rankRoles: ranks });
      await logSetup(guildId, "Rank Added", `<@${message.author.id}> added rank **${rankName ?? role.name}** at **${points}** pts`);
      return message.reply(`rank added — <@&${roleId}> unlocks at **${points}** points as **${rankName ?? role.name}**`);
    }

    case "removerank": {
      if (!mgGuild()) return message.reply("you don't have permission to configure ranks");
      const roleId = args[0]?.replace(/\D/g, "");
      if (!roleId) return message.reply("`.removerank <roleId>`");
      const s     = getGuild(guildId);
      const ranks = s.rankRoles ?? [];
      const idx   = ranks.findIndex((r) => r.roleId === roleId);
      if (idx === -1) return message.reply(`\`${roleId}\` isn't configured as a rank`);
      const [removed] = ranks.splice(idx, 1);
      setGuild(guildId, { rankRoles: ranks });
      await logSetup(guildId, "Rank Removed", `<@${message.author.id}> removed rank **${removed!.name}**`);
      return message.reply(`removed **${removed!.name}** from the rank configuration`);
    }

    case "ranks": {
      const s     = getGuild(guildId);
      const ranks = (s.rankRoles ?? []).sort((a, b) => a.points - b.points);
      if (ranks.length === 0) return message.reply("no ranks configured yet — use `.addrank <roleId> <points> [name]` to get started");
      const lines = ranks.map((r, i) => `\`${i + 1}.\` <@&${r.roleId}> — **${r.points}** pts — \`${r.name}\``);
      return message.reply({ embeds: [{ color: WHITE, title: `rank configuration (${ranks.length}/30)`, description: lines.join("\n"), footer: { text: message.guild!.name }, timestamp: ts() }] });
    }

    case "closeticket": {
      if (!admin() && !memberHasTagManagerRole(member, guildId)) return message.reply("you don't have permission to close tickets.");
      await closeTicketByMessage(message);
      return;
    }

    case "approve": {
      if (!admin()) return message.reply("you don't have permission to configure approved groups.");
      const groupId = args[0];
      if (!groupId) return message.reply("`.approve <group_id>` — provide the Roblox group ID to add.");
      const info = await getGroupInfo(groupId);
      if (!info) return message.reply(`couldn't find a group with ID \`${groupId}\` on Roblox.`);
      const s      = getGuild(guildId);
      const groups = s.approvedGroups ?? [];
      if (groups.some((g) => g.groupId === groupId)) return message.reply(`group **${info.name}** (\`${groupId}\`) is already in the approved list.`);
      groups.push({ groupId, name: info.name });
      setGuild(guildId, { approvedGroups: groups });
      await logSetup(guildId, "Approved Group Added", `<@${message.author.id}> added **${info.name}** to approved groups`);
      return message.reply({
        embeds: [{
          color: WHITE,
          description: `**${info.name}** (\`${groupId}\`) has been added to the approved groups list.\nTag managers can now use \`.accept\` and \`.pending\` for this group.`,
          footer: { text: message.guild!.name },
          timestamp: ts(),
        }],
      });
    }

    case "pending": {
      if (!admin() && !memberHasTagManagerRole(member, guildId)) return message.reply("you don't have permission to view pending requests.");
      const s      = getGuild(guildId);
      const groups = s.approvedGroups ?? [];
      if (groups.length === 0) return message.reply("no approved groups configured yet. use `.approve <group_id>` to add one.");
      const loading = await message.reply("fetching pending join requests...");
      const results: string[] = [];
      for (const g of groups) {
        const pending = await getPendingJoinRequests(g.groupId);
        if (pending.length === 0) {
          results.push(`**${g.name}** (\`${g.groupId}\`) — no pending requests`);
        } else {
          const names = pending.map((p) => `• \`${p.username}\``).join("\n");
          results.push(`**${g.name}** (\`${g.groupId}\`) — **${pending.length}** pending\n${names}`);
        }
      }
      await loading.edit({
        content: null,
        embeds: [{
          color: WHITE,
          title: "Pending Join Requests",
          description: results.join("\n\n"),
          footer: { text: message.guild!.name },
          timestamp: ts(),
        }],
      });
      return;
    }

    case "accept": {
      if (!admin() && !memberHasTagManagerRole(member, guildId)) return message.reply("you don't have permission to accept join requests.");
      const username  = args[0];
      const groupArg  = args.slice(1).join(" ").toLowerCase();
      if (!username || !groupArg) return message.reply("`.accept <roblox_user> <group name or id>`");
      const s      = getGuild(guildId);
      const groups = s.approvedGroups ?? [];
      if (groups.length === 0) return message.reply("no approved groups configured. use `.approve <group_id>` first.");
      const group = groups.find((g) => g.groupId === groupArg || g.name.toLowerCase() === groupArg);
      if (!group) {
        const list = groups.map((g) => `• **${g.name}** (\`${g.groupId}\`)`).join("\n");
        return message.reply(`couldn't match that to an approved group. approved groups:\n${list}`);
      }
      const loading = await message.reply(`looking up **${username}** on Roblox...`);
      const user = await getUserByUsername(username);
      if (!user) return loading.edit({ content: `couldn't find **${username}** on Roblox.` });
      const result = await acceptJoinRequest(group.groupId, user.id);
      if (!result.ok) return loading.edit({ content: `failed to accept the request: ${result.reason}` });
      await loading.edit({
        content: null,
        embeds: [{
          color: WHITE,
          description: `**${user.name}**'s join request to **${group.name}** has been accepted by <@${message.author.id}>.`,
          footer: { text: message.guild!.name },
          timestamp: ts(),
        }],
      });
      await logCommand(guildId, "Command: .accept",
        `<@${message.author.id}> accepted **${user.name}** into **${group.name}**`,
        [{ name: "Roblox", value: user.name, inline: true }, { name: "Group", value: group.name, inline: true }],
      );
      return;
    }

    default:
      break;
  }
}
