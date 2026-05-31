import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type Client,
  type Guild,
  type Interaction,
  type TextChannel,
  type Message,
} from "discord.js";
import {
  getGuild,
  getTickets,
  setTicket,
  deleteTicket,
  addTicketMessage,
  memberHasTagManagerRole,
  getPoints,
  savePoints,
  type TicketData,
} from "../utils/storage.js";
import { refreshLeaderboard } from "../utils/leaderboard.js";
import {
  getUserByUsername,
  getUserGroups,
  isInGroup,
  giveRobloxTagRole,
  kickFromGroup,
} from "../utils/roblox.js";
import { generateTranscript } from "../utils/transcript.js";
import { logTicket } from "../utils/botLogger.js";

const TAG_GROUP_ID = "396910998";

// Tags that should trigger a group kick when denied
const KICK_ON_DENY_TAGS: Record<string, string> = {
  "sharingan tag": TAG_GROUP_ID,
  "rockstar": TAG_GROUP_ID,
  "dark": TAG_GROUP_ID,
  "faze": TAG_GROUP_ID,
  "fraid": TAG_GROUP_ID,
};

// Kick a roblox user from the group when their tag request is denied
async function kickDeniedUser(robloxUsername: string, tag: string): Promise<void> {
  const groupId = KICK_ON_DENY_TAGS[tag.toLowerCase()];
  if (!groupId || !robloxUsername) return;

  const user = await getUserByUsername(robloxUsername).catch(() => null);
  if (!user) return;

  await kickFromGroup(groupId, user.id).catch(() => {});
}

const WHITE = 0xffffff;
const GREEN = 0x57f287;
const RED = 0xed4245;

const TAG_OPTIONS = [
  { label: "Sharingan Tag", value: "sharingan tag", description: "sharingan tag request" },
  { label: "Rockstar", value: "rockstar", description: "rockstar tag request" },
  { label: "Dark", value: "dark", description: "dark tag request" },
  { label: "FaZe", value: "faze", description: "faze tag request" },
  { label: "Fraid", value: "fraid", description: "fraid tag request" },
  { label: "Member", value: "member", description: "strip back to member" },
];

const TAG_GROUP_MSG = `### TAG GROUP —> https://www.roblox.com/communities/${TAG_GROUP_ID}`;

const OWNER_IDS = new Set(["1472482602215538779"]);

function getTimestamp() {
  return new Date().toISOString();
}

// Check if a member has permission to manage tags
function canManageTags(
  member: import("discord.js").GuildMember | null | undefined,
  guildId: string,
): boolean {
  if (!member) return false;
  if (OWNER_IDS.has(member.id)) return true;
  return memberHasTagManagerRole(member, guildId);
}

// Get the discord avatar url for a user in a guild
async function getDiscordAvatar(guild: Guild, userId: string): Promise<string | null> {
  try {
    const member =
      guild.members.cache.get(userId) ??
      (await guild.members.fetch(userId).catch(() => null));
    return member?.displayAvatarURL({ size: 256 }) ?? null;
  } catch {
    return null;
  }
}

// Send the ticket panel to a channel
export async function sendTicketPanel(
  channel: TextChannel,
  type: "verification" | "tag" | "both",
) {
  if (type === "both") {
    const menu = new StringSelectMenuBuilder()
      .setCustomId("ticket_select")
      .setPlaceholder("open a ticket...")
      .addOptions([
        {
          label: "verification ticket",
          description: "get verified with your roblox account",
          value: "verification",
        },
        {
          label: "tag ticket",
          description: "request a roblox tag",
          value: "tag",
        },
      ]);

    await channel.send({
      embeds: [{ color: WHITE, title: "open a ticket...", timestamp: getTimestamp() }],
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
    });
  } else if (type === "tag") {
    const button = new ButtonBuilder()
      .setCustomId("open_ticket_tag")
      .setLabel("open tag ticket")
      .setStyle(ButtonStyle.Secondary);

    await channel.send({
      embeds: [{ color: WHITE, title: "open a ticket...", timestamp: getTimestamp() }],
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button)],
    });
  } else {
    const button = new ButtonBuilder()
      .setCustomId("open_ticket_verification")
      .setLabel("open verification ticket")
      .setStyle(ButtonStyle.Secondary);

    await channel.send({
      embeds: [{ color: WHITE, title: "open a ticket...", description: "Enter your roblox username to get verified", timestamp: getTimestamp() }],
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button)],
    });
  }
}

