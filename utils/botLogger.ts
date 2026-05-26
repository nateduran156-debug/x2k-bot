import type { Client, TextChannel } from "discord.js";
import { getGuild } from "./storage.js";

let _client: Client | null = null;

export function initLogger(client: Client): void {
  _client = client;
}

export type LogLevel = "info" | "warn" | "error" | "command" | "ticket" | "points" | "setup";

export interface BotLogField {
  name: string;
  value: string;
  inline?: boolean;
}

export async function botLog(
  guildId: string,
  level: LogLevel,
  title: string,
  description: string,
  fields?: BotLogField[],
): Promise<void> {
  if (!_client) return;
  try {
    const settings = getGuild(guildId);
    if (!settings.botLogChannel) return;

    const guild = _client.guilds.cache.get(guildId);
    if (!guild) return;

    const ch = guild.channels.cache.get(settings.botLogChannel) as TextChannel | undefined;
    if (!ch) return;

    await ch.send({
      embeds: [{
        color: 0xffffff,
        title,
        description,
        fields: fields ?? [],
        footer: { text: `/curek • ${level}` },
        timestamp: new Date().toISOString(),
      }],
    });
  } catch {
    // dont let logging crash anything
  }
}

export const logInfo    = (g: string, t: string, d: string, f?: BotLogField[]) => botLog(g, "info",    t, d, f);
export const logWarn    = (g: string, t: string, d: string, f?: BotLogField[]) => botLog(g, "warn",    t, d, f);
export const logError   = (g: string, t: string, d: string, f?: BotLogField[]) => botLog(g, "error",   t, d, f);
export const logCommand = (g: string, t: string, d: string, f?: BotLogField[]) => botLog(g, "command", t, d, f);
export const logTicket  = (g: string, t: string, d: string, f?: BotLogField[]) => botLog(g, "ticket",  t, d, f);
export const logPoints  = (g: string, t: string, d: string, f?: BotLogField[]) => botLog(g, "points",  t, d, f);
export const logSetup   = (g: string, t: string, d: string, f?: BotLogField[]) => botLog(g, "setup",   t, d, f);
