import { ChannelType, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder, type TextChannel } from "discord.js";
import { DEFAULT_ALWAYS_ACCESS_ROLE_ID, parseDuration as parseDur, formatDuration as fmtDur } from "../util";
import { scheduleSave as saveTicket, type ScheduledReply } from "../store";
import { closeTicketNow, ensureCategoryChannels, openTicket, requestCloseFromCustomer, resolveTicketWithDelay, sendStaffReply, transferTicket } from "../modmail";
import {
  DEFAULT_CATEGORIES,
  getGuildConfig,
  getOpenTicketByThread,
  getOpenTicketByUser,
  scheduleSave,
} from "../store";
import { COLORS, isStaffMember, missingPermReply, parseDuration } from "../util";
import type { Command } from "./types";

const modmailConfig: Command = {
  json: new SlashCommandBuilder()
    .setName("modmail-config")
    .setDescription("Configure Modmail on this server without touching other channels or roles")
    .addSubcommand((s) =>
      s
        .setName("channel")
        .setDescription("Set the channel where Modmail ticket threads are opened")
        .addChannelOption((o) => o.setName("channel").setDescription("Inbox channel for Modmail threads").addChannelTypes(ChannelType.GuildText).setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName("setup")
        .setDescription("Create a Discord category and tickets channel for each Modmail category"),
    )
    .addSubcommand((s) =>
      s
        .setName("log-channel")
        .setDescription("Set (or clear) the channel for Modmail open/close logs & transcripts")
        .addChannelOption((o) => o.setName("channel").setDescription("Log channel (leave empty to turn off)").addChannelTypes(ChannelType.GuildText)),
    )
    .addSubcommand((s) =>
      s
        .setName("staff-role")
        .setDescription("Set (or clear) the default role allowed to manage Modmail & pinged on new tickets")
        .addRoleOption((o) => o.setName("role").setDescription("Staff role (leave empty to clear)")),
    )
    .addSubcommand((s) =>
      s
        .setName("brand")
        .setDescription("Customize the brand name and footer shown in user DMs")
        .addStringOption((o) => o.setName("name").setDescription("Brand name (defaults to server name)").setMaxLength(80))
        .addStringOption((o) => o.setName("footer").setDescription("Footer text (defaults to '<Brand> | Support')").setMaxLength(80)),
    )
    .addSubcommand((s) =>
      s
        .setName("options")
        .setDescription("Tune Modmail behavior")
        .addBooleanOption((o) => o.setName("auto_relay").setDescription("Relay regular staff messages in ticket threads automatically (default true)"))
        .addBooleanOption((o) => o.setName("anonymous").setDescription("Hide staff usernames in DM replies (default false)"))
        .addIntegerOption((o) => o.setName("close_delay_minutes").setDescription("Default delay for /resolve auto-close (default 120 = 2h)").setMinValue(5).setMaxValue(4320)),
    )
    .addSubcommand((s) => s.setName("view").setDescription("View current Modmail settings"))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .toJSON(),
  async run(i) {
    if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await missingPermReply(i, "Manage Server");
      return;
    }
    const cfg = getGuildConfig(i.guildId!);
    const sub = i.options.getSubcommand();

    if (sub === "channel") {
      const ch = i.options.getChannel("channel", true) as TextChannel;
      cfg.modmailChannelId = ch.id;
      scheduleSave();
      await i.reply({ content: `Modmail is now active in <#${ch.id}>. Users who DM the bot will see the category picker!`, ephemeral: true });
      return;
    }

    if (sub === "setup") {
      await i.deferReply({ ephemeral: true });
      const r = await ensureCategoryChannels(i.guild!, cfg);
      const lines = [
        r.created.length ? `Created or updated: ${r.created.join(", ")}` : "",
        r.ready.length ? `Already set up: ${r.ready.join(", ")}` : "",
        r.failed.length ? `Could not set up: ${r.failed.join(", ")}. Check that I have Manage Channels.` : "",
      ].filter(Boolean);
      await i.editReply(lines.join("\n") || "No Modmail categories to set up.");
      return;
    }

    if (sub === "log-channel") {
      const ch = i.options.getChannel("channel") as TextChannel | null;
      cfg.modmailLogChannelId = ch?.id ?? null;
      scheduleSave();
      await i.reply({ content: ch ? `Modmail logs & transcripts will go to <#${ch.id}>.` : "Modmail logging turned off.", ephemeral: true });
      return;
    }

    if (sub === "staff-role") {
      const role = i.options.getRole("role");
      cfg.modmailStaffRoleId = role?.id ?? null;
      scheduleSave();
      await i.reply({ content: role ? `Modmail staff role set to <@&${role.id}>.` : "Default Modmail staff role cleared.", ephemeral: true });
      return;
    }

    if (sub === "brand") {
      const name = i.options.getString("name")?.trim();
      const footer = i.options.getString("footer")?.trim();
      if (name !== undefined) cfg.brandName = name || null;
      if (footer !== undefined) cfg.brandFooter = footer || null;
      scheduleSave();
      await i.reply({
        content: `Updated branding — Name: **${cfg.brandName ?? i.guild!.name}**, Footer: **${cfg.brandFooter ?? `${cfg.brandName ?? i.guild!.name} | Support`}**.`,
        ephemeral: true,
      });
      return;
    }

    if (sub === "options") {
      const autoRelay = i.options.getBoolean("auto_relay");
      const anon = i.options.getBoolean("anonymous");
      const delay = i.options.getInteger("close_delay_minutes");
      if (autoRelay !== null) cfg.autoRelayThreadMessages = autoRelay;
      if (anon !== null) cfg.anonymousStaff = anon;
      if (delay !== null) cfg.defaultCloseDelayMinutes = delay;
      scheduleSave();
      await i.reply({
        content: `Updated Modmail options: Auto-relay=${cfg.autoRelayThreadMessages}, Anonymous=${cfg.anonymousStaff}, Resolve delay=${cfg.defaultCloseDelayMinutes}m.`,
        ephemeral: true,
      });
      return;
    }

    await i.reply({
      ephemeral: true,
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.blue)
          .setTitle(`Modmail Settings — ${i.guild!.name}`)
          .addFields(
            { name: "Inbox Channel", value: cfg.modmailChannelId ? `<#${cfg.modmailChannelId}>` : "Not set (`/modmail-config channel`)", inline: true },
            { name: "Log Channel", value: cfg.modmailLogChannelId ? `<#${cfg.modmailLogChannelId}>` : "Off", inline: true },
            { name: "Staff Role", value: cfg.modmailStaffRoleId ? `<@&${cfg.modmailStaffRoleId}>` : "Mods (`Manage Messages`)", inline: true },
            { name: "Brand Name", value: cfg.brandName ?? i.guild!.name, inline: true },
            { name: "Footer", value: cfg.brandFooter ?? `${cfg.brandName ?? i.guild!.name} | Support`, inline: true },
            { name: "Auto-Relay Threads", value: cfg.autoRelayThreadMessages ? "On" : "Off", inline: true },
            { name: "Anonymous Staff", value: cfg.anonymousStaff ? "On" : "Off", inline: true },
            { name: "Resolve Delay", value: `${cfg.defaultCloseDelayMinutes} minutes`, inline: true },
            {
              name: `Categories (${cfg.modmailCategories.length})`,
              value: cfg.modmailCategories.map((c) => `${c.emoji} **${c.label}** (\`${c.id}\`)${c.staffRoleId ? ` → <@&${c.staffRoleId}>` : ""}`).join("\n"),
            },
          ),
      ],
    });
  },
};

