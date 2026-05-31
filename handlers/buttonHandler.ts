import { PermissionFlagsBits, type Interaction } from "discord.js";
import {
  getTickets,
  setVerified,
  getGuild,
  memberHasVerificationManagerRole,
  getRegistered,
} from "../utils/storage.js";
import { getUserByUsername, isInGroup } from "../utils/roblox.js";
import { isQueueActive, addJoiner } from "../utils/queue.js";
import {
  showVerificationModal,
  openVerificationTicket,
  openTagChannel,
  handleInChannelTagSelect,
  postTagReviewEmbed,
  handleTagApprove,
  handleTagDeny,
  closeTicket,
  showRaidPointModal,
  openRaidPointTicket,
  handleRaidApprove,
  handleRaidDeny,
} from "./ticketHandler.js";
import { buildHelpMessage } from "../utils/help.js";

// Main handler for all button, select menu, and modal interactions
export async function handleButton(interaction: Interaction) {
  const customId =
    "customId" in interaction ? (interaction as { customId: string }).customId : "";

  // Handle modal submissions
  if (interaction.isModalSubmit()) {
    const modalInteraction = interaction as import("discord.js").ModalSubmitInteraction;

    if (customId === "verification_username_modal") {
      const robloxUsername = modalInteraction.fields
        .getTextInputValue("roblox_username")
        .trim();

      if (!robloxUsername) {
        return modalInteraction.reply({
          content: "please enter a roblox username.",
          ephemeral: true,
        });
      }

      await modalInteraction.deferReply({ ephemeral: true });
      return openVerificationTicket(modalInteraction, modalInteraction.guild!, robloxUsername);
    }

    if (customId === "raid_point_modal") {
      const robloxUsername = modalInteraction.fields
        .getTextInputValue("roblox_username")
        .trim();
      const proofUrl = modalInteraction.fields.getTextInputValue("proof_url").trim();

      if (!robloxUsername) {
        return modalInteraction.reply({
          content: "please enter your roblox username.",
          ephemeral: true,
        });
      }
      if (!proofUrl) {
        return modalInteraction.reply({
          content: "please provide a screenshot url.",
          ephemeral: true,
        });
      }

      await modalInteraction.deferReply({ ephemeral: true });
      return openRaidPointTicket(modalInteraction, modalInteraction.guild!, robloxUsername, proofUrl);
    }

    if (customId.startsWith("tag_ticket_modal::")) {
      const tag = customId.slice("tag_ticket_modal::".length);
      const robloxUsername = modalInteraction.fields
        .getTextInputValue("roblox_username")
        .trim();

      if (!robloxUsername) {
        return modalInteraction.reply({
          content: "please enter a roblox username.",
          ephemeral: true,
        });
      }

      return postTagReviewEmbed(modalInteraction, tag, robloxUsername);
    }

    return;
  }

  // Handle select menu interactions
  if (interaction.isStringSelectMenu()) {
    const selectInteraction = interaction as import("discord.js").StringSelectMenuInteraction;
    const selectedValue = selectInteraction.values[0] ?? "setup";

    if (customId === "help_category") {
      return selectInteraction
        .update(buildHelpMessage(selectedValue) as Parameters<typeof selectInteraction.update>[0])
        .catch(() => {});
    }

    if (customId === "ticket_select") {
      if (selectedValue === "verification") return showVerificationModal(selectInteraction);
      if (selectedValue === "tag") return openTagChannel(selectInteraction);
      return;
    }

    if (customId === "in_channel_tag_select") {
      return handleInChannelTagSelect(selectInteraction);
    }

    return;
  }

  // Handle regular button clicks
  if (interaction.isButton()) {
    const buttonInteraction = interaction as import("discord.js").ButtonInteraction;

    if (customId === "open_ticket_verification") return showVerificationModal(buttonInteraction);
    if (customId === "open_ticket_tag") return openTagChannel(buttonInteraction);
    if (customId === "ticket_tag_approve") return handleTagApprove(buttonInteraction);
    if (customId === "ticket_tag_deny") return handleTagDeny(buttonInteraction);
    if (customId === "raid_point_request") return showRaidPointModal(buttonInteraction);
    if (customId === "raid_approve") return handleRaidApprove(buttonInteraction);
    if (customId === "raid_deny") return handleRaidDeny(buttonInteraction);

    // Handle queue join button
    if (customId === "queue_join") {
      const guildId = buttonInteraction.guild?.id;
      if (!guildId) {
        return buttonInteraction.reply({ content: "couldn't find server.", ephemeral: true });
      }

      if (!isQueueActive(guildId)) {
        return buttonInteraction.reply({
          content: "the queue has already ended.",
          ephemeral: true,
        });
      }

      const registeredUsers = getRegistered();
      const robloxUsername = registeredUsers[buttonInteraction.user.id];
      const displayName = robloxUsername ?? buttonInteraction.user.username;
      const joinResult = addJoiner(guildId, buttonInteraction.user.id, displayName);

      if (joinResult === "already_in") {
        return buttonInteraction.reply({
          content: `you're already in the queue as **${displayName}**`,
          ephemeral: true,
        });
      }

      return buttonInteraction.reply({
        content: `you've been added to the queue as **${displayName}**`,
        ephemeral: true,
      });
    }

    if (customId === "resetall_confirm" || customId === "resetall_cancel") return;

    // Handle ticket action buttons (close, kick, verify)
    const allTickets = getTickets();
    const ticket = allTickets[buttonInteraction.channelId];

    if (customId === "ticket_close") {
      if (!ticket) {
        return buttonInteraction.reply({
          content: "couldn't find a ticket for this channel.",
          ephemeral: true,
        });
      }

      const clickedMember = buttonInteraction.member as import("discord.js").GuildMember | null;
      const hasPermission =
        clickedMember &&
        memberHasVerificationManagerRole(clickedMember, buttonInteraction.guild!.id);

      if (!hasPermission) {
        return buttonInteraction.reply({
          content: "you don't have permission to close tickets.",
          ephemeral: true,
        });
      }

      await buttonInteraction.deferReply();
      return closeTicket(buttonInteraction, ticket, null);
    }

    if (customId === "ticket_kick") {
      if (!ticket) {
        return buttonInteraction.reply({
          content: "couldn't find a ticket for this channel.",
          ephemeral: true,
        });
      }

      const clickedMember = buttonInteraction.member as import("discord.js").GuildMember | null;
      const hasPermission =
        clickedMember &&
        memberHasVerificationManagerRole(clickedMember, buttonInteraction.guild!.id);

      if (!hasPermission) {
        return buttonInteraction.reply({
          content: "you don't have permission to kick from tickets.",
          ephemeral: true,
        });
      }

      const targetMember = await buttonInteraction.guild?.members
        .fetch(ticket.userId)
        .catch(() => null);

      if (targetMember) {
        await targetMember.kick("Removed from ticket").catch(() => {});
      }

      return buttonInteraction.reply({ content: `kicked <@${ticket.userId}>.` });
    }

    if (customId === "ticket_verify") {
      if (!ticket) {
        return buttonInteraction.reply({
          content: "couldn't find a ticket for this channel.",
          ephemeral: true,
        });
      }

      const guild = buttonInteraction.guild!;
      const settings = getGuild(guild.id);
      const clickedMember = buttonInteraction.member as import("discord.js").GuildMember | null;
      const hasPermission =
        clickedMember && memberHasVerificationManagerRole(clickedMember, guild.id);

      if (!hasPermission) {
        return buttonInteraction.reply({
          content: "you don't have permission to verify members.",
          ephemeral: true,
        });
      }

      if (!settings.verificationRole) {
        return buttonInteraction.reply({
          content: "no verification role set. run `.vset @role` first.",
          ephemeral: true,
        });
      }

      const targetMember = await guild.members.fetch(ticket.userId).catch(() => null);
      if (!targetMember) {
        return buttonInteraction.reply({ content: "that user left the server.", ephemeral: true });
      }

      const requiredGroupId = settings.groupId ?? "703716156";

      // Check if they are in the required roblox group before verifying
      if (ticket.robloxUsername) {
        const robloxUser = await getUserByUsername(ticket.robloxUsername).catch(() => null);
        if (robloxUser) {
          const inGroup = await isInGroup(robloxUser.id, requiredGroupId).catch(() => false);
          if (!inGroup) {
            return buttonInteraction.reply({
              content: `**${ticket.robloxUsername}** isn't in the required group. they need to [join](https://www.roblox.com/communities/${requiredGroupId}) first.`,
              ephemeral: true,
            });
          }
        }
      }

      await targetMember.roles.add(settings.verificationRole).catch(() => {});
      await targetMember.roles.remove("1493486362165252177").catch(() => {});

      if (ticket.robloxUsername) {
        setVerified(ticket.userId, ticket.robloxUsername);
      }

      await buttonInteraction.reply({
        content: `verified <@${ticket.userId}>${ticket.robloxUsername ? ` as **${ticket.robloxUsername}**` : ""}.`,
      });

      return closeTicket(buttonInteraction, ticket, "User verified");
    }
  }
}
