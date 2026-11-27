import {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type TextChannel,
} from "discord.js";
import { getGuildConfig, getUserActiveWarnings } from "../store";
import { COLORS, missingPermReply } from "../util";
import type { Command } from "./types";

const ping: Command = {
  json: new SlashCommandBuilder().setName("ping").setDescription("Check bot latency and uptime").toJSON(),
  async run(i) {
    const upSec = Math.floor(process.uptime());
    await i.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.green)
          .setTitle("Pong")
          .addFields(
            { name: "WebSocket", value: `${Math.round(i.client.ws.ping)} ms`, inline: true },
            { name: "Uptime", value: `${Math.floor(upSec / 3600)}h ${Math.floor((upSec % 3600) / 60)}m`, inline: true },
            { name: "Servers", value: String(i.client.guilds.cache.size), inline: true },
          ),
      ],
      ephemeral: true,
    });
  },
};

const whois: Command = {
  json: new SlashCommandBuilder()
    .setName("whois")
    .setDescription("Show member details, roles, join date, and warnings")
    .addUserOption((o) => o.setName("user").setDescription("Member to inspect (defaults to you)"))
    .setDMPermission(false)
    .toJSON(),
  async run(i) {
    const user = i.options.getUser("user") ?? i.user;
    const member = await i.guild!.members.fetch(user.id).catch(() => null);
    const roles = member
      ? [...member.roles.cache.values()]
          .filter((r) => r.id !== i.guildId)
          .sort((a, b) => b.position - a.position)
          .slice(0, 20)
          .map((r) => r.toString())
      : [];
    const warns = getUserActiveWarnings(i.guildId!, user.id).length;
    await i.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.blue)
          .setAuthor({ name: `${user.username} (${user.id})`, iconURL: user.displayAvatarURL() })
          .setThumbnail(user.displayAvatarURL({ size: 256 }))
          .addFields(
            { name: "Account Created", value: `<t:${Math.floor(user.createdTimestamp / 1000)}:F>\n(<t:${Math.floor(user.createdTimestamp / 1000)}:R>)`, inline: true },
            {
              name: "Joined Server",
              value: member?.joinedTimestamp
                ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>\n(<t:${Math.floor(member.joinedTimestamp / 1000)}:R>)`
                : "Not in server",
              inline: true,
            },
            { name: "Active Warnings", value: String(warns), inline: true },
            { name: `Roles (${roles.length})`, value: roles.length ? roles.join(" ") : "None" },
          ),
      ],
      ephemeral: true,
    });
  },
};

const serverinfo: Command = {
  json: new SlashCommandBuilder().setName("serverinfo").setDescription("Show server stats and configuration summary").setDMPermission(false).toJSON(),
  async run(i) {
    const g = i.guild!;
    const cfg = getGuildConfig(g.id);
    await i.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.blue)
          .setTitle(g.name)
          .setThumbnail(g.iconURL() ?? null)
          .addFields(
            { name: "Owner", value: `<@${g.ownerId}>`, inline: true },
            { name: "Members", value: String(g.memberCount), inline: true },
            { name: "Boost Tier", value: `Level ${g.premiumTier} (${g.premiumSubscriptionCount ?? 0} boosts)`, inline: true },
            { name: "Modmail", value: cfg.modmailChannelId ? `<#${cfg.modmailChannelId}>` : "Not configured", inline: true },
            { name: "Mod Logs", value: cfg.modLogChannelId ? `<#${cfg.modLogChannelId}>` : "Off", inline: true },
            { name: "AutoMod", value: cfg.automod.enabled ? "Enabled" : "Off", inline: true },
            { name: "Created", value: `<t:${Math.floor(g.createdTimestamp / 1000)}:D>`, inline: true },
          )
          .setFooter({ text: `Server ID: ${g.id}` }),
      ],
    });
  },
};