const modmailCategory: Command = {
  json: new SlashCommandBuilder()
    .setName("modmail-category")
    .setDescription("Customize the DM dropdown categories for Modmail")
    .addSubcommand((s) =>
      s
        .setName("add")
        .setDescription("Add or update a Modmail category")
        .addStringOption((o) => o.setName("id").setDescription("Short ID (e.g. billing, bugs, careers)").setRequired(true).setMaxLength(24))
        .addStringOption((o) => o.setName("label").setDescription("Display name (e.g. Technical Help)").setRequired(true).setMaxLength(60))
        .addStringOption((o) => o.setName("description").setDescription("Short subtitle shown in dropdown").setRequired(true).setMaxLength(90))
        .addStringOption((o) => o.setName("emoji").setDescription("Emoji (e.g. 🔧)").setMaxLength(16))
        .addRoleOption((o) => o.setName("staff_role").setDescription("Optional role to ping when picked or transferred here")),
    )
    .addSubcommand((s) =>
      s
        .setName("remove")
        .setDescription("Remove a Modmail category")
        .addStringOption((o) => o.setName("id").setDescription("Category ID").setRequired(true).setAutocomplete(true)),
    )
    .addSubcommand((s) => s.setName("list").setDescription("List current Modmail categories"))
    .addSubcommand((s) => s.setName("reset").setDescription("Reset categories back to defaults"))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .toJSON(),
  async autocomplete(i) {
    if (!i.guildId) return i.respond([]);
    const q = i.options.getFocused().toLowerCase();
    const cats = getGuildConfig(i.guildId).modmailCategories;
    await i.respond(
      cats
        .filter((c) => c.id.includes(q) || c.label.toLowerCase().includes(q))
        .slice(0, 25)
        .map((c) => ({ name: `${c.emoji} ${c.label} (${c.id})`, value: c.id })),
    );
  },
  async run(i) {
    if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await missingPermReply(i, "Manage Server");
      return;
    }
    const cfg = getGuildConfig(i.guildId!);
    const sub = i.options.getSubcommand();

    if (sub === "list") {
      await i.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.blue)
            .setTitle("Modmail Dropdown Categories")
            .setDescription(
              cfg.modmailCategories
                .map((c) => `${c.emoji} **${c.label}** (\`${c.id}\`)\n*${c.description}*${c.staffRoleId ? ` • Role: <@&${c.staffRoleId}>` : ""}`)
                .join("\n\n"),
            ),
        ],
        ephemeral: true,
      });
      return;
    }

    if (sub === "reset") {
      cfg.modmailCategories = DEFAULT_CATEGORIES.map((c) => ({ ...c }));
      scheduleSave();
      await i.reply({ content: "Modmail categories reset to defaults.", ephemeral: true });
      return;
    }

    if (sub === "remove") {
      const id = i.options.getString("id", true).trim().toLowerCase();
      if (cfg.modmailCategories.length <= 1) {
        await i.reply({ content: "You must keep at least 1 category.", ephemeral: true });
        return;
      }
      const before = cfg.modmailCategories.length;
      cfg.modmailCategories = cfg.modmailCategories.filter((c) => c.id.toLowerCase() !== id);
      if (cfg.modmailCategories.length === before) {
        await i.reply({ content: `Category \`${id}\` not found.`, ephemeral: true });
        return;
      }
      scheduleSave();
      await i.reply({ content: `Removed category \`${id}\`.`, ephemeral: true });
      return;
    }

    const id = i.options.getString("id", true).trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (!id) {
      await i.reply({ content: "Category ID must contain letters or numbers.", ephemeral: true });
      return;
    }
    const label = i.options.getString("label", true).trim();
    const description = i.options.getString("description", true).trim();
    const emoji = i.options.getString("emoji")?.trim() || "💬";
    const staffRoleId = i.options.getRole("staff_role")?.id ?? null;

    const existingIdx = cfg.modmailCategories.findIndex((c) => c.id === id);
    const next = { id, label, description, emoji, staffRoleId };
    if (existingIdx >= 0) cfg.modmailCategories[existingIdx] = next;
    else {
      if (cfg.modmailCategories.length >= 25) {
        await i.reply({ content: "Discord allows at most 25 dropdown options.", ephemeral: true });
        return;
      }
      cfg.modmailCategories.push(next);
    }
    scheduleSave();
    await i.reply({ content: `Saved category ${emoji} **${label}** (\`${id}\`).`, ephemeral: true });
  },
};