// Show the verification modal when a user clicks the button
export async function showVerificationModal(interaction: Interaction): Promise<void> {
  if (!("showModal" in interaction)) return;

  const buttonInteraction = interaction as import("discord.js").ButtonInteraction;

  const openTickets = getTickets();
  const existingTicket = Object.values(openTickets).find(
    (ticket) =>
      ticket.userId === buttonInteraction.user.id &&
      ticket.guildId === buttonInteraction.guild?.id &&
      ticket.type === "verification",
  );

  if (existingTicket) {
    const existingChannel = buttonInteraction.guild?.channels.cache.get(existingTicket.channelId);
    if (existingChannel) {
      await buttonInteraction.reply({
        content: `you already have a ticket open: <#${existingChannel.id}>`,
        ephemeral: true,
      });
      return;
    }
  }

  const modal = new ModalBuilder()
    .setCustomId("verification_username_modal")
    .setTitle("Verification Ticket");

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("roblox_username")
        .setLabel("Roblox Username")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("your roblox username")
        .setRequired(true),
    ),
  );

  await buttonInteraction.showModal(modal);
}

// Open a private verification ticket channel for the user
export async function openVerificationTicket(
  interaction: Interaction,
  guild: Guild,
  robloxUsername: string,
) {
  const modalInteraction = interaction as import("discord.js").ModalSubmitInteraction;
  const settings = getGuild(guild.id);

  const categoryId = "1483611162196316231";
  const category = guild.channels.cache.get(categoryId) ?? null;

  const FALLBACK_VMR = "1493484814215413771";
  const vmrRoleIds: string[] = [
    ...(settings.verificationManagerRoles ?? []),
    ...(settings.verificationManagerRole ? [settings.verificationManagerRole] : []),
  ];
  if (vmrRoleIds.length === 0) {
    vmrRoleIds.push(FALLBACK_VMR);
  }

  const channelPermissions: import("discord.js").OverwriteResolvable[] = [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: modalInteraction.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
  ];

  for (const roleId of vmrRoleIds) {
    if (guild.roles.cache.has(roleId)) {
      channelPermissions.push({
        id: roleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      });
    }
  }

  if (settings.tagManagerRole && guild.roles.cache.has(settings.tagManagerRole)) {
    channelPermissions.push({
      id: settings.tagManagerRole,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    });
  }

  const ticketChannel = (await guild.channels.create({
    name: `ticket-${modalInteraction.user.username}`,
    type: ChannelType.GuildText,
    parent: (category as import("discord.js").CategoryChannel)?.id,
    permissionOverwrites: channelPermissions,
  })) as TextChannel;

  const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("ticket_verify").setLabel("Verify").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("ticket_accept_group").setLabel("Accept into Group").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("ticket_kick").setLabel("Kick").setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("ticket_close")
      .setLabel("Close Ticket")
      .setStyle(ButtonStyle.Secondary),
  );

  const rolePings = vmrRoleIds.map((id) => `<@&${id}>`).join(" ");

  const message = await ticketChannel.send({
    content: `<@${modalInteraction.user.id}> ${rolePings}`,
    embeds: [
      {
        color: WHITE,
        title: "verification ticket",
        description: [
          `Enter your roblox username to get verified`,
          ``,
          `opened by <@${modalInteraction.user.id}>`,
          `roblox username: \`${robloxUsername}\``,
        ].join("\n"),
        footer: { text: modalInteraction.client.user?.username ?? "bot" },
        timestamp: getTimestamp(),
      },
    ],
    components: [buttonRow],
  });

  const ticketData: TicketData = {
    channelId: ticketChannel.id,
    userId: modalInteraction.user.id,
    guildId: guild.id,
    type: "verification",
    robloxUsername,
    messageId: message.id,
    messages: [
      {
        author: "System",
        authorId: "0",
        content: `Verification ticket opened by ${modalInteraction.user.username} — roblox: ${robloxUsername}`,
        timestamp: Date.now(),
      },
    ],
    openedAt: Date.now(),
    status: "open",
  };
  setTicket(ticketChannel.id, ticketData);

  await logTicket(guild.id, "Verification Ticket Opened", `<@${modalInteraction.user.id}> opened a verification ticket`, [
    { name: "Roblox", value: robloxUsername, inline: true },
    { name: "Channel", value: `<#${ticketChannel.id}>`, inline: true },
  ]);

  await runGroupCheck(ticketChannel, robloxUsername, guild.id, modalInteraction.client);
  await modalInteraction.editReply({ content: `ticket opened: <#${ticketChannel.id}>` });
}

