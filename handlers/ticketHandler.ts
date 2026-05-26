import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ChannelType, ModalBuilder, PermissionFlagsBits,
  StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
  type Client, type Guild, type Interaction, type TextChannel, type Message,
} from "discord.js";
import {
  getGuild, getTickets, setTicket, deleteTicket, addTicketMessage,
  memberHasTagManagerRole, getPoints, savePoints, type TicketData,
} from "../utils/storage.js";
import { refreshLeaderboard } from "../utils/leaderboard.js";
import {
  getUserByUsername, getUserGroups, isInGroup, giveRobloxTagRole, kickFromGroup,
} from "../utils/roblox.js";
import { generateTranscript } from "../utils/transcript.js";
import { logTicket } from "../utils/botLogger.js";

const TAG_GROUP_ID = "396910998";

const KICK_ON_DENY_TAGS: Record<string, string> = {
  "sharingan tag": TAG_GROUP_ID,
  "rockstar":      TAG_GROUP_ID,
  "dark":          TAG_GROUP_ID,
  "faze":          TAG_GROUP_ID,
  "fraid":         TAG_GROUP_ID,
};

async function kickDeniedUser(robloxUsername: string, tag: string): Promise<void> {
  const groupId = KICK_ON_DENY_TAGS[tag.toLowerCase()];
  if (!groupId || !robloxUsername) return;
  const user = await getUserByUsername(robloxUsername).catch(() => null);
  if (!user) return;
  await kickFromGroup(groupId, user.id).catch(() => {});
}

const WHITE = 0xffffff;

const TAG_OPTIONS = [
  { label: "Sharingan Tag", value: "sharingan tag", description: "sharingan tag request" },
  { label: "Rockstar",      value: "rockstar",      description: "rockstar tag request"  },
  { label: "Dark",          value: "dark",          description: "dark tag request"      },
  { label: "FaZe",          value: "faze",          description: "faze tag request"      },
  { label: "Fraid",         value: "fraid",         description: "fraid tag request"     },
  { label: "Member",        value: "member",        description: "strip back to member"  },
];

const TAG_GROUP_MSG = `### TAG GROUP —> https://www.roblox.com/communities/${TAG_GROUP_ID}`;

function ts() { return new Date().toISOString(); }

const OWNER_IDS = new Set(["1472482602215538779"]);

function canManageTags(member: import("discord.js").GuildMember | null | undefined, guildId: string): boolean {
  if (!member) return false;
  if (OWNER_IDS.has(member.id)) return true;
  return memberHasTagManagerRole(member, guildId);
}

async function getDiscordAvatar(guild: Guild, userId: string): Promise<string | null> {
  try {
    const member = guild.members.cache.get(userId) ?? await guild.members.fetch(userId).catch(() => null);
    return member?.displayAvatarURL({ size: 256 }) ?? null;
  } catch {
    return null;
  }
}

export async function sendTicketPanel(channel: TextChannel, type: "verification" | "tag" | "both") {
  if (type === "both") {
    const menu = new StringSelectMenuBuilder()
      .setCustomId("ticket_select")
      .setPlaceholder("open a ticket...")
      .addOptions([
        { label: "verification ticket", description: "get verified with your roblox account", value: "verification" },
        { label: "tag ticket",          description: "request a roblox tag",                   value: "tag" },
      ]);
    await channel.send({
      embeds: [{ color: WHITE, title: "open a ticket...", timestamp: ts() }],
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
    });
  } else if (type === "tag") {
    const btn = new ButtonBuilder().setCustomId("open_ticket_tag").setLabel("open tag ticket").setStyle(ButtonStyle.Secondary);
    await channel.send({
      embeds: [{ color: WHITE, title: "open a ticket...", timestamp: ts() }],
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(btn)],
    });
  } else {
    const btn = new ButtonBuilder().setCustomId("open_ticket_verification").setLabel("open verification ticket").setStyle(ButtonStyle.Secondary);
    await channel.send({
      embeds: [{ color: WHITE, title: "open a ticket...", timestamp: ts() }],
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(btn)],
    });
  }
}