function makeReplyCommand(name: "reply" | "r"): Command {
  return {
    json: new SlashCommandBuilder()
      .setName(name)
      .setDescription("Reply to the user in this Modmail ticket thread")
      .addStringOption((o) => o.setName("message").setDescription("Reply to send to the user's DM").setRequired(true).setMaxLength(3500))
      .addBooleanOption((o) => o.setName("anonymous").setDescription("Hide your username and send as Support Team"))
      .setDMPermission(false)
      .toJSON(),
    async run(i) {
      const member = await i.guild!.members.fetch(i.user.id).catch(() => null);
      if (!isStaffMember(member, i.guild!)) {
        await i.reply({ content: "Only staff can reply to Modmail tickets.", ephemeral: true });
        return;
      }
      const ticket = getOpenTicketByThread(i.channelId);
      if (!ticket) {
        await i.reply({ content: "Run this command inside an open Modmail ticket thread.", ephemeral: true });
        return;
      }
      await i.deferReply();
      const text = i.options.getString("message", true);
      const anon = i.options.getBoolean("anonymous") ?? getGuildConfig(i.guildId!).anonymousStaff;
      const ok = await sendStaffReply(i.client, i.guild!, ticket, i.user, text, [], anon);
      if (!ok) {
        await i.editReply("Could not send DM to the user (they may have DMs turned off).");
        return;
      }
      await i.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.green)
            .setAuthor({ name: anon ? `${i.user.username} (sent anonymously)` : i.user.username, iconURL: i.user.displayAvatarURL() })
            .setDescription(text)
            .setTimestamp(new Date()),
        ],
      });
    },
  };
}