// Open a private tag ticket channel for the user
export async function openTagChannel(interaction: Interaction) {
  const tagInteraction = interaction as
    | import("discord.js").ButtonInteraction
    | import("discord.js").StringSelectMenuInteraction;

  const openTickets = getTickets();
  const existingTicket = Object.values(openTickets).find(
    (ticket) =>
      ticket.userId === tagInteraction.user.id &&
      ticket.guildId === tagInteraction.guild?.id &&
      ticket.type === "tag",
  );

  if (existingTicket) {
    const existingChannel = tagInteraction.guild?.channels.cache.get(existingTicket.channelId);
    if (existingChannel) {
      return tagInteraction.reply({
        content: `you already have a tag ticket open: <#${existingChannel.id}>`,
        ephemeral: true,
      });
    }
  }

  const guild = tagInteraction.guild!;
  const settings = getGuild(guild.id);

  const categoryId = "1482174736128807034";
  const category = guild.channels.cache.get(categoryId) ?? null;

  const channelPermissions: import("discord.js").OverwriteResolvable[] = [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: tagInteraction.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
  ];

  if (settings.tagManagerRole && guild.roles.cache.has(settings.tagManagerRole)) {
    channelPermissions.push({
      id: settings.tagManagerRole,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    });
  }

  const ticketChannel = (await guild.channels.create({
    name: `tag-${tagInteraction.user.username}`,
    type: ChannelType.GuildText,
    parent: (category as import("discord.js").CategoryChannel)?.id,
    permissionOverwrites: channelPermissions,
  })) as TextChannel;

  const tagMenu = new StringSelectMenuBuilder()
    .setCustomId("in_channel_tag_select")
    .setPlaceholder("pick a tag...")
    .addOptions(TAG_OPTIONS);

  await ticketChannel.send({
    content: `<@${tagInteraction.user.id}> <@&1494364609140752554>`,
    embeds: [
      {
        color: WHITE,
        title: "tag ticket",
        description: "pick a tag from the dropdown below.",
        timestamp: getTimestamp(),
      },
    ],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(tagMenu)],
  });

  const ticketData: TicketData = {
    channelId: ticketChannel.id,
    userId: tagInteraction.user.id,
    guildId: guild.id,
    type: "tag",
    messageId: undefined,
    messages: [
      {
        author: "System",
        authorId: "0",
        content: `Tag ticket opened by ${tagInteraction.user.username}`,
        timestamp: Date.now(),
      },
    ],
    openedAt: Date.now(),
    status: "open",
  };
  setTicket(ticketChannel.id, ticketData);

  await logTicket(guild.id, "Tag Ticket Opened", `<@${tagInteraction.user.id}> opened a tag ticket`, [
    { name: "Channel", value: `<#${ticketChannel.id}>`, inline: true },
  ]);

  return tagInteraction.reply({
    content: `tag ticket opened: <#${ticketChannel.id}>`,
    ephemeral: true,
  });
}

// Show a modal asking for the user's roblox username after they pick a tag
export async function handleInChannelTagSelect(
  interaction: import("discord.js").StringSelectMenuInteraction,
) {
  const selectedTag = interaction.values[0]!;

  const modal = new ModalBuilder()
    .setCustomId(`tag_ticket_modal::${selectedTag}`)
    .setTitle(`${selectedTag} tag request`);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("roblox_username")
        .setLabel("Roblox Username")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("your roblox username")
        .setRequired(true),
    ),
  );

  await interaction.showModal(modal);
}

// Post the tag review embed in the ticket channel after the user submits the form
export async function postTagReviewEmbed(
  interaction: import("discord.js").ModalSubmitInteraction,
  tag: string,
  robloxUsername: string,
): Promise<void> {
  const guildId = interaction.guild!.id;
  const allTickets = getTickets();
  const channelId = interaction.channelId ?? "";
  const ticket = channelId ? allTickets[channelId] : undefined;

  if (!ticket) {
    await interaction.reply({
      content: "couldn't find the ticket for this channel.",
      ephemeral: true,
    });
    return;
  }

  ticket.requestedTag = tag;
  ticket.robloxUsername = robloxUsername;
  ticket.status = "open";
  setTicket(ticket.channelId, ticket);

  await interaction.deferReply();

  const reviewButtons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket_tag_approve")
      .setLabel("Approve")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("ticket_tag_deny")
      .setLabel("Deny")
      .setStyle(ButtonStyle.Danger),
  );

  await interaction.editReply({
    embeds: [
      {
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
        timestamp: getTimestamp(),
      },
    ],
    components: [reviewButtons],
  });

  // Send the tag group link if the tag isn't "member"
  if (tag.toLowerCase() !== "member") {
    const ticketChannel = interaction.channel as TextChannel | null;
    await ticketChannel?.send({ content: TAG_GROUP_MSG }).catch(() => {});
  }

  await logTicket(
    guildId,
    "Tag Request Submitted",
    `<@${interaction.user.id}> submitted a tag request — waiting for review`,
    [
      { name: "Roblox", value: robloxUsername, inline: true },
      { name: "Tag", value: tag, inline: true },
    ],
  );
}