const avatar: Command = {
  json: new SlashCommandBuilder()
    .setName("avatar")
    .setDescription("View a user's avatar in full size")
    .addUserOption((o) => o.setName("user").setDescription("User (defaults to you)"))
    .toJSON(),
  async run(i) {
    const user = i.options.getUser("user") ?? i.user;
    await i.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.blue)
          .setTitle(`${user.username}'s Avatar`)
          .setImage(user.displayAvatarURL({ size: 1024 })),
      ],
    });
  },
};

const announce: Command = {
  json: new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Post a clean announcement embed to a channel")
    .addChannelOption((o) => o.setName("channel").setDescription("Target channel").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
    .addStringOption((o) => o.setName("message").setDescription("Announcement body").setRequired(true).setMaxLength(3500))
    .addStringOption((o) => o.setName("title").setDescription("Optional embed title").setMaxLength(200))
    .addRoleOption((o) => o.setName("ping").setDescription("Optional role to mention"))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false)
    .toJSON(),
  async run(i) {
    if (!i.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      await missingPermReply(i, "Manage Messages");
      return;
    }
    const ch = i.options.getChannel("channel", true) as TextChannel;
    const message = i.options.getString("message", true);
    const title = i.options.getString("title")?.trim() || "Announcement";
    const ping = i.options.getRole("ping");
    await ch.send({
      content: ping ? ping.toString() : undefined,
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.blue)
          .setTitle(title)
          .setDescription(message)
          .setFooter({ text: `Posted by ${i.user.username}`, iconURL: i.user.displayAvatarURL() })
          .setTimestamp(new Date()),
      ],
      allowedMentions: ping ? { roles: [ping.id] } : { parse: [] },
    });
    await i.reply({ content: `Announcement sent to <#${ch.id}>.`, ephemeral: true });
  },
};

const help: Command = {
  json: new SlashCommandBuilder().setName("help").setDescription("Show all moderation, Modmail, tag, and utility commands").toJSON(),
  async run(i) {
    await i.reply({
      ephemeral: true,
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.blue)
          .setTitle("OnboardOps Public Bot — Commands")
          .setDescription("No server-wipe `/setup` required. Configure only what you want.")
          .addFields(
            {
              name: "Modmail (DM Support)",
              value: [
                "`/modmail-config` — set inbox channel, log channel, staff role & branding",
                "`/modmail-category` — customize DM dropdown options (`add`, `remove`, `list`)",
                "`/reply` (`/r`), `/note`, `/claim` — handle tickets in threads (or just type directly!)",
                "`/transfer` — move ticket to another category, staff member, or role",
                "`/resolve [delay]` — send green resolved notice & auto-close (default 2h)",
                "`/close [reason]` — close immediately & save transcript",
                "`/blacklist`, `/contact` — block abusers or open a ticket for a member",
              ].join("\n"),
            },
            {
              name: "Tags & Canned Replies",
              value: "`/tag send`, `/tag create`, `/tag edit`, `/tag delete`, `/tag list`, `/tag info`\nSupports `{user}`, `{username}`, `{server}`, `{staff}`, `{ticket_id}` — works in Modmail too!",
            },
            {
              name: "Dyno-Style Moderation",
              value: [
                "`/warn`, `/warnings`, `/delwarn`, `/clearwarns`",
                "`/mute` (`/timeout`), `/unmute`, `/kick`, `/ban`, `/softban`, `/unban`",
                "`/case`, `/reason`, `/modlogs`, `/modlog set|off`",
                "`/purge`, `/slowmode`, `/lock`, `/unlock`, `/nick`, `/role`, `/automod`",
              ].join("\n"),
            },
            {
              name: "Utility",
              value: "`/whois`, `/serverinfo`, `/avatar`, `/announce`, `/ping`, `/help`",
            },
          ),
      ],
    });
  },
};

export const utilityCommands: Command[] = [help, ping, whois, serverinfo, avatar, announce];