const note: Command = {
  json: new SlashCommandBuilder()
    .setName("note")
    .setDescription("Post an internal staff note in this Modmail ticket (not sent to the user)")
    .addStringOption((o) => o.setName("text").setDescription("Internal note").setRequired(true).setMaxLength(2000))
    .setDMPermission(false)
    .toJSON(),
  async run(i) {
    const member = await i.guild!.members.fetch(i.user.id).catch(() => null);
    if (!isStaffMember(member, i.guild!)) {
      await i.reply({ content: "Only staff can add internal notes.", ephemeral: true });
      return;
    }
    const ticket = getOpenTicketByThread(i.channelId);
    if (!ticket) {
      await i.reply({ content: "Use this inside an open Modmail ticket thread.", ephemeral: true });
      return;
    }
    const text = i.options.getString("text", true);
    await i.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.amber)
          .setAuthor({ name: `Internal Note • ${i.user.username}`, iconURL: i.user.displayAvatarURL() })
          .setDescription(text)
          .setTimestamp(new Date()),
      ],
    });
  },
};

const claim: Command = {
  json: new SlashCommandBuilder().setName("claim").setDescription("Claim the current Modmail ticket").setDMPermission(false).toJSON(),
  async run(i) {
    const member = await i.guild!.members.fetch(i.user.id).catch(() => null);
    if (!isStaffMember(member, i.guild!)) {
      await i.reply({ content: "Only staff can claim tickets.", ephemeral: true });
      return;
    }
    const ticket = getOpenTicketByThread(i.channelId);
    if (!ticket) {
      await i.reply({ content: "Use this inside an open Modmail ticket thread.", ephemeral: true });
      return;
    }
    ticket.claimedById = i.user.id;
    scheduleSave();
    await i.reply({ content: `Ticket #${ticket.id} claimed by <@${i.user.id}>.` });
  },
};