// Handle the approve button click on a tag request
export async function handleTagApprove(
  interaction: import("discord.js").ButtonInteraction,
): Promise<void> {
  const allTickets = getTickets();
  const ticket = allTickets[interaction.channelId];

  if (!ticket) {
    await interaction.reply({ content: "can't find this ticket.", ephemeral: true });
    return;
  }

  const member = interaction.member as import("discord.js").GuildMember | null;
  if (!canManageTags(member, interaction.guild!.id)) {
    await interaction.reply({
      content: "you don't have permission to approve tag requests.",
      ephemeral: true,
    });
    return;
  }

  const tag = ticket.requestedTag ?? "no tag";
  const robloxUsername = ticket.robloxUsername ?? "";

  await interaction.deferReply();

  const result = await giveRobloxTagRole(robloxUsername, tag);

  if (!result.ok) {
    const retryButtons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("ticket_tag_approve")
        .setLabel("Retry Approve")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("ticket_tag_deny")
        .setLabel("Deny")
        .setStyle(ButtonStyle.Danger),
    );

    await interaction.editReply({
      embeds: [
        {
          color: WHITE,
          title: "tag approval failed",
          description: [
            `**User:** <@${ticket.userId}>`,
            `**Roblox:** \`${robloxUsername}\``,
            `**Tag:** \`${tag}\``,
            ``,
            `Something went wrong on Roblox's end: ${result.reason}`,
            `Check the tag group and try again, or deny the request.`,
          ].join("\n"),
          footer: { text: "check the tag group and try again" },
          timestamp: getTimestamp(),
        },
      ],
      components: [retryButtons],
    });
    return;
  }

  ticket.status = "approved";
  ticket.closedAt = Date.now();
  ticket.closedBy = interaction.user.username;
  ticket.closedById = interaction.user.id;
  ticket.approvedBy = interaction.user.username;
  ticket.approvedById = interaction.user.id;
  setTicket(ticket.channelId, ticket);

  await interaction.editReply({
    embeds: [
      {
        color: WHITE,
        title: "tag request approved",
        description: [
          `**User:** <@${ticket.userId}>`,
          `**Roblox:** \`${robloxUsername}\``,
          `**Tag:** \`${tag}\``,
          ``,
          `They've been accepted into the group and assigned the tag on Roblox.`,
          `Approved by <@${interaction.user.id}>.`,
        ].join("\n"),
        footer: { text: "this ticket will close shortly" },
        timestamp: getTimestamp(),
      },
    ],
    components: [],
  });

  await logTicket(
    interaction.guild!.id,
    "Tag Approved",
    `<@${interaction.user.id}> approved the tag request for <@${ticket.userId}>`,
    [
      { name: "Roblox", value: robloxUsername, inline: true },
      { name: "Tag", value: tag, inline: true },
    ],
  );

  setTimeout(async () => {
    await sendTagLog(interaction.client, interaction.guild!, ticket);
    await postCloseLog(interaction.client, interaction.guild!, ticket);
    deleteTicket(ticket.channelId);
    const channel = interaction.guild?.channels.cache.get(ticket.channelId);
    await (channel as TextChannel)?.delete().catch(() => {});
  }, 5000);
}

// Handle the deny button click on a tag request
export async function handleTagDeny(
  interaction: import("discord.js").ButtonInteraction,
): Promise<void> {
  const allTickets = getTickets();
  const ticket = allTickets[interaction.channelId];

  if (!ticket) {
    await interaction.reply({ content: "can't find this ticket.", ephemeral: true });
    return;
  }

  const member = interaction.member as import("discord.js").GuildMember | null;
  if (!canManageTags(member, interaction.guild!.id)) {
    await interaction.reply({
      content: "you don't have permission to deny tag requests.",
      ephemeral: true,
    });
    return;
  }

  ticket.status = "denied";
  ticket.closedAt = Date.now();
  ticket.closedBy = interaction.user.username;
  ticket.closedById = interaction.user.id;
  setTicket(ticket.channelId, ticket);

  await interaction.reply({
    embeds: [
      {
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
        timestamp: getTimestamp(),
      },
    ],
    components: [],
  });

  await logTicket(
    interaction.guild!.id,
    "Tag Denied",
    `<@${interaction.user.id}> denied the tag request for <@${ticket.userId}>`,
    [
      { name: "Roblox", value: ticket.robloxUsername ?? "unknown", inline: true },
      { name: "Tag", value: ticket.requestedTag ?? "unknown", inline: true },
    ],
  );

  setTimeout(async () => {
    await sendTagLog(interaction.client, interaction.guild!, ticket);
    await postCloseLog(interaction.client, interaction.guild!, ticket);
    deleteTicket(ticket.channelId);
    const channel = interaction.guild?.channels.cache.get(ticket.channelId);
    await (channel as TextChannel)?.delete().catch(() => {});
  }, 4000);
}

