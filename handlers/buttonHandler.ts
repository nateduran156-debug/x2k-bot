import { PermissionFlagsBits, type Interaction } from "discord.js";
import { getTickets, setVerified, getGuild, memberHasVerificationManagerRole } from "../utils/storage.js";
import { getUserByUsername, isInGroup } from "../utils/roblox.js";
import {
  showVerificationModal, openVerificationTicket,
  openTagChannel, handleInChannelTagSelect, postTagReviewEmbed,
  handleTagApprove, handleTagDeny, closeTicket,
  showRaidPointModal, openRaidPointTicket, handleRaidApprove, handleRaidDeny,
} from "./ticketHandler.js";
import { buildHelpMessage } from "../utils/help.js";

export async function handleButton(interaction: Interaction) {
  const customId = "customId" in interaction ? (interaction as { customId: string }).customId : "";

  // modal submits
  if (interaction.isModalSubmit()) {
    const i = interaction as import("discord.js").ModalSubmitInteraction;

    if (customId === "verification_username_modal") {
      const robloxUsername = i.fields.getTextInputValue("roblox_username").trim();
      if (!robloxUsername) return i.reply({ content: "please enter a roblox username.", ephemeral: true });
      await i.deferReply({ ephemeral: true });
      return openVerificationTicket(i, i.guild!, robloxUsername);
    }

    if (customId === "raid_point_modal") {
      const robloxUsername = i.fields.getTextInputValue("roblox_username").trim();
      const proofUrl       = i.fields.getTextInputValue("proof_url").trim();
      if (!robloxUsername) return i.reply({ content: "please enter your roblox username.", ephemeral: true });
      if (!proofUrl)       return i.reply({ content: "please provide a screenshot url.", ephemeral: true });
      await i.deferReply({ ephemeral: true });
      return openRaidPointTicket(i, i.guild!, robloxUsername, proofUrl);
    }

    if (customId.startsWith("tag_ticket_modal::")) {
      const tag            = customId.slice("tag_ticket_modal::".length);
      const robloxUsername = i.fields.getTextInputValue("roblox_username").trim();
      if (!robloxUsername) return i.reply({ content: "please enter a roblox username.", ephemeral: true });
      return postTagReviewEmbed(i, tag, robloxUsername);
    }
    return;
  }

  // select menus
  if (interaction.isStringSelectMenu()) {
    const i = interaction as import("discord.js").StringSelectMenuInteraction;

    if (customId === "help_category") {
      const category = i.values[0] ?? "setup";
      return i.update(buildHelpMessage(category) as Parameters<typeof i.update>[0]).catch(() => {});
    }

    if (customId === "ticket_select") {
      const value = i.values[0];
      if (value === "verification") return showVerificationModal(i);
      if (value === "tag")          return openTagChannel(i);
      return;
    }

    if (customId === "in_channel_tag_select") return handleInChannelTagSelect(i);
    return;
  }

  // regular buttons
  if (interaction.isButton()) {
    const i = interaction as import("discord.js").ButtonInteraction;

    if (customId === "open_ticket_verification") return showVerificationModal(i);
    if (customId === "open_ticket_tag")          return openTagChannel(i);
    if (customId === "ticket_tag_approve")       return handleTagApprove(i);
    if (customId === "ticket_tag_deny")          return handleTagDeny(i);
    if (customId === "raid_point_request")       return showRaidPointModal(i);
    if (customId === "raid_approve")             return handleRaidApprove(i);
    if (customId === "raid_deny")                return handleRaidDeny(i);

    if (customId === "resetall_confirm" || customId === "resetall_cancel") return;

    const tickets = getTickets();
    const ticket  = tickets[i.channelId];

    if (customId === "ticket_close") {
      if (!ticket) return i.reply({ content: "couldn't find a ticket for this channel.", ephemeral: true });
      const clicker = i.member as import("discord.js").GuildMember | null;
      const isVMR = clicker && memberHasVerificationManagerRole(clicker, i.guild!.id);
      if (!isVMR) return i.reply({ content: "you don't have permission to close tickets.", ephemeral: true });
      await i.deferReply();
      return closeTicket(i, ticket, null);
    }

    if (customId === "ticket_kick") {
      if (!ticket) return i.reply({ content: "couldn't find a ticket for this channel.", ephemeral: true });
      const clicker = i.member as import("discord.js").GuildMember | null;
      const isVMR = clicker && memberHasVerificationManagerRole(clicker, i.guild!.id);
      if (!isVMR) return i.reply({ content: "you don't have permission to kick from tickets.", ephemeral: true });
      const member = await i.guild?.members.fetch(ticket.userId).catch(() => null);
      if (member) await member.kick("Removed from ticket").catch(() => {});
      return i.reply({ content: `kicked <@${ticket.userId}>.` });
    }

    if (customId === "ticket_verify") {
      if (!ticket) return i.reply({ content: "couldn't find a ticket for this channel.", ephemeral: true });
      const guild    = i.guild!;
      const settings = getGuild(guild.id);
      const clicker  = i.member as import("discord.js").GuildMember | null;
      const isVMR = clicker && memberHasVerificationManagerRole(clicker, guild.id);
      if (!isVMR) return i.reply({ content: "you don't have permission to verify members.", ephemeral: true });

      if (!settings.verificationRole) {
        return i.reply({ content: "no verification role set. run `.vset @role` first.", ephemeral: true });
      }

      const member = await guild.members.fetch(ticket.userId).catch(() => null);
      if (!member) return i.reply({ content: "that user left the server.", ephemeral: true });

      const requiredGroup = settings.groupId ?? "396910998";

      if (ticket.robloxUsername) {
        const robloxUser = await getUserByUsername(ticket.robloxUsername).catch(() => null);
        if (robloxUser) {
          const inGroup = await isInGroup(robloxUser.id, requiredGroup).catch(() => false);
          if (!inGroup) {
            return i.reply({
              content: `**${ticket.robloxUsername}** isn't in the required group. they need to [join](https://www.roblox.com/communities/${requiredGroup}) first.`,
              ephemeral: true,
            });
          }
        }
      }

      await member.roles.add(settings.verificationRole).catch(() => {});
      await member.roles.remove("1493486362165252177").catch(() => {});
      if (ticket.robloxUsername) setVerified(ticket.userId, ticket.robloxUsername);

      await i.reply({
        content: `verified <@${ticket.userId}>${ticket.robloxUsername ? ` as **${ticket.robloxUsername}**` : ""}.`,
      });

      return closeTicket(i, ticket, "User verified");
    }
  }
}