const transfer: Command = {
  json: new SlashCommandBuilder()
    .setName("transfer")
    .setDescription("Transfer this Modmail ticket to another category, staff member, or role")
    .addStringOption((o) => o.setName("category").setDescription("Destination Modmail category").setAutocomplete(true))
    .addUserOption((o) => o.setName("staff").setDescription("Staff member to assign the ticket to"))
    .addRoleOption((o) => o.setName("role").setDescription("Department/team role to escalate & ping"))
    .addStringOption((o) => o.setName("reason").setDescription("Optional reason for transferring").setMaxLength(300))
    .addBooleanOption((o) => o.setName("notify_user").setDescription("Also notify the user in DM that their ticket was transferred"))
    .setDMPermission(false)
    .toJSON(),
  async autocomplete(i) {
    if (!i.guildId) return i.respond([]);
    const q = i.options.getFocused().toLowerCase();
    const cats = getGuildConfig(i.guildId).modmailCategories;
    await i.respond(
      cats
        .filter((c) => c.id.includes(q) || c.label.toLowerCase().includes(q))
        .slice(0, 25)
        .map((c) => ({ name: `${c.emoji} ${c.label}`, value: c.id })),
    );
  },
  async run(i) {
    const member = await i.guild!.members.fetch(i.user.id).catch(() => null);
    if (!isStaffMember(member, i.guild!)) {
      await i.reply({ content: "Only staff can transfer Modmail tickets.", ephemeral: true });
      return;
    }
    const ticket = getOpenTicketByThread(i.channelId);
    if (!ticket) {
      await i.reply({ content: "Use `/transfer` inside an open Modmail ticket thread.", ephemeral: true });
      return;
    }
    await i.deferReply({ ephemeral: true });
    const res = await transferTicket(i.guild!, ticket, {
      categoryId: i.options.getString("category"),
      staffUser: i.options.getUser("staff"),
      roleId: i.options.getRole("role")?.id ?? null,
      reason: i.options.getString("reason"),
      notifyUser: i.options.getBoolean("notify_user") ?? false,
      actor: i.user,
    });
    await i.editReply(res.message);
  },
};

const resolve: Command = {
  json: new SlashCommandBuilder()
    .setName("resolve")
    .setDescription("Send the resolved notice to the user and auto-close if they don't reply")
    .addStringOption((o) => o.setName("delay").setDescription("Auto-close delay (e.g. 30m, 2h, 1d — default 2h)"))
    .setDMPermission(false)
    .toJSON(),
  async run(i) {
    const member = await i.guild!.members.fetch(i.user.id).catch(() => null);
    if (!isStaffMember(member, i.guild!)) {
      await i.reply({ content: "Only staff can resolve tickets.", ephemeral: true });
      return;
    }
    const ticket = getOpenTicketByThread(i.channelId);
    if (!ticket) {
      await i.reply({ content: "Use `/resolve` inside an open Modmail ticket thread.", ephemeral: true });
      return;
    }
    const cfg = getGuildConfig(i.guildId!);
    const rawDelay = i.options.getString("delay");
    const delayMs = rawDelay ? parseDuration(rawDelay) : cfg.defaultCloseDelayMinutes * 60_000;
    if (!delayMs || delayMs < 60_000 || delayMs > 7 * 86_400_000) {
      await i.reply({ content: "Enter a valid delay between `1m` and `7d` (e.g. `30m`, `2h`, `1d`).", ephemeral: true });
      return;
    }
    await i.deferReply({ ephemeral: true });
    await resolveTicketWithDelay(i.client, i.guild!, ticket, i.user, delayMs);
    await i.editReply("Sent the resolved embed to the user's DM. Auto-close scheduled.");
  },
};