// Close a ticket and delete the channel
export async function closeTicket(
  interaction: import("discord.js").ButtonInteraction,
  ticket: TicketData,
  reason: string | null,
) {
  await postCloseLog(interaction.client, interaction.guild!, ticket);
  deleteTicket(ticket.channelId);
  const channel = interaction.guild?.channels.cache.get(ticket.channelId);
  await (channel as TextChannel)?.delete().catch(() => {});
}

// Close a ticket using a text message command
export async function closeTicketByMessage(message: import("discord.js").Message): Promise<void> {
  const allTickets = getTickets();
  const ticket = allTickets[message.channelId];

  if (!ticket) {
    await message.reply("this channel isn't an active ticket.");
    return;
  }

  ticket.status = ticket.status === "open" ? "closed" : ticket.status;
  ticket.closedAt = Date.now();
  ticket.closedBy = message.author.username;
  ticket.closedById = message.author.id;
  setTicket(ticket.channelId, ticket);

  await message.reply("closing ticket...");
  await postCloseLog(message.client, message.guild!, ticket);
  deleteTicket(ticket.channelId);

  setTimeout(async () => {
    const channel = message.guild?.channels.cache.get(ticket.channelId);
    await (channel as TextChannel)?.delete().catch(() => {});
  }, 2000);
}

// Handle tag manager typing approve/deny in the ticket channel
export async function handleTagManagerMessage(message: Message) {
  if (!message.guild) return;

  const guildId = message.guild.id;
  const allTickets = getTickets();
  const ticket = allTickets[message.channelId];

  if (!ticket || ticket.type !== "tag" || ticket.status !== "open") return;

  const isAdmin = message.member?.permissions.has(PermissionFlagsBits.Administrator);
  const isTagManager = message.member ? memberHasTagManagerRole(message.member, guildId) : false;

  if (!isAdmin && !isTagManager) return;

  const approveWords = ["approved", "yes", "approve"];
  const denyWords = ["no", "deny", "denied"];
  const messageText = message.content.toLowerCase().trim();
  const isApprove = approveWords.includes(messageText);
  const isDeny = denyWords.includes(messageText);

  if (!isApprove && !isDeny) return;

  const tag = ticket.requestedTag ?? "no tag";
  const robloxUsername = ticket.robloxUsername ?? "";

  addTicketMessage(message.channelId, {
    author: message.author.username,
    authorId: message.author.id,
    content: message.content,
    timestamp: Date.now(),
  });

  if (isApprove) {
    ticket.status = "approved";
    ticket.closedAt = Date.now();
    ticket.closedBy = message.author.username;
    ticket.closedById = message.author.id;
    ticket.approvedBy = message.author.username;
    ticket.approvedById = message.author.id;

    let robloxNote = "";
    if (robloxUsername && tag !== "no tag") {
      const result = await giveRobloxTagRole(robloxUsername, tag);
      if (result.ok) {
        robloxNote = `roblox role **${tag}** given to \`${robloxUsername}\``;
      } else {
        robloxNote = `roblox role failed: ${result.reason}`;
      }
    }

    const descriptionLines = [`tag \`${tag}\` approved for **${robloxUsername}** by <@${message.author.id}>.`];
    if (robloxNote) descriptionLines.push(robloxNote);

    await (message.channel as TextChannel).send({
      embeds: [
        {
          color: WHITE,
          description: descriptionLines.join("\n"),
          timestamp: getTimestamp(),
        },
      ],
    });

    setTicket(ticket.channelId, ticket);

    await logTicket(guildId, "Tag Approved (Text)", `<@${message.author.id}> approved tag \`${tag}\` by typing`, [
      { name: "Roblox", value: robloxUsername, inline: true },
    ]);

    await sendTagLog(message.client, message.guild!, ticket);
  } else {
    ticket.status = "denied";
    ticket.closedAt = Date.now();
    ticket.closedBy = message.author.username;
    ticket.closedById = message.author.id;
    setTicket(ticket.channelId, ticket);

    await kickDeniedUser(ticket.robloxUsername ?? "", ticket.requestedTag ?? "");

    await (message.channel as TextChannel).send({
      embeds: [
        {
          color: WHITE,
          description: `tag request denied by <@${message.author.id}>.`,
          timestamp: getTimestamp(),
        },
      ],
    });

    await logTicket(guildId, "Tag Denied (Text)", `<@${message.author.id}> denied a tag request by typing`);
    await sendTagLog(message.client, message.guild!, ticket);
  }

  setTimeout(async () => {
    await postCloseLog(message.client, message.guild!, ticket);
    deleteTicket(ticket.channelId);
    const channel = message.guild?.channels.cache.get(ticket.channelId);
    await (channel as TextChannel)?.delete().catch(() => {});
  }, 3000);
}