export async function showVerificationModal(interaction: Interaction): Promise<void> {
  if (!("showModal" in interaction)) return;
  const i = interaction as import("discord.js").ButtonInteraction;

  const existing = getTickets();
  const alreadyOpen = Object.values(existing).find(
    (t) => t.userId === i.user.id && t.guildId === i.guild?.id && t.type === "verification",
  );
  if (alreadyOpen) {
    const ch = i.guild?.channels.cache.get(alreadyOpen.channelId);
    if (ch) { await i.reply({ content: `you already have a ticket open: <#${ch.id}>`, ephemeral: true }); return; }
  }

  const modal = new ModalBuilder().setCustomId("verification_username_modal").setTitle("Verification Ticket");
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("roblox_username").setLabel("Roblox Username")
        .setStyle(TextInputStyle.Short).setPlaceholder("your roblox username").setRequired(true),
    ),
  );
  await i.showModal(modal);
}

export async function openVerificationTicket(
  interaction: Interaction,
  guild: Guild,
  robloxUsername: string,
) {
  const i = interaction as import("discord.js").ModalSubmitInteraction;
  const settings = getGuild(guild.id);

  const category = guild.channels.cache.get("1493484158738108447") ?? null;

  const FALLBACK_VMR = "1493484814215413771";
  const vmrRoleIds: string[] = [
    ...(settings.verificationManagerRoles ?? []),
    ...(settings.verificationManagerRole ? [settings.verificationManagerRole] : []),
  ];
  if (vmrRoleIds.length === 0) vmrRoleIds.push(FALLBACK_VMR);

  const verifyOverwrites: import("discord.js").OverwriteResolvable[] = [
    { id: guild.id,   deny:  [PermissionFlagsBits.ViewChannel] },
    { id: i.user.id,  allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
  ];
  for (const rid of vmrRoleIds) {
    if (guild.roles.cache.has(rid)) {
      verifyOverwrites.push({ id: rid, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
    }
  }
  if (settings.tagManagerRole && guild.roles.cache.has(settings.tagManagerRole)) {
    verifyOverwrites.push({ id: settings.tagManagerRole, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
  }

  const ticketChannel = await guild.channels.create({
    name: `ticket-${i.user.username}`,
    type: ChannelType.GuildText,
    parent: (category as import("discord.js").CategoryChannel)?.id,
    permissionOverwrites: verifyOverwrites,
  }) as TextChannel;

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("ticket_verify").setLabel("Verify").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("ticket_kick").setLabel("Kick").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("ticket_close").setLabel("Close Ticket").setStyle(ButtonStyle.Secondary),
  );

  const msg = await ticketChannel.send({
    content: `<@${i.user.id}> ${vmrRoleIds.map((id) => `<@&${id}>`).join(" ")}`,
    embeds: [{
      color: WHITE,
      title: "verification ticket",
      description: [
        `opened by <@${i.user.id}>`,
        `roblox username: \`${robloxUsername}\``,
      ].join("\n"),
      footer: { text: i.client.user?.username ?? "bot" },
      timestamp: ts(),
    }],
    components: [row],
  });

  const ticketData: TicketData = {
    channelId: ticketChannel.id, userId: i.user.id, guildId: guild.id,
    type: "verification", robloxUsername, messageId: msg.id,
    messages: [{ author: "System", authorId: "0", content: `Verification ticket opened by ${i.user.username} — roblox: ${robloxUsername}`, timestamp: Date.now() }],
    openedAt: Date.now(), status: "open",
  };
  setTicket(ticketChannel.id, ticketData);

  await logTicket(guild.id, "Verification Ticket Opened",
    `<@${i.user.id}> opened a verification ticket`,
    [
      { name: "Roblox",  value: robloxUsername,           inline: true },
      { name: "Channel", value: `<#${ticketChannel.id}>`, inline: true },
    ],
  );

  await runGroupCheck(ticketChannel, robloxUsername, guild.id, i.client);
  await i.editReply({ content: `ticket opened: <#${ticketChannel.id}>` });
}

export async function openTagChannel(interaction: Interaction) {
  const i = interaction as import("discord.js").ButtonInteraction | import("discord.js").StringSelectMenuInteraction;

  const existing = getTickets();
  const alreadyOpen = Object.values(existing).find(
    (t) => t.userId === i.user.id && t.guildId === i.guild?.id && t.type === "tag",
  );
  if (alreadyOpen) {
    const ch = i.guild?.channels.cache.get(alreadyOpen.channelId);
    if (ch) return i.reply({ content: `you already have a tag ticket open: <#${ch.id}>`, ephemeral: true });
  }

  const guild    = i.guild!;
  const settings = getGuild(guild.id);

  const category = guild.channels.cache.get("1493506799347830834") ?? null;

  const overwrites: import("discord.js").OverwriteResolvable[] = [
    { id: guild.id,  deny:  [PermissionFlagsBits.ViewChannel] },
    { id: i.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
  ];
  if (settings.tagManagerRole && guild.roles.cache.has(settings.tagManagerRole)) {
    overwrites.push({ id: settings.tagManagerRole, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
  }

  const ticketChannel = await guild.channels.create({
    name: `tag-${i.user.username}`,
    type: ChannelType.GuildText,
    parent: (category as import("discord.js").CategoryChannel)?.id,
    permissionOverwrites: overwrites,
  }) as TextChannel;

  const menu = new StringSelectMenuBuilder()
    .setCustomId("in_channel_tag_select")
    .setPlaceholder("pick a tag...")
    .addOptions(TAG_OPTIONS);

  await ticketChannel.send({
    content: `<@${i.user.id}> <@&1494364609140752554>`,
    embeds: [{ color: WHITE, title: "tag ticket", description: "pick a tag from the dropdown below.", timestamp: ts() }],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
  });

  const ticketData: TicketData = {
    channelId: ticketChannel.id, userId: i.user.id, guildId: guild.id,
    type: "tag", messageId: undefined,
    messages: [{ author: "System", authorId: "0", content: `Tag ticket opened by ${i.user.username}`, timestamp: Date.now() }],
    openedAt: Date.now(), status: "open",
  };
  setTicket(ticketChannel.id, ticketData);

  await logTicket(guild.id, "Tag Ticket Opened", `<@${i.user.id}> opened a tag ticket`, [
    { name: "Channel", value: `<#${ticketChannel.id}>`, inline: true },
  ]);

  return i.reply({ content: `tag ticket opened: <#${ticketChannel.id}>`, ephemeral: true });
}

export async function handleInChannelTagSelect(interaction: import("discord.js").StringSelectMenuInteraction) {
  const tag = interaction.values[0]!;

  const modal = new ModalBuilder().setCustomId(`tag_ticket_modal::${tag}`).setTitle(`${tag} tag request`);
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("roblox_username").setLabel("Roblox Username")
        .setStyle(TextInputStyle.Short).setPlaceholder("your roblox username").setRequired(true),
    ),
  );
  await interaction.showModal(modal);
}

export async function postTagReviewEmbed(
  interaction: import("discord.js").ModalSubmitInteraction,
  tag: string,
  robloxUsername: string,
): Promise<void> {
  const guildId   = interaction.guild!.id;
  const tickets   = getTickets();
  const channelId = interaction.channelId ?? "";
  const ticket    = channelId ? tickets[channelId] : undefined;
  if (!ticket) { await interaction.reply({ content: "couldn't find the ticket for this channel.", ephemeral: true }); return; }

  ticket.requestedTag   = tag;
  ticket.robloxUsername = robloxUsername;
  ticket.status         = "open";
  setTicket(ticket.channelId, ticket);

  await interaction.deferReply();

  const reviewRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("ticket_tag_approve").setLabel("Approve").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("ticket_tag_deny").setLabel("Deny").setStyle(ButtonStyle.Danger),
  );

  await interaction.editReply({
    embeds: [{
      color: WHITE,
      title: "tag request — pending review",
      description: [
        `**User:** <@${interaction.user.id}>`,
        `**Roblox:** \`${robloxUsername}\``,
        `**Tag:** \`${tag}\``,
        ``,
        `This request is waiting for a tag manager to review it.`,
        `Press **Approve** to accept them into the group and assign the tag, or **Deny** to close the ticket without taking any action.`,
      ].join("\n"),
      footer: { text: "tag managers only" },
      timestamp: ts(),
    }],
    components: [reviewRow],
  });

  if (tag.toLowerCase() !== "member") {
    const ch = interaction.channel as TextChannel | null;
    await ch?.send({ content: TAG_GROUP_MSG }).catch(() => {});
  }

  await logTicket(guildId, "Tag Request Submitted",
    `<@${interaction.user.id}> submitted a tag request — waiting for review`,
    [{ name: "Roblox", value: robloxUsername, inline: true }, { name: "Tag", value: tag, inline: true }],
  );
}

export async function handleTagApprove(interaction: import("discord.js").ButtonInteraction): Promise<void> {
  const tickets = getTickets();
  const ticket  = tickets[interaction.channelId];
  if (!ticket) { await interaction.reply({ content: "can't find this ticket.", ephemeral: true }); return; }

  if (!canManageTags(interaction.member as import("discord.js").GuildMember | null, interaction.guild!.id)) {
    await interaction.reply({ content: "you don't have permission to approve tag requests.", ephemeral: true }); return;
  }

  const tag            = ticket.requestedTag ?? "no tag";
  const robloxUsername = ticket.robloxUsername ?? "";

  await interaction.deferReply();

  const result = await giveRobloxTagRole(robloxUsername, tag);

  if (!result.ok) {
    await interaction.editReply({
      embeds: [{
        color: WHITE,
        title: "tag approval failed",
        description: [
          `**User:** <@${ticket.userId}>`,
          `**Roblox:** \`${robloxUsername}\``,
          `**Tag:** \`${tag}\``,
          ``,
          `✗ Something went wrong on Roblox's end: ${result.reason}`,
          `Check the tag group and try again, or deny the request.`,
        ].join("\n"),
        footer: { text: "check the tag group and try again" },
        timestamp: ts(),
      }],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId("ticket_tag_approve").setLabel("Retry Approve").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId("ticket_tag_deny").setLabel("Deny").setStyle(ButtonStyle.Danger),
        ),
      ],
    });
    return;
  }

  ticket.status       = "approved";
  ticket.closedAt     = Date.now();
  ticket.closedBy     = interaction.user.username;
  ticket.closedById   = interaction.user.id;
  ticket.approvedBy   = interaction.user.username;
  ticket.approvedById = interaction.user.id;
  setTicket(ticket.channelId, ticket);

  await interaction.editReply({
    embeds: [{
      color: WHITE,
      title: "tag request approved",
      description: [
        `**User:** <@${ticket.userId}>`,
        `**Roblox:** \`${robloxUsername}\``,
        `**Tag:** \`${tag}\``,
        ``,
        `✓ They've been accepted into the group and assigned the tag on Roblox.`,
        `Approved by <@${interaction.user.id}>.`,
      ].join("\n"),
      footer: { text: "this ticket will close shortly" },
      timestamp: ts(),
    }],
    components: [],
  });

  await logTicket(interaction.guild!.id, "Tag Approved",
    `<@${interaction.user.id}> approved the tag request for <@${ticket.userId}>`,
    [{ name: "Roblox", value: robloxUsername, inline: true }, { name: "Tag", value: tag, inline: true }],
  );

  setTimeout(async () => {
    await sendTagLog(interaction.client, interaction.guild!, ticket);
    await postCloseLog(interaction.client, interaction.guild!, ticket);
    deleteTicket(ticket.channelId);
    const ch = interaction.guild?.channels.cache.get(ticket.channelId);
    await (ch as TextChannel)?.delete().catch(() => {});
  }, 5000);
}

export async function handleTagDeny(interaction: import("discord.js").ButtonInteraction): Promise<void> {
  const tickets = getTickets();
  const ticket  = tickets[interaction.channelId];
  if (!ticket) { await interaction.reply({ content: "can't find this ticket.", ephemeral: true }); return; }

  if (!canManageTags(interaction.member as import("discord.js").GuildMember | null, interaction.guild!.id)) {
    await interaction.reply({ content: "you don't have permission to deny tag requests.", ephemeral: true }); return;
  }

  ticket.status     = "denied";
  ticket.closedAt   = Date.now();
  ticket.closedBy   = interaction.user.username;
  ticket.closedById = interaction.user.id;
  setTicket(ticket.channelId, ticket);

  await interaction.reply({
    embeds: [{
      color: WHITE,
      title: "tag request denied",
      description: [
        `**User:** <@${ticket.userId}>`,
        `**Roblox:** \`${ticket.robloxUsername ?? "unknown"}\``,
        `**Tag:** \`${ticket.requestedTag ?? "unknown"}\``,
        ``,
        `This request has been denied by <@${interaction.user.id}>.`,
        `No changes were made on Roblox.`,
      ].join("\n"),
      footer: { text: "this ticket will close shortly" },
      timestamp: ts(),
    }],
    components: [],
  });

  await logTicket(interaction.guild!.id, "Tag Denied",
    `<@${interaction.user.id}> denied the tag request for <@${ticket.userId}>`,
    [
      { name: "Roblox", value: ticket.robloxUsername ?? "unknown", inline: true },
      { name: "Tag",    value: ticket.requestedTag   ?? "unknown", inline: true },
    ],
  );

  setTimeout(async () => {
    await sendTagLog(interaction.client, interaction.guild!, ticket);
    await postCloseLog(interaction.client, interaction.guild!, ticket);
    deleteTicket(ticket.channelId);
    const ch = interaction.guild?.channels.cache.get(ticket.channelId);
    await (ch as TextChannel)?.delete().catch(() => {});
  }, 4000);
}

export async function closeTicket(
  interaction: import("discord.js").ButtonInteraction,
  ticket: TicketData,
  reason: string | null,
) {
  await postCloseLog(interaction.client, interaction.guild!, ticket);
  deleteTicket(ticket.channelId);
  const ch = interaction.guild?.channels.cache.get(ticket.channelId);
  await (ch as TextChannel)?.delete().catch(() => {});
}

export async function closeTicketByMessage(message: import("discord.js").Message): Promise<void> {
  const tickets = getTickets();
  const ticket  = tickets[message.channelId];
  if (!ticket) {
    await message.reply("this channel isn't an active ticket.");
    return;
  }
  ticket.status     = ticket.status === "open" ? "closed" : ticket.status;
  ticket.closedAt   = Date.now();
  ticket.closedBy   = message.author.username;
  ticket.closedById = message.author.id;
  setTicket(ticket.channelId, ticket);
  await message.reply("closing ticket...");
  await postCloseLog(message.client, message.guild!, ticket);
  deleteTicket(ticket.channelId);
  setTimeout(async () => {
    const ch = message.guild?.channels.cache.get(ticket.channelId);
    await (ch as TextChannel)?.delete().catch(() => {});
  }, 2000);
}

export async function handleTagManagerMessage(message: Message) {
  if (!message.guild) return;
  const guildId = message.guild.id;
  const tickets = getTickets();
  const ticket  = tickets[message.channelId];
  if (!ticket || ticket.type !== "tag" || ticket.status !== "open") return;

  const hasAccess =
    message.member?.permissions.has(PermissionFlagsBits.Administrator) ||
    (message.member ? memberHasTagManagerRole(message.member, guildId) : false);
  if (!hasAccess) return;

  const APPROVE = ["approved", "yes", "approve"];
  const DENY    = ["no", "deny", "denied"];
  const content = message.content.toLowerCase().trim();
  const isApprove = APPROVE.includes(content);
  const isDeny    = DENY.includes(content);
  if (!isApprove && !isDeny) return;

  const tag            = ticket.requestedTag ?? "no tag";
  const robloxUsername = ticket.robloxUsername ?? "";

  addTicketMessage(message.channelId, {
    author: message.author.username, authorId: message.author.id,
    content: message.content, timestamp: Date.now(),
  });

  if (isApprove) {
    ticket.status       = "approved";
    ticket.closedAt     = Date.now();
    ticket.closedBy     = message.author.username;
    ticket.closedById   = message.author.id;
    ticket.approvedBy   = message.author.username;
    ticket.approvedById = message.author.id;

    let robloxNote = "";
    if (robloxUsername && tag !== "no tag") {
      const result = await giveRobloxTagRole(robloxUsername, tag);
      robloxNote = result.ok
        ? `roblox role **${tag}** given to \`${robloxUsername}\``
        : `roblox role failed: ${result.reason}`;
    }

    await (message.channel as TextChannel).send({
      embeds: [{
        color: WHITE,
        description: [`tag \`${tag}\` approved for **${robloxUsername}** by <@${message.author.id}>.`, robloxNote].filter(Boolean).join("\n"),
        timestamp: ts(),
      }],
    });

    setTicket(ticket.channelId, ticket);
    await logTicket(guildId, "Tag Approved (Text)", `<@${message.author.id}> approved tag \`${tag}\` by typing`, [
      { name: "Roblox", value: robloxUsername, inline: true },
    ]);
    await sendTagLog(message.client, message.guild!, ticket);
  } else {
    ticket.status     = "denied";
    ticket.closedAt   = Date.now();
    ticket.closedBy   = message.author.username;
    ticket.closedById = message.author.id;
    setTicket(ticket.channelId, ticket);
    await kickDeniedUser(ticket.robloxUsername ?? "", ticket.requestedTag ?? "");
    await (message.channel as TextChannel).send({
      embeds: [{ color: WHITE, description: `tag request denied by <@${message.author.id}>.`, timestamp: ts() }],
    });
    await logTicket(guildId, "Tag Denied (Text)", `<@${message.author.id}> denied a tag request by typing`);
    await sendTagLog(message.client, message.guild!, ticket);
  }

  setTimeout(async () => {
    await postCloseLog(message.client, message.guild!, ticket);
    deleteTicket(ticket.channelId);
    const ch = message.guild?.channels.cache.get(ticket.channelId);
    await (ch as TextChannel)?.delete().catch(() => {});
  }, 3000);
}

const GREEN = 0x57f287;
const RED   = 0xed4245;

async function runGroupCheck(channel: TextChannel, robloxUsername: string, guildId: string, client: Client) {
  const settings      = getGuild(guildId);
  const flaggedGroups = settings.flaggedGroups ?? [];
  const requiredGid   = settings.groupId ?? "703716156";

  const user = await getUserByUsername(robloxUsername).catch(() => null);
  if (!user) {
    await channel.send({ embeds: [{ color: RED, description: `couldn't find **${robloxUsername}** on roblox.`, timestamp: ts() }] });
    return;
  }

  const groups: Array<{ group: { id: number; name: string } }> = await getUserGroups(user.id).catch(() => []);
  const inMain   = await isInGroup(user.id, requiredGid).catch(() => false);
  const flagHits = groups.filter((g) => flaggedGroups.includes(String(g.group.id)));

  const clearToVerify = inMain && flagHits.length === 0;
  const statusColor   = clearToVerify ? GREEN : RED;

  const groupList = groups.length > 0
    ? groups.map((g) => `• [${g.group.name}](https://www.roblox.com/groups/${g.group.id})`).join("\n")
    : "• none";

  const embeds: object[] = [{
    color: statusColor,
    description: `**${user.name}**\n\n**groups**\n${groupList}`,
    footer: { text: client.user?.username ?? "bot" },
    timestamp: ts(),
  }];

  if (flagHits.length > 0) {
    embeds.push({
      color: RED,
      description: `**${user.name}** is in flagged groups — ask them to leave:\n\n${flagHits.map((m) => `• [${m.group.name}](https://www.roblox.com/groups/${m.group.id})`).join("\n")}`,
      timestamp: ts(),
    });
  }

  embeds.push({
    color: statusColor,
    description: inMain
      ? `**${user.name}** is in the main group and good to verify\n\n**group id:** \`${requiredGid}\`\n**link:** [join here](https://www.roblox.com/communities/${requiredGid})`
      : `**${user.name}** is not in the main group\n\n**group id:** \`${requiredGid}\`\n**link:** [join here](https://www.roblox.com/communities/${requiredGid})`,
    timestamp: ts(),
  });

  await channel.send({ embeds });
}

async function sendTagLog(client: Client, guild: Guild, ticket: TicketData) {
  const settings = getGuild(guild.id);
  const logChId  = settings.tagLogChannel ?? settings.logChannel;
  if (!logChId) return;

  const logCh = guild.channels.cache.get(logChId) as TextChannel | undefined;
  if (!logCh) return;

  const avatarUrl  = await getDiscordAvatar(guild, ticket.userId);
  const transcript = generateTranscript(ticket);

  const embed: Record<string, unknown> = {
    color: WHITE,
    title: ticket.status === "approved" ? "Tag Approved" : "Tag Denied",
    description: [
      `**User:** <@${ticket.userId}>`,
      `**User ID:** \`${ticket.userId}\``,
      `**Roblox:** \`${ticket.robloxUsername ?? "unknown"}\``,
      `**Tag:** \`${ticket.requestedTag ?? "?"}\``,
      ticket.approvedBy ? `**Approved By:** ${ticket.approvedBy}` : null,
      ticket.closedBy && ticket.status === "denied" ? `**Denied By:** ${ticket.closedBy}` : null,
    ].filter(Boolean).join("\n"),
    timestamp: ts(),
  };
  if (avatarUrl) embed["thumbnail"] = { url: avatarUrl };

  await logCh.send({
    embeds: [embed],
    files: [{ attachment: transcript, name: `tag-transcript-${ticket.channelId}.html` }],
  }).catch(() => {});
}

export async function showRaidPointModal(interaction: Interaction): Promise<void> {
  if (!("showModal" in interaction)) return;
  const i = interaction as import("discord.js").ButtonInteraction;
  const modal = new ModalBuilder().setCustomId("raid_point_modal").setTitle("Raid Point Request");
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("roblox_username")
        .setLabel("Roblox Username")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("your roblox username")
        .setRequired(true),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("proof_url")
        .setLabel("Screenshot URL")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("paste a direct link to your raid screenshot")
        .setRequired(true),
    ),
  );
  await i.showModal(modal);
}

export async function openRaidPointTicket(
  interaction: import("discord.js").ModalSubmitInteraction,
  guild: Guild,
  robloxUsername: string,
  proofUrl: string,
): Promise<void> {
  const i        = interaction;
  const guildId  = guild.id;
  const settings = getGuild(guildId);

  const existing    = getTickets();
  const alreadyOpen = Object.values(existing).find(
    (t) => t.userId === i.user.id && t.guildId === guildId && t.type === "raidpoint",
  );
  if (alreadyOpen) {
    const ch = guild.channels.cache.get(alreadyOpen.channelId);
    if (ch) { await i.editReply({ content: `you already have a request open: <#${ch.id}>` }); return; }
  }

  const overwrites: import("discord.js").OverwriteResolvable[] = [
    { id: guild.id,  deny:  [PermissionFlagsBits.ViewChannel] },
    { id: i.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
  ];
  if (settings.pointsSupportRole && guild.roles.cache.has(settings.pointsSupportRole)) {
    overwrites.push({ id: settings.pointsSupportRole, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
  }
  if (settings.pointsRole && guild.roles.cache.has(settings.pointsRole)) {
    overwrites.push({ id: settings.pointsRole, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
  }

  const ticketChannel = await guild.channels.create({
    name: `raid-${i.user.username}`,
    type: ChannelType.GuildText,
    permissionOverwrites: overwrites,
  }) as TextChannel;

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("raid_approve").setLabel("Approve").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("raid_deny").setLabel("Deny").setStyle(ButtonStyle.Danger),
  );

  const pingParts: string[] = [`<@${i.user.id}>`];
  if (settings.pointsSupportRole) pingParts.push(`<@&${settings.pointsSupportRole}>`);
  if (settings.pointsRole)        pingParts.push(`<@&${settings.pointsRole}>`);

  await ticketChannel.send({
    content: pingParts.join(" "),
    embeds: [{
      color: WHITE,
      title: "Raid Point Request",
      description: [
        `**Submitted By:** <@${i.user.id}> (${i.user.username})`,
        `**Roblox Username:** \`${robloxUsername}\``,
        `**Proof:** ${proofUrl}`,
      ].join("\n"),
      footer: { text: "review the proof and approve or deny accordingly" },
      timestamp: ts(),
    }],
    components: [row],
  });

  const ticketData: TicketData = {
    channelId: ticketChannel.id, userId: i.user.id, guildId,
    type: "raidpoint", robloxUsername, proofUrl, messageId: undefined,
    messages: [{ author: "System", authorId: "0", content: `Raid point request by ${i.user.username} — roblox: ${robloxUsername}`, timestamp: Date.now() }],
    openedAt: Date.now(), status: "open",
  };
  setTicket(ticketChannel.id, ticketData);
  await i.editReply({ content: `your request has been submitted: <#${ticketChannel.id}>` });
}

export async function handleRaidApprove(interaction: import("discord.js").ButtonInteraction): Promise<void> {
  const tickets  = getTickets();
  const ticket   = tickets[interaction.channelId];
  if (!ticket) { await interaction.reply({ content: "couldn't find this request.", ephemeral: true }); return; }

  const member   = interaction.member as import("discord.js").GuildMember | null;
  const guildId  = interaction.guild!.id;
  const settings = getGuild(guildId);
  const isOwner  = OWNER_IDS.has(interaction.user.id);
  const hasPSR   = !!settings.pointsSupportRole && !!member?.roles.cache.has(settings.pointsSupportRole);
  const hasPR    = !!settings.pointsRole && !!member?.roles.cache.has(settings.pointsRole);
  const isAdmin  = !!member?.permissions.has(PermissionFlagsBits.Administrator);

  if (!isOwner && !hasPSR && !hasPR && !isAdmin) {
    await interaction.reply({ content: "you don't have permission to approve raid point requests.", ephemeral: true }); return;
  }

  const pts = getPoints(guildId);
  pts[ticket.userId] = (pts[ticket.userId] ?? 0) + 1;
  savePoints(guildId, pts);

  ticket.status     = "approved";
  ticket.closedAt   = Date.now();
  ticket.closedBy   = interaction.user.username;
  ticket.closedById = interaction.user.id;
  setTicket(ticket.channelId, ticket);

  const newTotal = pts[ticket.userId] ?? 0;
  await interaction.reply({
    embeds: [{
      color: WHITE,
      description: [
        `raid point approved for <@${ticket.userId}>.`,
        `current total: **${newTotal}** pt${newTotal !== 1 ? "s" : ""}`,
        `approved by <@${interaction.user.id}>`,
      ].join("\n"),
      timestamp: ts(),
    }],
  });

  refreshLeaderboard(interaction.client, guildId).catch(() => {});

  setTimeout(async () => {
    deleteTicket(ticket.channelId);
    const ch = interaction.guild?.channels.cache.get(ticket.channelId);
    await (ch as TextChannel)?.delete().catch(() => {});
  }, 4000);
}

export async function handleRaidDeny(interaction: import("discord.js").ButtonInteraction): Promise<void> {
  const tickets  = getTickets();
  const ticket   = tickets[interaction.channelId];
  if (!ticket) { await interaction.reply({ content: "couldn't find this request.", ephemeral: true }); return; }

  const member   = interaction.member as import("discord.js").GuildMember | null;
  const guildId  = interaction.guild!.id;
  const settings = getGuild(guildId);
  const isOwner  = OWNER_IDS.has(interaction.user.id);
  const hasPSR   = !!settings.pointsSupportRole && !!member?.roles.cache.has(settings.pointsSupportRole);
  const hasPR    = !!settings.pointsRole && !!member?.roles.cache.has(settings.pointsRole);
  const isAdmin  = !!member?.permissions.has(PermissionFlagsBits.Administrator);

  if (!isOwner && !hasPSR && !hasPR && !isAdmin) {
    await interaction.reply({ content: "you don't have permission to deny raid point requests.", ephemeral: true }); return;
  }

  ticket.status     = "denied";
  ticket.closedAt   = Date.now();
  ticket.closedBy   = interaction.user.username;
  ticket.closedById = interaction.user.id;
  setTicket(ticket.channelId, ticket);

  await interaction.reply({
    embeds: [{
      color: WHITE,
      description: `raid point request denied by <@${interaction.user.id}>.`,
      timestamp: ts(),
    }],
  });

  setTimeout(async () => {
    deleteTicket(ticket.channelId);
    const ch = interaction.guild?.channels.cache.get(ticket.channelId);
    await (ch as TextChannel)?.delete().catch(() => {});
  }, 4000);
}

async function postCloseLog(client: Client, guild: Guild, ticket: TicketData) {
  const settings   = getGuild(guild.id);
  const logChId    = settings.logChannel;
  const transcript = generateTranscript(ticket);

  if (!logChId) return;
  const logCh = guild.channels.cache.get(logChId) as TextChannel | undefined;
  if (!logCh) return;

  const avatarUrl = await getDiscordAvatar(guild, ticket.userId);

  const embed: Record<string, unknown> = {
    color: WHITE,
    title: "Ticket Closed",
    description: [
      `**User:** <@${ticket.userId}>`,
      `**User ID:** \`${ticket.userId}\``,
      `**Type:** ${ticket.type}`,
      ticket.robloxUsername ? `**Roblox:** \`${ticket.robloxUsername}\`` : null,
      ticket.requestedTag   ? `**Tag:** \`${ticket.requestedTag}\`` : null,
      `**Status:** ${ticket.status ?? "closed"}`,
      ticket.closedBy ? `**Closed By:** ${ticket.closedBy}` : null,
    ].filter(Boolean).join("\n"),
    timestamp: ts(),
  };
  if (avatarUrl) embed["thumbnail"] = { url: avatarUrl };

  await logCh.send({
    embeds: [embed],
    files: [{ attachment: transcript, name: `transcript-${ticket.channelId}.html` }],
  }).catch(() => {});
}