const close: Command = {
  json: new SlashCommandBuilder()
    .setName("close")
    .setDescription("Ask the customer to accept closing this ticket (or close it now with now:true)")
    .addStringOption((o) => o.setName("reason").setDescription("Optional closing note").setMaxLength(400))
    .addBooleanOption((o) => o.setName("now").setDescription("Close immediately without asking the customer"))
    .addBooleanOption((o) => o.setName("silent").setDescription("Close without sending a DM notice to the user"))
    .setDMPermission(false)
    .toJSON(),
  async run(i) {
    const member = await i.guild!.members.fetch(i.user.id).catch(() => null);
    if (!isStaffMember(member, i.guild!)) {
      await i.reply({ content: "Only staff can close tickets.", ephemeral: true });
      return;
    }
    const ticket = getOpenTicketByThread(i.channelId);
    if (!ticket) {
      await i.reply({ content: "Use `/close` inside an open Modmail ticket thread.", ephemeral: true });
      return;
    }
    await i.deferReply({ ephemeral: true });
    const reason = i.options.getString("reason");
    const silent = i.options.getBoolean("silent") ?? false;
    const now = i.options.getBoolean("now") ?? false;
    if (!now && !silent) {
      const asked = await requestCloseFromCustomer(i.client, i.guild!, ticket, i.user, reason);
      if (asked) {
        await i.editReply(`Asked the customer to accept closing ticket #${ticket.id}. They can Accept or Reject it.`);
        return;
      }
    }
    await closeTicketNow(i.client, i.guild!, ticket, i.user, { reason, silent });
    await i.editReply(`Ticket #${ticket.id} closed.`);
  },
};

const blacklist: Command = {
  json: new SlashCommandBuilder()
    .setName("blacklist")
    .setDescription("Block or unblock a user from opening Modmail tickets")
    .addSubcommand((s) =>
      s.setName("add").setDescription("Block a user").addUserOption((o) => o.setName("user").setDescription("User to block").setRequired(true)),
    )
    .addSubcommand((s) =>
      s.setName("remove").setDescription("Unblock a user").addUserOption((o) => o.setName("user").setDescription("User to unblock").setRequired(true)),
    )
    .addSubcommand((s) => s.setName("list").setDescription("List blocked users"))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false)
    .toJSON(),
  async run(i) {
    if (!i.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      await missingPermReply(i, "Manage Messages");
      return;
    }
    const cfg = getGuildConfig(i.guildId!);
    const sub = i.options.getSubcommand();
    if (sub === "list") {
      await i.reply({
        content: cfg.blacklistedUserIds.length
          ? cfg.blacklistedUserIds.map((id) => `• <@${id}> (\`${id}\`)`).join("\n")
          : "No users are blacklisted from Modmail.",
        ephemeral: true,
      });
      return;
    }
    const user = i.options.getUser("user", true);
    if (sub === "add") {
      if (!cfg.blacklistedUserIds.includes(user.id)) cfg.blacklistedUserIds.push(user.id);
      scheduleSave();
      await i.reply({ content: `<@${user.id}> can no longer open Modmail tickets here.`, ephemeral: true });
    } else {
      cfg.blacklistedUserIds = cfg.blacklistedUserIds.filter((id) => id !== user.id);
      scheduleSave();
      await i.reply({ content: `<@${user.id}> was removed from the Modmail blacklist.`, ephemeral: true });
    }
  },
};