// Run a group check on a roblox user when a verification ticket is opened
async function runGroupCheck(
  channel: TextChannel,
  robloxUsername: string,
  guildId: string,
  client: Client,
) {
  const settings = getGuild(guildId);
  const flaggedGroups = settings.flaggedGroups ?? [];
  const requiredGroupId = settings.groupId ?? "703716156";

  const user = await getUserByUsername(robloxUsername).catch(() => null);
  if (!user) {
    await channel.send({
      embeds: [
        {
          color: RED,
          description: `couldn't find **${robloxUsername}** on roblox.`,
          timestamp: getTimestamp(),
        },
      ],
    });
    return;
  }

  const userGroups = await getUserGroups(user.id).catch(() => []) as Array<{ group: { id: number; name: string } }>;
  const isInMainGroup = await isInGroup(user.id, requiredGroupId).catch(() => false);
  const flaggedHits = userGroups.filter((entry) => flaggedGroups.includes(String(entry.group.id)));

  const allClear = isInMainGroup && flaggedHits.length === 0;
  const statusColor = allClear ? GREEN : RED;

  const groupListLines =
    userGroups.length > 0
      ? userGroups.map((entry) => `• [${entry.group.name}](https://www.roblox.com/groups/${entry.group.id})`)
      : ["• none"];

  const groupListText = groupListLines.join("\n");

  const embeds: object[] = [
    {
      color: statusColor,
      description: `**${user.name}**\n\n**groups**\n${groupListText}`,
      footer: { text: client.user?.username ?? "bot" },
      timestamp: getTimestamp(),
    },
  ];

  if (flaggedHits.length > 0) {
    const flaggedLines = flaggedHits
      .map((entry) => `• [${entry.group.name}](https://www.roblox.com/groups/${entry.group.id})`)
      .join("\n");

    embeds.push({
      color: RED,
      description: `**${user.name}** is in flagged groups — ask them to leave:\n\n${flaggedLines}`,
      timestamp: getTimestamp(),
    });
  }

  const groupLink = `https://www.roblox.com/communities/${requiredGroupId}`;

  if (isInMainGroup) {
    embeds.push({
      color: statusColor,
      description: `**${user.name}** is in the main group and good to verify\n\n**group id:** \`${requiredGroupId}\`\n**link:** [join here](${groupLink})`,
      timestamp: getTimestamp(),
    });
  } else {
    embeds.push({
      color: statusColor,
      description: `**${user.name}** is not in the main group\n\n**group id:** \`${requiredGroupId}\`\n**link:** [join here](${groupLink})`,
      timestamp: getTimestamp(),
    });
  }

  await channel.send({ embeds });
}

// Send a tag approval/denial log to the tag log channel
async function sendTagLog(client: Client, guild: Guild, ticket: TicketData) {
  const settings = getGuild(guild.id);
  const logChannelId = settings.tagLogChannel ?? settings.logChannel;
  if (!logChannelId) return;

  const logChannel = guild.channels.cache.get(logChannelId) as TextChannel | undefined;
  if (!logChannel) return;

  const avatarUrl = await getDiscordAvatar(guild, ticket.userId);
  const transcript = generateTranscript(ticket);

  const embedTitle = ticket.status === "approved" ? "Tag Approved" : "Tag Denied";

  const descriptionLines = [
    `**User:** <@${ticket.userId}>`,
    `**User ID:** \`${ticket.userId}\``,
    `**Roblox:** \`${ticket.robloxUsername ?? "unknown"}\``,
    `**Tag:** \`${ticket.requestedTag ?? "?"}\``,
  ];

  if (ticket.approvedBy) {
    descriptionLines.push(`**Approved By:** ${ticket.approvedBy}`);
  }
  if (ticket.closedBy && ticket.status === "denied") {
    descriptionLines.push(`**Denied By:** ${ticket.closedBy}`);
  }

  const embed: Record<string, unknown> = {
    color: WHITE,
    title: embedTitle,
    description: descriptionLines.join("\n"),
    timestamp: getTimestamp(),
  };

  if (avatarUrl) {
    embed["thumbnail"] = { url: avatarUrl };
  }

  await logChannel
    .send({
      embeds: [embed],
      files: [{ attachment: transcript, name: `tag-transcript-${ticket.channelId}.html` }],
    })
    .catch(() => {});
}

