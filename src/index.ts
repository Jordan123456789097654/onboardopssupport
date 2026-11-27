import { ChannelType, Client, Events, GatewayIntentBits, Partials, REST, Routes } from "discord.js";
import { runAutomod } from "./automod";
import { moderationCommands } from "./commands/moderation";
import { modmailCommands } from "./commands/modmail-cmds";
import { tagCommands } from "./commands/tags";
import type { Command } from "./commands/types";
import { utilityCommands } from "./commands/utility";
import { startWebServer } from "./web/server";
import {
  handleDirectMessage,
  handleModmailButton,
  handleModmailSelect,
  handleStaffThreadMessage,
  sweepDueTicketClosures,
} from "./modmail";
import { flushStore, getGuildConfig, initStore } from "./store";
import { tooFast } from "./util";

try {
  (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.(".env");
} catch {
  /* no .env file */
}

const TOKEN = process.env.DISCORD_TOKEN?.trim();
const CLIENT_ID = process.env.DISCORD_CLIENT_ID?.trim();
const DEV_GUILD_ID = process.env.DEV_GUILD_ID?.trim();

if (!TOKEN || !CLIENT_ID) {
  console.error("Set DISCORD_TOKEN and DISCORD_CLIENT_ID before starting the public bot.");
  process.exit(1);
}

const allCommands = new Map<string, Command>(
  [...moderationCommands, ...modmailCommands, ...tagCommands, ...utilityCommands].map((c) => [c.json.name, c]),
);

const storageMode = await initStore();
console.log(`Store initialized (${storageMode}).`);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User],
});

startWebServer(client);

client.once(Events.ClientReady, async (c) => {
  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);
    const body = [...allCommands.values()].map((x) => x.json);
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body });
    if (DEV_GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, DEV_GUILD_ID), { body });
    }
    console.log(`Ready as ${c.user.tag}. ${allCommands.size} global commands registered across ${c.guilds.cache.size} server(s).`);
    setInterval(() => void sweepDueTicketClosures(c).catch((e) => console.error("Sweep error:", e)), 30_000);
  } catch (e) {
    console.error("Failed to register slash commands:", e instanceof Error ? e.message : e);
  }
});

client.on(Events.MessageCreate, async (msg) => {
  try {
    if (msg.author.bot) return;
    if (msg.channel.type === ChannelType.DM) {
      await handleDirectMessage(client, msg);
      return;
    }
    if (msg.guild) {
      if (msg.channel.isThread()) {
        await handleStaffThreadMessage(client, msg);
      }
      await runAutomod(msg);
    }
  } catch (e) {
    console.error("MessageCreate error:", e instanceof Error ? e.message : e);
  }
});

client.on(Events.GuildMemberAdd, async (member) => {
  try {
    const cfg = getGuildConfig(member.guild.id);
    if (!cfg.autorole?.enabled || !cfg.autorole.roleIds?.length) return;
    for (const roleId of cfg.autorole.roleIds) {
      if (member.guild.roles.cache.has(roleId)) {
        await member.roles.add(roleId).catch((err) => {
          console.warn(`[Autorole] Could not add role ${roleId} to ${member.user.tag}:`, err?.message || err);
        });
      }
    }
  } catch (e) {
    console.error("GuildMemberAdd autorole error:", e instanceof Error ? e.message : e);
  }
});

client.on(Events.InteractionCreate, async (i) => {
  try {
    if (i.isAutocomplete()) {
      const cmd = allCommands.get(i.commandName);
      if (cmd?.autocomplete) await cmd.autocomplete(i);
      else await i.respond([]).catch(() => undefined);
      return;
    }
    if (i.isStringSelectMenu()) {
      if (i.customId.startsWith("mm:")) await handleModmailSelect(client, i);
      return;
    }
    if (i.isButton()) {
      if (i.customId.startsWith("mmbtn:")) await handleModmailButton(client, i);
      return;
    }
    if (!i.isChatInputCommand()) return;

    const cmd = allCommands.get(i.commandName);
    if (!cmd) return;

    if (tooFast(i.user.id)) {
      await i.reply({ content: "Slow down a little and try again.", ephemeral: true });
      return;
    }

    await cmd.run(i);
  } catch (e) {
    console.error("Interaction error:", e);
    const msg = e instanceof Error && e.message.includes("Missing Permissions")
      ? "I don't have the required Discord permissions to do that. Check my role permissions and hierarchy."
      : "Something went wrong while running that command.";
    if (i.isRepliable()) {
      if (i.replied || i.deferred) await i.followUp({ content: msg, ephemeral: true }).catch(() => undefined);
      else await i.reply({ content: msg, ephemeral: true }).catch(() => undefined);
    }
  }
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await flushStore();
    process.exit(0);
  });
}

process.on("unhandledRejection", (e) => console.error("Unhandled rejection:", e instanceof Error ? e.message : e));
client.login(TOKEN);