const contact: Command = {
  json: new SlashCommandBuilder()
    .setName("contact")
    .setDescription("Open a new Modmail ticket with a member proactively")
    .addUserOption((o) => o.setName("user").setDescription("Member to contact").setRequired(true))
    .addStringOption((o) => o.setName("category").setDescription("Category").setAutocomplete(true))
    .addStringOption((o) => o.setName("message").setDescription("Optional opening message to send immediately").setMaxLength(1800))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false)
    .toJSON(),
  async autocomplete(i) {
    if (!i.guildId) return i.respond([]);
    const q = i.options.getFocused().toLowerCase();
    const cats = getGuildConfig(i.guildId).modmailCategories;
    await i.respond(
      cats
        .filter((c) => c.id.includes(q) || c.label.toLowerCase().includes(q))
        .slice(0, 25)
        .map((c) => ({ name: `${c.emoji} ${c.label}`, value: c.id })),
    );
  },
  async run(i) {
    const member = await i.guild!.members.fetch(i.user.id).catch(() => null);
    if (!isStaffMember(member, i.guild!)) {
      await i.reply({ content: "Only staff can open outbound Modmail tickets.", ephemeral: true });
      return;
    }
    const cfg = getGuildConfig(i.guildId!);
    if (!cfg.modmailChannelId) {
      await i.reply({ content: "Configure Modmail first with `/modmail-config channel`.", ephemeral: true });
      return;
    }
    const target = i.options.getUser("user", true);
    if (target.bot) {
      await i.reply({ content: "You can't open a Modmail ticket with a bot.", ephemeral: true });
      return;
    }
    const existing = getOpenTicketByUser(target.id, i.guildId!);
    if (existing) {
      await i.reply({ content: `<@${target.id}> already has an open ticket: <#${existing.threadId}>.`, ephemeral: true });
      return;
    }
    await i.deferReply({ ephemeral: true });
    const catId = i.options.getString("category");
    const cat = (catId ? cfg.modmailCategories.find((c) => c.id === catId) : undefined) ?? cfg.modmailCategories[0];
    const ticket = await openTicket(i.guild!, cfg, target, cat);
    if (!ticket) {
      await i.editReply("Failed to open ticket thread. Check the Modmail inbox channel permissions.");
      return;
    }
    const opening = i.options.getString("message")?.trim();
    if (opening) {
      await sendStaffReply(i.client, i.guild!, ticket, i.user, opening, [], cfg.anonymousStaff);
    }
    await i.editReply(`Opened Modmail ticket #${ticket.id} in <#${ticket.threadId}>.`);
  },
};

const onewayCommand: Command = {
  json: new SlashCommandBuilder()
    .setName("oneway")
    .setDescription("Turn one-way mode on or off. On: the customer can read this ticket but not reply.")
    .addBooleanOption((o) => o.setName("on").setDescription("true to turn it on, false to turn it off").setRequired(true))
    .setDMPermission(false)
    .toJSON(),
  async run(i) {
    const member = await i.guild!.members.fetch(i.user.id).catch(() => null);
    if (!isStaffMember(member, i.guild!)) {
      await i.reply({ content: "Only staff can change one-way mode.", ephemeral: true });
      return;
    }
    const ticket = getOpenTicketByThread(i.channelId);
    if (!ticket) {
      await i.reply({ content: "Use `/oneway` inside an open Modmail ticket thread.", ephemeral: true });
      return;
    }
    const on = i.options.getBoolean("on", true);
    ticket.oneway = on;
    saveTicket();
    await i.reply({ content: on ? "One-way mode is on. The customer can read this ticket but can't reply." : "One-way mode is off. The customer can reply again." });
  },
};

const snoozeCommand: Command = {
  json: new SlashCommandBuilder()
    .setName("snooze")
    .setDescription("Pause the stale and no-reply alerts on this ticket")
    .addStringOption((o) => o.setName("for").setDescription("How long, such as 30m, 2h or 1d. Use off to clear it.").setRequired(true).setMaxLength(12))
    .setDMPermission(false)
    .toJSON(),
  async run(i) {
    const member = await i.guild!.members.fetch(i.user.id).catch(() => null);
    if (!isStaffMember(member, i.guild!)) {
      await i.reply({ content: "Only staff can snooze tickets.", ephemeral: true });
      return;
    }
    const ticket = getOpenTicketByThread(i.channelId);
    if (!ticket) {
      await i.reply({ content: "Use `/snooze` inside an open Modmail ticket thread.", ephemeral: true });
      return;
    }
    const raw = i.options.getString("for", true).trim().toLowerCase();
    if (raw === "off") {
      ticket.snoozeUntil = null;
      saveTicket();
      await i.reply({ content: "Snooze cleared. Alerts are back on for this ticket." });
      return;
    }
    const ms = parseDur(raw);
    if (!ms) {
      await i.reply({ content: "Use something like `30m`, `2h` or `1d`.", ephemeral: true });
      return;
    }
    ticket.snoozeUntil = Date.now() + ms;
    saveTicket();
    await i.reply({ content: `Snoozed for ${fmtDur(ms)}. Alerts resume <t:${Math.floor(ticket.snoozeUntil / 1000)}:R>.` });
  },
};

