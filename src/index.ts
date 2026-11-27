import { ActivityType, ChannelType, Client, Events, GatewayIntentBits, Partials, REST, Routes } from "discord.js";
import { runAutomod } from "./automod";
import { moderationCommands } from "./commands/moderation";
import { modmailCommands } from "./commands/modmail-cmds";
import { tagCommands } from "./commands/tags";
import type { Command } from "./commands/types";
import { utilityCommands } from "./commands/utility";
import { startWebServer } from "./web/server";
import { registerAuditLog } from "./audit-log";
import { registerModmailEvents } from "./modmail";
import { BUILTIN_TAGS } from "./builtin-tags";
import {
  handleDirectMessage,
  handleModmailButton,
  handleModmailSelect,
  handleStaffThreadMessage,
  ensureCategoryChannels,
  sweepDueTicketClosures,
  sweepSlaAndCloseWarnings,
} from "./modmail";
import { flushStore, getConfiguredModmailGuilds, getGuildConfig, getTag, initStore, migrateLegalCategory, upsertTag, type Tag } from "./store";
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
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildInvites,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User],
});

startWebServer(client);
registerAuditLog(client);
registerModmailEvents(client);

client.once(Events.ClientReady, async (c) => {
  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);
    const body = [...allCommands.values()].map((x) => x.json);
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body });
    if (DEV_GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, DEV_GUILD_ID), { body });
    }
    // Keep existing servers in line with the current categories (Legal Inquiries rename, channel names).
    for (const cfg of getConfiguredModmailGuilds()) {
      const guild = c.guilds.cache.get(cfg.guildId);
      if (!guild) continue;
      migrateLegalCategory(cfg);
      // Save the built-in tags for this server. Copies the bot saved earlier are refreshed to the current text.
      for (const b of BUILTIN_TAGS) {
        const saved = getTag(guild.id, b.name);
        // Keep anything a person created or edited. Refresh the copies this bot saved earlier.
        if (saved && saved.authorId !== c.user.id) continue;
        upsertTag({ guildId: guild.id, name: b.name, content: b.content, category: b.category, embed: false, authorId: c.user.id, uses: 0, createdAt: Date.now(), updatedAt: Date.now() } as unknown as Tag);
      }
      await ensureCategoryChannels(guild, cfg).catch((e) => console.error("Category setup failed:", e instanceof Error ? e.message : e));
    }
    // Status shown under the bot's name.
    c.user.setPresence({ status: "idle", activities: [{ name: "your DMs | Message me for support", type: ActivityType.Watching }] });
    console.log(`Ready as ${c.user.tag}. ${allCommands.size} global commands registered across ${c.guilds.cache.size} server(s).`);
    setInterval(() => void sweepDueTicketClosures(c).catch((e) => console.error("Sweep error:", e)), 30_000);
    setInterval(() => void sweepSlaAndCloseWarnings(c).catch((e) => console.error("SLA sweep error:", e)), 60_000);
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
