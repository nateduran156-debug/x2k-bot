import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from "discord.js";

const LOGO_URL = "https://www.image2url.com/r2/default/images/1779765441198-50b54995-0ec5-48a8-807d-7d828b73eafc.png";

interface CommandEntry {
  name: string;
  desc: string;
}

export const CATEGORIES: Record<string, { label: string; description: string; commands: CommandEntry[] }> = {
  setup: {
    label: "Setup",
    description: "Server configuration",
    commands: [
      { name: ".setupticket [#channel] [type]",   desc: "Sends the ticket panel to a channel. Type can be verification, tag, or both (default: both)." },
      { name: ".logset [#channel]",                desc: "Sets the channel where ticket close logs are sent." },
      { name: ".taglogset [#channel]",             desc: "Sets the channel where tag approval logs are sent." },
      { name: ".botlogset [#channel]",             desc: "Sets the channel where all bot activity is logged." },
      { name: ".gid <groupId>",                    desc: "Sets the Roblox group ID used for verification checks." },
      { name: ".vset @role",                       desc: "Sets the role members receive when they get verified." },
      { name: ".vmr @role",                        desc: "Adds a role to the verification manager list — supports multiple roles. Use `.vmr remove @role` to remove one, or `.vmr list` to view all." },
      { name: ".prefix <new>",                     desc: "Changes the command prefix for this server." },
    ],
  },
  groups: {
    label: "Groups & Verification",
    description: "Group checks and verification",
    commands: [
      { name: ".gc <username>",                    desc: "Runs a full group check on a Roblox user. Shows all groups, flags, and main group membership." },
      { name: ".flag <groupId>",                   desc: "Flags a Roblox group. Members in flagged groups will be marked in tickets." },
      { name: ".unflag <groupId>",                 desc: "Removes a group from this server's flagged list." },
      { name: ".flist",                            desc: "Lists all flagged groups — both global and server-specific." },
      { name: ".verify @user [username]",          desc: "Manually gives a member the verified role. Optionally links their Roblox username." },
      { name: ".unverify @user",                   desc: "Removes the verified role from a member." },
    ],
  },
  tags: {
    label: "Tags",
    description: "Tag assignment and management",
    commands: [
      { name: ".role <roblox> <tag>",              desc: "Assigns a Roblox tag to a Roblox user. Use the tag name set via .sr." },
      { name: ".sr <role name>",                   desc: "Sets a custom tag option that can be used with .role and /role." },
      { name: ".tmr @role",                        desc: "Sets the tag manager role — members with this role can use .role." },
      { name: ".wlrole @role [command]",           desc: "Gives a role access to a specific command. Leave command blank for tag manager access." },
    ],
  },
  points: {
    label: "Points",
    description: "Raid points system",
    commands: [
      { name: ".register <roblox username>",        desc: "Links your Discord account to your Roblox username. Required before submitting raid point requests." },
      { name: ".linked",                            desc: "Lists all members who have registered their Roblox username, showing their Discord and Roblox accounts." },
      { name: ".rankup [@user] [amount]",           desc: "Adds raid points to a member. Optionally specify an amount (default: 1)." },
      { name: ".remove [@user] [amount]",           desc: "Removes raid points from a member. Optionally specify an amount (default: 1)." },
      { name: ".check [@user]",                     desc: "Shows your or another member's current raid point total." },
      { name: ".leaderboard or .lb",                desc: "Shows the top 15 raid point holders in the server." },
      { name: ".resetall",                          desc: "Wipes all raid points in the server — prompts for confirmation first." },
      { name: ".wlp @role",                         desc: "Gives a role full access to all raid points commands." },
      { name: ".psr @role",                         desc: "Sets the points support role — they can review raid point requests and use .check, .lb, and .rankup." },
      { name: "/raidpointspanel #channel",          desc: "Sends the raid point request panel to a channel. Members click the button, fill out a form, and a private review channel is created for staff." },
      { name: "/leaderboardpanel #channel",         desc: "Sends a live leaderboard panel to a channel. The panel automatically refreshes every 10 minutes." },
    ],
  },
  ranks: {
    label: "Ranks",
    description: "Rank role configuration",
    commands: [
      { name: ".addrank <roleId> <points> [name]", desc: "Adds a rank tier. Members auto-promote when their points reach the threshold. Max 30 ranks." },
      { name: ".removerank <roleId>",              desc: "Removes a rank tier from the configuration." },
      { name: ".ranks",                            desc: "Lists all configured rank tiers, sorted by points required." },
    ],
  },
  whitelist: {
    label: "Whitelist",
    description: "Access control and permissions",
    commands: [
      { name: ".wl bot @user",                     desc: "Grants a user full access to every bot command." },
      { name: ".wl command <name> @user",          desc: "Grants a user access to one specific command." },
      { name: ".whitelisted",                      desc: "Shows all users and roles that have been whitelisted." },
    ],
  },
  bot: {
    label: "Bot Settings",
    description: "Bot customization and data",
    commands: [
      { name: ".setavatar [url or attachment]",    desc: "Changes the bot's profile picture — attach an image or paste a URL." },
      { name: ".setbanner [url or attachment]",    desc: "Changes the bot's banner — requires Nitro on the bot account." },
      { name: ".setusername <name>",               desc: "Changes the bot's global username — Discord rate-limits this, so use it sparingly." },
      { name: ".setnickname [name]",               desc: "Changes the bot's nickname in this server — leave blank to reset." },
      { name: ".status <text>",                    desc: "Sets the bot's playing status. Use 'clear' to remove it." },
      { name: ".presence <status>",                desc: "Sets presence: online, idle, dnd, or invisible." },
      { name: ".backup",                           desc: "Downloads all bot data as a JSON backup file." },
      { name: ".restore",                          desc: "Restores bot data from a backup JSON file." },
    ],
  },
};

const DEFAULT_CATEGORY = "setup";

function buildSelectMenu(selected: string) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId("help_category")
    .setPlaceholder("Select a category")
    .addOptions(
      Object.entries(CATEGORIES).map(([value, cat]) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(cat.label)
          .setValue(value)
          .setDescription(cat.description)
          .setDefault(value === selected),
      ),
    );
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

export function buildHelpMessage(category: string = DEFAULT_CATEGORY): { embeds: object[]; components: unknown[] } {
  const cat = CATEGORIES[category] ?? CATEGORIES[DEFAULT_CATEGORY]!;
  return {
    embeds: [{
      color: 0xffffff,
      title: cat.label,
      description: cat.commands.map((c) => `\`${c.name}\`\n${c.desc}`).join("\n\n"),
      thumbnail: { url: LOGO_URL },
      footer: { text: "prefix: .  •  select a category below to browse" },
      timestamp: new Date().toISOString(),
    }],
    components: [buildSelectMenu(category)],
  };
}

export const ALL_COMMANDS = Object.values(CATEGORIES).flatMap((c) => c.commands);
export const PER_PAGE = 6;
export function buildPage(_page: number) { return buildHelpMessage(DEFAULT_CATEGORY); }
