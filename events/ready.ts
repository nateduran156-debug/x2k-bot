import { REST, Routes, SlashCommandBuilder, InteractionContextType, ApplicationIntegrationType, ChannelType } from "discord.js";
import type { Client } from "discord.js";
import { logInfo } from "../utils/botLogger.js";
import { readJSON } from "../utils/storage.js";


const ALL_TYPES    = [ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall];
const ALL_CONTEXTS = [InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel];

const commands = [

  // ── info ──────────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("shows all commands")
    .setIntegrationTypes(ALL_TYPES).setContexts(ALL_CONTEXTS),

  // ── tags ──────────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("role")
    .setDescription("assign a roblox tag to a user")
    .setIntegrationTypes(ALL_TYPES).setContexts(ALL_CONTEXTS)
    .addStringOption((o) => o.setName("roblox").setDescription("roblox username").setRequired(true))
    .addStringOption((o) =>
      o.setName("tag").setDescription("tag to assign — use /sr to set available tags").setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName("sr")
    .setDescription("set a custom tag option that can be used with /role")
    .setIntegrationTypes(ALL_TYPES).setContexts(ALL_CONTEXTS)
    .addStringOption((o) => o.setName("name").setDescription("tag name to add").setRequired(true)),

  new SlashCommandBuilder()
    .setName("cookie")
    .setDescription("set the roblox cookie used for role assignment (owner only)")
    .setIntegrationTypes(ALL_TYPES).setContexts(ALL_CONTEXTS)
    .addStringOption((o) =>
      o.setName("cookie").setDescription("your .ROBLOSECURITY cookie value").setRequired(true),
    ),

  // ── roblox / groups ───────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("gc")
    .setDescription("run a full group check on a roblox user")
    .setIntegrationTypes(ALL_TYPES).setContexts(ALL_CONTEXTS)
    .addStringOption((o) => o.setName("username").setDescription("roblox username").setRequired(true)),

  new SlashCommandBuilder()
    .setName("flag")
    .setDescription("flag a roblox group for this server")
    .setIntegrationTypes(ALL_TYPES).setContexts(ALL_CONTEXTS)
    .addStringOption((o) => o.setName("groupid").setDescription("roblox group id").setRequired(true)),

  new SlashCommandBuilder()
    .setName("unflag")
    .setDescription("remove a group from this server's flagged list")
    .setIntegrationTypes(ALL_TYPES).setContexts(ALL_CONTEXTS)
    .addStringOption((o) => o.setName("groupid").setDescription("roblox group id").setRequired(true)),

  new SlashCommandBuilder()
    .setName("flist")
    .setDescription("list all flagged groups — global and server-specific")
    .setIntegrationTypes(ALL_TYPES).setContexts(ALL_CONTEXTS),

  // ── verification ──────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("verify")
    .setDescription("manually give a member the verified role")
    .setIntegrationTypes(ALL_TYPES).setContexts(ALL_CONTEXTS)
    .addUserOption((o) => o.setName("user").setDescription("member to verify").setRequired(true))
    .addStringOption((o) => o.setName("roblox").setDescription("their roblox username (optional)").setRequired(false)),

  new SlashCommandBuilder()
    .setName("unverify")
    .setDescription("remove the verified role from a member")
    .setIntegrationTypes(ALL_TYPES).setContexts(ALL_CONTEXTS)
    .addUserOption((o) => o.setName("user").setDescription("member to unverify").setRequired(true)),

  // ── setup ─────────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("setupticket")
    .setDescription("send the ticket panel to a channel")
    .setIntegrationTypes(ALL_TYPES).setContexts(ALL_CONTEXTS)
    .addChannelOption((o) =>
      o.setName("channel").setDescription("channel to send the panel to").setRequired(true)
        .addChannelTypes(ChannelType.GuildText),
    )
    .addStringOption((o) =>
      o.setName("type").setDescription("ticket type (default: both)").setRequired(false)
        .addChoices(
          { name: "both", value: "both" },
          { name: "verification", value: "verification" },
          { name: "tag", value: "tag" },
        ),
    ),

  new SlashCommandBuilder()
    .setName("logset")
    .setDescription("set the channel where ticket close logs are sent")
    .setIntegrationTypes(ALL_TYPES).setContexts(ALL_CONTEXTS)
    .addChannelOption((o) =>
      o.setName("channel").setDescription("log channel").setRequired(true)
        .addChannelTypes(ChannelType.GuildText),
    ),

  new SlashCommandBuilder()
    .setName("taglogset")
    .setDescription("set the channel where tag approval logs are sent")
    .setIntegrationTypes(ALL_TYPES).setContexts(ALL_CONTEXTS)
    .addChannelOption((o) =>
      o.setName("channel").setDescription("tag log channel").setRequired(true)
        .addChannelTypes(ChannelType.GuildText),
    ),

  new SlashCommandBuilder()
    .setName("botlogset")
    .setDescription("set the channel where all bot activity is logged")
    .setIntegrationTypes(ALL_TYPES).setContexts(ALL_CONTEXTS)
    .addChannelOption((o) =>
      o.setName("channel").setDescription("bot log channel").setRequired(true)
        .addChannelTypes(ChannelType.GuildText),
    ),

  new SlashCommandBuilder()
    .setName("vset")
    .setDescription("set the role members receive when verified")
    .setIntegrationTypes(ALL_TYPES).setContexts(ALL_CONTEXTS)
    .addRoleOption((o) => o.setName("role").setDescription("verification role").setRequired(true)),

  new SlashCommandBuilder()
    .setName("gid")
    .setDescription("set the roblox group id used for verification checks")
    .setIntegrationTypes(ALL_TYPES).setContexts(ALL_CONTEXTS)
    .addStringOption((o) => o.setName("groupid").setDescription("roblox group id").setRequired(true)),

  new SlashCommandBuilder()
    .setName("prefix")
    .setDescription("change the command prefix for this server")
    .setIntegrationTypes(ALL_TYPES).setContexts(ALL_CONTEXTS)
    .addStringOption((o) =>
      o.setName("prefix").setDescription("new prefix (max 5 chars)").setRequired(true),
    ),

  // ── whitelist ─────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("wl")
    .setDescription("manage bot whitelist")
    .setIntegrationTypes(ALL_TYPES).setContexts(ALL_CONTEXTS)
    .addSubcommand((s) =>
      s.setName("bot")
        .setDescription("give a user full access to every bot command")
        .addUserOption((o) => o.setName("user").setDescription("user to whitelist").setRequired(true)),
    )
    .addSubcommand((s) =>
      s.setName("command")
        .setDescription("give a user access to one specific command")
        .addStringOption((o) => o.setName("name").setDescription("command name (without prefix)").setRequired(true))
        .addUserOption((o) => o.setName("user").setDescription("user to whitelist").setRequired(true)),
    ),

  new SlashCommandBuilder()
    .setName("wlrole")
    .setDescription("give a role access to a command or tag manager access")
    .setIntegrationTypes(ALL_TYPES).setContexts(ALL_CONTEXTS)
    .addRoleOption((o) => o.setName("role").setDescription("role to whitelist").setRequired(true))
    .addStringOption((o) =>
      o.setName("command").setDescription("command name — leave blank for tag manager access").setRequired(false),
    ),

  new SlashCommandBuilder()
    .setName("wlp")
    .setDescription("give a role full access to all raid points commands")
    .setIntegrationTypes(ALL_TYPES).setContexts(ALL_CONTEXTS)
    .addRoleOption((o) => o.setName("role").setDescription("role to whitelist for points").setRequired(true)),

  new SlashCommandBuilder()
    .setName("tmr")
    .setDescription("set the tag manager role — they can use the role command")
    .setIntegrationTypes(ALL_TYPES).setContexts(ALL_CONTEXTS)
    .addRoleOption((o) => o.setName("role").setDescription("tag manager role").setRequired(true)),

  new SlashCommandBuilder()
    .setName("vmr")
    .setDescription("manage verification manager roles — they can use Verify, Kick, and Close in tickets")
    .setIntegrationTypes(ALL_TYPES).setContexts(ALL_CONTEXTS)
    .addSubcommand((s) =>
      s.setName("add").setDescription("add a role to the verification manager list")
        .addRoleOption((o) => o.setName("role").setDescription("role to add").setRequired(true)),
    )
    .addSubcommand((s) =>
      s.setName("remove").setDescription("remove a role from the verification manager list")
        .addRoleOption((o) => o.setName("role").setDescription("role to remove").setRequired(true)),
    )
    .addSubcommand((s) =>
      s.setName("list").setDescription("list all current verification manager roles"),
    ),

  new SlashCommandBuilder()
    .setName("psr")
    .setDescription("set the points support role — they can use check, lb, and rankup")
    .setIntegrationTypes(ALL_TYPES).setContexts(ALL_CONTEXTS)
    .addRoleOption((o) => o.setName("role").setDescription("points support role").setRequired(true)),

  new SlashCommandBuilder()
    .setName("whitelisted")
    .setDescription("shows all whitelisted users and roles")
    .setIntegrationTypes(ALL_TYPES).setContexts(ALL_CONTEXTS),

  // ── points ────────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("rankup")
    .setDescription("add raid points to a member")
    .setIntegrationTypes(ALL_TYPES).setContexts(ALL_CONTEXTS)
    .addUserOption((o) => o.setName("user").setDescription("member to give points to").setRequired(true))
    .addIntegerOption((o) =>
      o.setName("amount").setDescription("amount to add (default: 1)").setRequired(false).setMinValue(1),
    ),

  new SlashCommandBuilder()
    .setName("removepoints")
    .setDescription("remove raid points from a member")
    .setIntegrationTypes(ALL_TYPES).setContexts(ALL_CONTEXTS)
    .addUserOption((o) => o.setName("user").setDescription("member to remove points from").setRequired(true))
    .addIntegerOption((o) =>
      o.setName("amount").setDescription("amount to remove (default: 1)").setRequired(false).setMinValue(1),
    ),

  new SlashCommandBuilder()
    .setName("resetall")
    .setDescription("wipe all raid points in the server — prompts for confirmation")
    .setIntegrationTypes(ALL_TYPES).setContexts(ALL_CONTEXTS),

  new SlashCommandBuilder()
    .setName("check")
    .setDescription("show your or another member's current raid point total")
    .setIntegrationTypes(ALL_TYPES).setContexts(ALL_CONTEXTS)
    .addUserOption((o) => o.setName("user").setDescription("member to check (default: yourself)").setRequired(false)),

  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("show the top 15 raid point holders in the server")
    .setIntegrationTypes(ALL_TYPES).setContexts(ALL_CONTEXTS),

  // ── ranks ─────────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("addrank")
    .setDescription("add a rank tier — members auto-promote when they hit the threshold")
    .setIntegrationTypes(ALL_TYPES).setContexts(ALL_CONTEXTS)
    .addStringOption((o) => o.setName("roleid").setDescription("discord role id").setRequired(true))
    .addIntegerOption((o) =>
      o.setName("points").setDescription("points required to unlock this rank").setRequired(true).setMinValue(1),
    )
    .addStringOption((o) =>
      o.setName("name").setDescription("rank name (defaults to role name)").setRequired(false),
    ),

  new SlashCommandBuilder()
    .setName("removerank")
    .setDescription("remove a rank tier from the configuration")
    .setIntegrationTypes(ALL_TYPES).setContexts(ALL_CONTEXTS)
    .addStringOption((o) => o.setName("roleid").setDescription("role id of the rank to remove").setRequired(true)),

  new SlashCommandBuilder()
    .setName("ranks")
    .setDescription("list all configured rank tiers sorted by points required")
    .setIntegrationTypes(ALL_TYPES).setContexts(ALL_CONTEXTS),

  // ── bot settings ──────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("setstatus")
    .setDescription("set the bot's playing status — use 'clear' to remove it")
    .setIntegrationTypes(ALL_TYPES).setContexts(ALL_CONTEXTS)
    .addStringOption((o) => o.setName("text").setDescription("status text, or 'clear' to remove").setRequired(true)),

  new SlashCommandBuilder()
    .setName("setpresence")
    .setDescription("set the bot's presence status")
    .setIntegrationTypes(ALL_TYPES).setContexts(ALL_CONTEXTS)
    .addStringOption((o) =>
      o.setName("status").setDescription("presence status").setRequired(true)
        .addChoices(
          { name: "online", value: "online" },
          { name: "idle", value: "idle" },
          { name: "dnd", value: "dnd" },
          { name: "invisible", value: "invisible" },
        ),
    ),

  new SlashCommandBuilder()
    .setName("setavatar")
    .setDescription("change the bot's profile picture")
    .setIntegrationTypes(ALL_TYPES).setContexts(ALL_CONTEXTS)
    .addStringOption((o) => o.setName("url").setDescription("image url").setRequired(false))
    .addAttachmentOption((o) => o.setName("image").setDescription("image attachment").setRequired(false)),

  new SlashCommandBuilder()
    .setName("setbanner")
    .setDescription("change the bot's banner (requires nitro on the bot account)")
    .setIntegrationTypes(ALL_TYPES).setContexts(ALL_CONTEXTS)
    .addStringOption((o) => o.setName("url").setDescription("image url").setRequired(false))
    .addAttachmentOption((o) => o.setName("image").setDescription("image attachment").setRequired(false)),

  new SlashCommandBuilder()
    .setName("setusername")
    .setDescription("change the bot's global username — discord rate-limits this, use sparingly")
    .setIntegrationTypes(ALL_TYPES).setContexts(ALL_CONTEXTS)
    .addStringOption((o) =>
      o.setName("name").setDescription("new username (2–32 chars)").setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName("setnickname")
    .setDescription("change the bot's nickname in this server — leave blank to reset")
    .setIntegrationTypes(ALL_TYPES).setContexts(ALL_CONTEXTS)
    .addStringOption((o) =>
      o.setName("name").setDescription("new nickname — leave blank to reset").setRequired(false),
    ),

  new SlashCommandBuilder()
    .setName("backup")
    .setDescription("download all bot data as a json backup file")
    .setIntegrationTypes(ALL_TYPES).setContexts(ALL_CONTEXTS),

  new SlashCommandBuilder()
    .setName("restore")
    .setDescription("restore bot data from a backup json file")
    .setIntegrationTypes(ALL_TYPES).setContexts(ALL_CONTEXTS)
    .addAttachmentOption((o) =>
      o.setName("file").setDescription("backup .json file").setRequired(true),
    ),

].map((c) => c.toJSON());

export function registerReady(client: Client) {
  client.once("clientReady", async (c) => {
    console.log(`logged in as ${c.user.tag}`);

    const rest = new REST().setToken(process.env["DISCORD_BOT_TOKEN"]!);
    try {
      await rest.put(Routes.applicationCommands(c.user.id), { body: commands });
      console.log(`registered ${commands.length} slash commands`);
    } catch (err) {
      console.error("slash command registration failed:", err);
    }

    const guilds = readJSON<Record<string, { botLogChannel?: string }>>("guilds.json");
    const startTime = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    for (const [guildId, s] of Object.entries(guilds)) {
      if (!s.botLogChannel) continue;
      await logInfo(guildId, "Bot Online", `**${c.user.username}** just came online`, [
        { name: "Tag",        value: c.user.tag,                   inline: true },
        { name: "Servers",    value: String(c.guilds.cache.size),   inline: true },
        { name: "Started At", value: startTime,                    inline: true },
      ]);
    }
  });
}
