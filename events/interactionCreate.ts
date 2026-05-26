import type { Client, Interaction } from "discord.js";
import { handleButton } from "../handlers/buttonHandler.js";
import { handleSlashCommand } from "../handlers/slashHandler.js";

export function registerInteractionCreate(client: Client) {
  client.on("interactionCreate", async (interaction: Interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        await handleSlashCommand(interaction);
        return;
      }
      await handleButton(interaction);
    } catch (err) {
      console.error("[interaction]", err);
      if ("reply" in interaction && typeof interaction.reply === "function") {
        const i = interaction as import("discord.js").CommandInteraction;
        if (i.replied || i.deferred) {
          await i.followUp({ content: "something went wrong, try again", ephemeral: true }).catch(() => {});
        } else {
          await i.reply({ content: "something went wrong, try again", ephemeral: true }).catch(() => {});
        }
      }
    }
  });
}