// Show the raid point request modal
export async function showRaidPointModal(interaction: Interaction): Promise<void> {
  if (!("showModal" in interaction)) return;

  const buttonInteraction = interaction as import("discord.js").ButtonInteraction;

  const modal = new ModalBuilder()
    .setCustomId("raid_point_modal")
    .setTitle("Raid Point Request");

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

  await buttonInteraction.showModal(modal);
}

// Open a private raid point review channel
export async function openRaidPointTicket(
  interaction: import("discord.js").ModalSubmitInteraction,
  guild: Guild,
  robloxUsername: string,
  proofUrl: string,
): Promise<void> {
  const guildId = guild.id;
  const settings = getGuild(guildId);

  const openTickets = getTickets();
  const existingTicket = Object.values(openTickets).find(
    (ticket) =>
      ticket.userId === interaction.user.id &&
      ticket.guildId === guildId &&
      ticket.type === "raidpoint",
  );

  if (existingTicket) {
    const existingChannel = guild.channels.cache.get(existingTicket.channelId);
    if (existingChannel) {
      await interaction.editReply({ content: `you already have a request open: <#${existingChannel.id}>` });
      return;
    }
  }

  const channelPermissions: import("discord.js").OverwriteResolvable[] = [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: interaction.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
  ];

  if (settings.pointsSupportRole && guild.roles.cache.has(settings.pointsSupportRole)) {
    channelPermissions.push({
      id: settings.pointsSupportRole,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    });
  }

  if (settings.pointsRole && guild.roles.cache.has(settings.pointsRole)) {
    channelPermissions.push({
      id: settings.pointsRole,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    });
  }

  const ticketChannel = (await guild.channels.create({
    name: `raid-${interaction.user.username}`,
    type: ChannelType.GuildText,
    permissionOverwrites: channelPermissions,
  })) as TextChannel;

  const approveButton = new ButtonBuilder()
    .setCustomId("raid_approve")
    .setLabel("Approve")
    .setStyle(ButtonStyle.Success);

  const denyButton = new ButtonBuilder()
    .setCustomId("raid_deny")
    .setLabel("Deny")
    .setStyle(ButtonStyle.Danger);

  const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(approveButton, denyButton);

  const pingParts: string[] = [`<@${interaction.user.id}>`];
  if (settings.pointsSupportRole) pingParts.push(`<@&${settings.pointsSupportRole}>`);
  if (settings.pointsRole) pingParts.push(`<@&${settings.pointsRole}>`);

  await ticketChannel.send({
    content: pingParts.join(" "),
    embeds: [
      {
        color: WHITE,
        title: "Raid Point Request",
        description: [
          `**Submitted By:** <@${interaction.user.id}> (${interaction.user.username})`,
          `**Roblox Username:** \`${robloxUsername}\``,
          `**Proof:** ${proofUrl}`,
        ].join("\n"),
        footer: { text: "review the proof and approve or deny accordingly" },
        timestamp: getTimestamp(),
      },
    ],
    components: [buttonRow],
  });

  const ticketData: TicketData = {
    channelId: ticketChannel.id,
    userId: interaction.user.id,
    guildId,
    type: "raidpoint",
    robloxUsername,
    proofUrl,
    messageId: undefined,
    messages: [
      {
        author: "System",
        authorId: "0",
        content: `Raid point request by ${interaction.user.username} — roblox: ${robloxUsername}`,
        timestamp: Date.now(),
      },
    ],
    openedAt: Date.now(),
    status: "open",
  };
  setTicket(ticketChannel.id, ticketData);

  await interaction.editReply({ content: `your request has been submitted: <#${ticketChannel.id}>` });
}