const scheduleCommand: Command = {
  json: new SlashCommandBuilder()
    .setName("schedule")
    .setDescription("Queue a reply to the customer to send later")
    .addStringOption((o) => o.setName("when").setDescription("When to send it, such as 2h, 1d or 3d").setRequired(true).setMaxLength(12))
    .addStringOption((o) => o.setName("message").setDescription("What to send").setRequired(true).setMaxLength(1500))
    .setDMPermission(false)
    .toJSON(),
  async run(i) {
    const member = await i.guild!.members.fetch(i.user.id).catch(() => null);
    if (!isStaffMember(member, i.guild!)) {
      await i.reply({ content: "Only staff can schedule replies.", ephemeral: true });
      return;
    }
    const ticket = getOpenTicketByThread(i.channelId);
    if (!ticket) {
      await i.reply({ content: "Use `/schedule` inside an open Modmail ticket thread.", ephemeral: true });
      return;
    }
    const ms = parseDur(i.options.getString("when", true).trim().toLowerCase());
    if (!ms) {
      await i.reply({ content: "Use something like `2h`, `1d` or `3d`.", ephemeral: true });
      return;
    }
    const at = Date.now() + ms;
    const entry: ScheduledReply = {
      id: Math.random().toString(36).slice(2, 10),
      at,
      body: i.options.getString("message", true),
      staffId: i.user.id,
      staffName: i.user.username,
    };
    ticket.scheduled = [...(ticket.scheduled ?? []), entry].slice(-20);
    saveTicket();
    await i.reply({ content: `Queued. It goes to the customer <t:${Math.floor(at / 1000)}:f> (<t:${Math.floor(at / 1000)}:R>).`, ephemeral: true });
  },
};

const removeAccessCommand: Command = {
  json: new SlashCommandBuilder()
    .setName("remove")
    .setDescription("Take a role off the always-access list, so it no longer has staff access to tickets")
    .addRoleOption((o) => o.setName("role").setDescription("The role to remove").setRequired(true))
    .setDMPermission(false)
    .toJSON(),
  async run(i) {
    const member = await i.guild!.members.fetch(i.user.id).catch(() => null);
    if (!member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
      await missingPermReply(i, "Manage Server");
      return;
    }
    const role = i.options.getRole("role", true);
    const cfg = getGuildConfig(i.guildId!);
    const list = cfg.alwaysAccessRoleIds ?? [DEFAULT_ALWAYS_ACCESS_ROLE_ID];
    if (!list.includes(role.id)) {
      await i.reply({ content: `<@&${role.id}> isn't on the always-access list.`, ephemeral: true });
      return;
    }
    cfg.alwaysAccessRoleIds = list.filter((id) => id !== role.id);
    scheduleSave();
    await i.reply({ content: `<@&${role.id}> no longer has automatic access to tickets.`, ephemeral: true, allowedMentions: { parse: [] } });
  },
};

export const modmailCommands: Command[] = [
  modmailConfig,
  removeAccessCommand,
  onewayCommand,
  snoozeCommand,
  scheduleCommand,
  modmailCategory,
  makeReplyCommand("reply"),
  makeReplyCommand("r"),
  note,
  claim,
  transfer,
  resolve,
  close,
  blacklist,
  contact,
];
