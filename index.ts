import { Client, GatewayIntentBits, Partials } from "discord.js";
import { registerReady } from "./events/ready.js";
import { registerInteractionCreate } from "./events/interactionCreate.js";
import { registerMessageCreate } from "./events/messageCreate.js";
import { initLogger } from "./utils/botLogger.js";

export async function startBot() {
  const token = process.env["DISCORD_BOT_TOKEN"];
  if (!token) {
    console.warn("no token found, not starting");
    return;
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel, Partials.Message],
  });

  client.once("clientReady", () => initLogger(client));

  registerReady(client);
  registerInteractionCreate(client);
  registerMessageCreate(client);

  await client.login(token);
}

startBot().catch(console.error);