// Handle the approve button on a raid point request
export async function handleRaidApprove(
  interaction: import("discord.js").ButtonInteraction,
): Promise<void> {
  const allTickets = getTickets();
  const ticket = allTickets[interaction.channelId];

  if (!ticket) {
    await interaction.reply({ content: "couldn't find this request.", ephemeral: true });
    return;
  }

  const member = interaction.member as import("discord.js").GuildMember | null;
  const guildId = interaction.guild!.id;
  const settings = getGuild(guildId);

  const isOwner = OWNER_IDS.has(interaction.user.id);
  const hasPSR = !!settings.pointsSupportRole && !!member?.roles.cache.has(settings.pointsSupportRole);
  const hasPR = !!settings.pointsRole && !!member?.roles.cache.has(settings.pointsRole);
  const isAdmin = !!member?.permissions.has(PermissionFlagsBits.Administrator);

  if (!isOwner && !hasPSR && !hasPR && !isAdmin) {
    await interaction.reply({
      content: "you don't have permission to approve raid point requests.",
      ephemeral: true,
    });
    return;
  }

  const points = getPoints(guildId);
  points[ticket.userId] = (points[ticket.userId] ?? 0) + 1;
  savePoints(guildId, points);

  ticket.status = "approved";
  ticket.closedAt = Date.now();
  ticket.closedBy = interaction.user.username;
  ticket.closedById = interaction.user.id;
  setTicket(ticket.channelId, ticket);

  const newTotal = points[ticket.userId] ?? 0;
  const pointLabel = newTotal !== 1 ? "pts" : "pt";

  await interaction.reply({
    embeds: [
      {
        color: WHITE,
        description: [
          `raid point approved for <@${ticket.userId}>.`,
          `current total: **${newTotal}** ${pointLabel}`,
          `approved by <@${interaction.user.id}>`,
        ].join("\n"),
        timestamp: getTimestamp(),
      },
    ],
  });

  refreshLeaderboard(interaction.client, guildId).catch(() => {});

  setTimeout(async () => {
    deleteTicket(ticket.channelId);
    const channel = interaction.guild?.channels.cache.get(ticket.channelId);
    await (channel as TextChannel)?.delete().catch(() => {});
  }, 4000);
}

// Handle the deny button on a raid point request
export async function handleRaidDeny(
  interaction: import("discord.js").ButtonInteraction,
): Promise<void> {
  const allTickets = getTickets();
  const ticket = allTickets[interaction.channelId];

  if (!ticket) {
    await interaction.reply({ content: "couldn't find this request.", ephemeral: true });
    return;
  }

  const member = interaction.member as import("discord.js").GuildMember | null;
  const guildId = interaction.guild!.id;
  const settings = getGuild(guildId);

  const isOwner = OWNER_IDS.has(interaction.user.id);
  const hasPSR = !!settings.pointsSupportRole && !!member?.roles.cache.has(settings.pointsSupportRole);
  const hasPR = !!settings.pointsRole && !!member?.roles.cache.has(settings.pointsRole);
  const isAdmin = !!member?.permissions.has(PermissionFlagsBits.Administrator);

  if (!isOwner && !hasPSR && !hasPR && !isAdmin) {
    await interaction.reply({
      content: "you don't have permission to deny raid point requests.",
      ephemeral: true,
    });
    return;
  }

  ticket.status = "denied";
  ticket.closedAt = Date.now();
  ticket.closedBy = interaction.user.username;
  ticket.closedById = interaction.user.id;
  setTicket(ticket.channelId, ticket);

  await interaction.reply({
    embeds: [
      {
        color: WHITE,
        description: `raid point request denied by <@${interaction.user.id}>.`,
        timestamp: getTimestamp(),
      },
    ],
  });

  setTimeout(async () => {
    deleteTicket(ticket.channelId);
    const channel = interaction.guild?.channels.cache.get(ticket.channelId);
    await (channel as TextChannel)?.delete().catch(() => {});
  }, 4000);
}

// Send the ticket closed log to the log channel
async function postCloseLog(client: Client, guild: Guild, ticket: TicketData) {
  const settings = getGuild(guild.id);
  const logChannelId = settings.logChannel;

  if (!logChannelId) return;

  const logChannel = guild.channels.cache.get(logChannelId) as TextChannel | undefined;
  if (!logChannel) return;

  const avatarUrl = await getDiscordAvatar(guild, ticket.userId);
  const transcript = generateTranscript(ticket);

  const descriptionLines = [
    `**User:** <@${ticket.userId}>`,
    `**User ID:** \`${ticket.userId}\``,
    `**Type:** ${ticket.type}`,
  ];

  if (ticket.robloxUsername) descriptionLines.push(`**Roblox:** \`${ticket.robloxUsername}\``);
  if (ticket.requestedTag) descriptionLines.push(`**Tag:** \`${ticket.requestedTag}\``);
  descriptionLines.push(`**Status:** ${ticket.status ?? "closed"}`);
  if (ticket.closedBy) descriptionLines.push(`**Closed By:** ${ticket.closedBy}`);

  const embed: Record<string, unknown> = {
    color: WHITE,
    title: "Ticket Closed",
    description: descriptionLines.join("\n"),
    timestamp: getTimestamp(),
  };

  if (avatarUrl) {
    embed["thumbnail"] = { url: avatarUrl };
  }

  await logChannel
    .send({
      embeds: [embed],
      files: [{ attachment: transcript, name: `transcript-${ticket.channelId}.html` }],
    })
    .catch(() => {});
}
