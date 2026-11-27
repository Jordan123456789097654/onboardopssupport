import {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
  type TextChannel,
} from "discord.js";
import {
  addModCase,
  clearWarnings,
  getCaseById,
  getGuildConfig,
  getUserActiveWarnings,
  getUserCases,
  removeWarning,
  scheduleSave,
} from "../store";
import {
  COLORS,
  canModerateTarget,
  formatDuration,
  missingPermReply,
  notifyUserPunishment,
  parseDuration,
  postModLog,
} from "../util";
import type { Command } from "./types";

const warn: Command = {
  json: new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Warn a member and record a moderation case")
    .addUserOption((o) => o.setName("user").setDescription("Member to warn").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Reason for the warning").setRequired(true).setMaxLength(500))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .toJSON(),
  async run(i) {
    if (!i.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) return void (await missingPermReply(i, "Moderate Members"));
    const user = i.options.getUser("user", true);
    const reason = i.options.getString("reason", true).trim();
    const guild = i.guild!;
    const actor = i.member as GuildMember;
    const bot = guild.members.me ?? (await guild.members.fetchMe());
    const target = await guild.members.fetch(user.id).catch(() => null);
    if (!target) {
      await i.reply({ content: "That user is not in this server.", ephemeral: true });
      return;
    }
    const err = canModerateTarget(actor, bot, target, guild);
    if (err) {
      await i.reply({ content: err, ephemeral: true });
      return;
    }
    await i.deferReply();
    const c = addModCase({
      guildId: guild.id,
      type: "WARN",
      userId: user.id,
      userTag: user.username,
      moderatorId: i.user.id,
      moderatorTag: i.user.username,
      reason,
      durationMs: null,
    });
    const dmOk = await notifyUserPunishment(user, guild, "You received a warning", reason);
    await postModLog(guild, c);
    const total = getUserActiveWarnings(guild.id, user.id).length;
    await i.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.amber)
          .setDescription(`**Case #${c.caseId}** — Warned <@${user.id}> (${total} active warning${total === 1 ? "" : "s"}).\n**Reason:** ${reason}${dmOk ? "" : "\n*(Could not DM user)*"}`),
      ],
    });
  },
};

const warnings: Command = {
  json: new SlashCommandBuilder()
    .setName("warnings")
    .setDescription("View active warnings for a member")
    .addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .toJSON(),
  async run(i) {
    if (!i.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) return void (await missingPermReply(i, "Moderate Members"));
    const user = i.options.getUser("user", true);
    const list = getUserActiveWarnings(i.guildId!, user.id);
    if (list.length === 0) {
      await i.reply({ content: `<@${user.id}> has no active warnings.`, ephemeral: true });
      return;
    }
    await i.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.amber)
          .setTitle(`Warnings for ${user.username} (${list.length})`)
          .setDescription(
            list
              .slice(-20)
              .map((w) => `**Case #${w.caseId}** • <t:${Math.floor(w.createdAt / 1000)}:d> by <@${w.moderatorId}>\n${w.reason}`)
              .join("\n\n"),
          ),
      ],
      ephemeral: true,
    });
  },
};

const delwarn: Command = {
  json: new SlashCommandBuilder()
    .setName("delwarn")
    .setDescription("Remove a specific warning from a member")
    .addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true))
    .addIntegerOption((o) => o.setName("case_id").setDescription("Case ID of the warning").setRequired(true).setMinValue(1))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .toJSON(),
  async run(i) {
    if (!i.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) return void (await missingPermReply(i, "Moderate Members"));
    const user = i.options.getUser("user", true);
    const caseId = i.options.getInteger("case_id", true);
    const removed = removeWarning(i.guildId!, user.id, caseId);
    await i.reply({
      content: removed ? `Removed warning **Case #${caseId}** for <@${user.id}>.` : `Active warning **Case #${caseId}** not found for <@${user.id}>.`,
      ephemeral: true,
    });
  },
};

const clearwarns: Command = {
  json: new SlashCommandBuilder()
    .setName("clearwarns")
    .setDescription("Clear all active warnings for a member")
    .addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .toJSON(),
  async run(i) {
    if (!i.memberPermissions?.has(PermissionFlagsBits.Administrator)) return void (await missingPermReply(i, "Administrator"));
    const user = i.options.getUser("user", true);
    const count = clearWarnings(i.guildId!, user.id);
    await i.reply({ content: `Cleared **${count}** active warning${count === 1 ? "" : "s"} for <@${user.id}>.`, ephemeral: true });
  },
};

function makeMuteCommand(name: "mute" | "timeout"): Command {
  return {
    json: new SlashCommandBuilder()
      .setName(name)
      .setDescription("Timeout/mute a member (e.g. 10m, 1h, 1d)")
      .addUserOption((o) => o.setName("user").setDescription("Member to mute").setRequired(true))
      .addStringOption((o) => o.setName("duration").setDescription("Duration (e.g. 10m, 2h, 7d — max 28d)").setRequired(true))
      .addStringOption((o) => o.setName("reason").setDescription("Reason").setMaxLength(500))
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .setDMPermission(false)
      .toJSON(),
    async run(i) {
      if (!i.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) return void (await missingPermReply(i, "Moderate Members"));
      const user = i.options.getUser("user", true);
      const rawDur = i.options.getString("duration", true);
      const ms = parseDuration(rawDur);
      if (!ms || ms < 10_000 || ms > 28 * 86_400_000) {
        await i.reply({ content: "Provide a valid duration between `10s` and `28d` (e.g. `10m`, `1h`, `7d`).", ephemeral: true });
        return;
      }
      const reason = i.options.getString("reason")?.trim() || "No reason provided.";
      const guild = i.guild!;
      const actor = i.member as GuildMember;
      const bot = guild.members.me ?? (await guild.members.fetchMe());
      const target = await guild.members.fetch(user.id).catch(() => null);
      if (!target) {
        await i.reply({ content: "That user is not in this server.", ephemeral: true });
        return;
      }
      const err = canModerateTarget(actor, bot, target, guild);
      if (err) {
        await i.reply({ content: err, ephemeral: true });
        return;
      }
      await i.deferReply();
      await target.timeout(ms, `${i.user.username}: ${reason}`);
      const c = addModCase({
        guildId: guild.id,
        type: "MUTE",
        userId: user.id,
        userTag: user.username,
        moderatorId: i.user.id,
        moderatorTag: i.user.username,
        reason,
        durationMs: ms,
      });
      await notifyUserPunishment(user, guild, "You were muted", reason, ms);
      await postModLog(guild, c);
      await i.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.amber)
            .setDescription(`**Case #${c.caseId}** — Muted <@${user.id}> for **${formatDuration(ms)}**.\n**Reason:** ${reason}`),
        ],
      });
    },
  };
}

const unmute: Command = {
  json: new SlashCommandBuilder()
    .setName("unmute")
    .setDescription("Remove timeout/mute from a member")
    .addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Reason").setMaxLength(500))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .toJSON(),
  async run(i) {
    if (!i.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) return void (await missingPermReply(i, "Moderate Members"));
    const user = i.options.getUser("user", true);
    const reason = i.options.getString("reason")?.trim() || "No reason provided.";
    const guild = i.guild!;
    const target = await guild.members.fetch(user.id).catch(() => null);
    if (!target) {
      await i.reply({ content: "That user is not in this server.", ephemeral: true });
      return;
    }
    await i.deferReply();
    await target.timeout(null, `${i.user.username}: ${reason}`);
    const c = addModCase({
      guildId: guild.id,
      type: "UNMUTE",
      userId: user.id,
      userTag: user.username,
      moderatorId: i.user.id,
      moderatorTag: i.user.username,
      reason,
      durationMs: null,
    });
    await notifyUserPunishment(user, guild, "Unmuted", reason);
    await postModLog(guild, c);
    await i.editReply({
      embeds: [new EmbedBuilder().setColor(COLORS.green).setDescription(`**Case #${c.caseId}** — Unmuted <@${user.id}>.\n**Reason:** ${reason}`)],
    });
  },
};

const kick: Command = {
  json: new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kick a member from the server")
    .addUserOption((o) => o.setName("user").setDescription("Member to kick").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Reason").setMaxLength(500))
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .setDMPermission(false)
    .toJSON(),
  async run(i) {
    if (!i.memberPermissions?.has(PermissionFlagsBits.KickMembers)) return void (await missingPermReply(i, "Kick Members"));
    const user = i.options.getUser("user", true);
    const reason = i.options.getString("reason")?.trim() || "No reason provided.";
    const guild = i.guild!;
    const actor = i.member as GuildMember;
    const bot = guild.members.me ?? (await guild.members.fetchMe());
    const target = await guild.members.fetch(user.id).catch(() => null);
    if (!target) {
      await i.reply({ content: "That user is not in this server.", ephemeral: true });
      return;
    }
    const err = canModerateTarget(actor, bot, target, guild);
    if (err) {
      await i.reply({ content: err, ephemeral: true });
      return;
    }
    await i.deferReply();
    await notifyUserPunishment(user, guild, "You were kicked", reason);
    await target.kick(`${i.user.username}: ${reason}`);
    const c = addModCase({
      guildId: guild.id,
      type: "KICK",
      userId: user.id,
      userTag: user.username,
      moderatorId: i.user.id,
      moderatorTag: i.user.username,
      reason,
      durationMs: null,
    });
    await postModLog(guild, c);
    await i.editReply({
      embeds: [new EmbedBuilder().setColor(COLORS.red).setDescription(`**Case #${c.caseId}** — Kicked **${user.username}**.\n**Reason:** ${reason}`)],
    });
  },
};

const ban: Command = {
  json: new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a user from the server (works even if they aren't in the server)")
    .addUserOption((o) => o.setName("user").setDescription("User to ban").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Reason").setMaxLength(500))
    .addIntegerOption((o) => o.setName("delete_days").setDescription("Days of messages to delete (0-7)").setMinValue(0).setMaxValue(7))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setDMPermission(false)
    .toJSON(),
  async run(i) {
    if (!i.memberPermissions?.has(PermissionFlagsBits.BanMembers)) return void (await missingPermReply(i, "Ban Members"));
    const user = i.options.getUser("user", true);
    const reason = i.options.getString("reason")?.trim() || "No reason provided.";
    const days = i.options.getInteger("delete_days") ?? 0;
    const guild = i.guild!;
    const actor = i.member as GuildMember;
    const bot = guild.members.me ?? (await guild.members.fetchMe());
    const target = await guild.members.fetch(user.id).catch(() => null);
    if (target) {
      const err = canModerateTarget(actor, bot, target, guild);
      if (err) {
        await i.reply({ content: err, ephemeral: true });
        return;
      }
    }
    await i.deferReply();
    if (target) await notifyUserPunishment(user, guild, "You were banned", reason);
    await guild.members.ban(user.id, { deleteMessageSeconds: days * 86_400, reason: `${i.user.username}: ${reason}` });
    const c = addModCase({
      guildId: guild.id,
      type: "BAN",
      userId: user.id,
      userTag: user.username,
      moderatorId: i.user.id,
      moderatorTag: i.user.username,
      reason,
      durationMs: null,
    });
    await postModLog(guild, c);
    await i.editReply({
      embeds: [new EmbedBuilder().setColor(COLORS.red).setDescription(`**Case #${c.caseId}** — Banned **${user.username}**.\n**Reason:** ${reason}`)],
    });
  },
};

const softban: Command = {
  json: new SlashCommandBuilder()
    .setName("softban")
    .setDescription("Ban and immediately unban a member to clear their recent messages")
    .addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Reason").setMaxLength(500))
    .addIntegerOption((o) => o.setName("delete_days").setDescription("Days of messages to delete (1-7, default 1)").setMinValue(1).setMaxValue(7))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setDMPermission(false)
    .toJSON(),
  async run(i) {
    if (!i.memberPermissions?.has(PermissionFlagsBits.BanMembers)) return void (await missingPermReply(i, "Ban Members"));
    const user = i.options.getUser("user", true);
    const reason = i.options.getString("reason")?.trim() || "Softban message cleanup.";
    const days = i.options.getInteger("delete_days") ?? 1;
    const guild = i.guild!;
    const actor = i.member as GuildMember;
    const bot = guild.members.me ?? (await guild.members.fetchMe());
    const target = await guild.members.fetch(user.id).catch(() => null);
    if (!target) {
      await i.reply({ content: "That user is not in this server.", ephemeral: true });
      return;
    }
    const err = canModerateTarget(actor, bot, target, guild);
    if (err) {
      await i.reply({ content: err, ephemeral: true });
      return;
    }
    await i.deferReply();
    await notifyUserPunishment(user, guild, "You were softbanned", reason);
    await guild.members.ban(user.id, { deleteMessageSeconds: days * 86_400, reason: `Softban by ${i.user.username}: ${reason}` });
    await guild.members.unban(user.id, "Softban auto-unban");
    const c = addModCase({
      guildId: guild.id,
      type: "SOFTBAN",
      userId: user.id,
      userTag: user.username,
      moderatorId: i.user.id,
      moderatorTag: i.user.username,
      reason,
      durationMs: null,
    });
    await postModLog(guild, c);
    await i.editReply({
      embeds: [new EmbedBuilder().setColor(COLORS.red).setDescription(`**Case #${c.caseId}** — Softbanned **${user.username}** (deleted ${days}d of messages).\n**Reason:** ${reason}`)],
    });
  },
};

const unban: Command = {
  json: new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Unban a user by their Discord user ID")
    .addStringOption((o) => o.setName("user_id").setDescription("Discord user ID").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Reason").setMaxLength(500))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setDMPermission(false)
    .toJSON(),
  async run(i) {
    if (!i.memberPermissions?.has(PermissionFlagsBits.BanMembers)) return void (await missingPermReply(i, "Ban Members"));
    const userId = i.options.getString("user_id", true).replace(/[<@!>]/g, "").trim();
    if (!/^\d{15,25}$/.test(userId)) {
      await i.reply({ content: "Enter a valid Discord user ID.", ephemeral: true });
      return;
    }
    const reason = i.options.getString("reason")?.trim() || "No reason provided.";
    const guild = i.guild!;
    await i.deferReply();
    const banInfo = await guild.bans.fetch(userId).catch(() => null);
    if (!banInfo) {
      await i.editReply("That user is not currently banned.");
      return;
    }
    await guild.members.unban(userId, `${i.user.username}: ${reason}`);
    const c = addModCase({
      guildId: guild.id,
      type: "UNBAN",
      userId,
      userTag: banInfo.user.username,
      moderatorId: i.user.id,
      moderatorTag: i.user.username,
      reason,
      durationMs: null,
    });
    await postModLog(guild, c);
    await i.editReply({
      embeds: [new EmbedBuilder().setColor(COLORS.green).setDescription(`**Case #${c.caseId}** — Unbanned **${banInfo.user.username}** (\`${userId}\`).\n**Reason:** ${reason}`)],
    });
  },
};

const caseCmd: Command = {
  json: new SlashCommandBuilder()
    .setName("case")
    .setDescription("Inspect a moderation case by ID")
    .addIntegerOption((o) => o.setName("id").setDescription("Case number").setRequired(true).setMinValue(1))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .toJSON(),
  async run(i) {
    if (!i.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) return void (await missingPermReply(i, "Moderate Members"));
    const id = i.options.getInteger("id", true);
    const c = getCaseById(i.guildId!, id);
    if (!c) {
      await i.reply({ content: `Case #${id} not found.`, ephemeral: true });
      return;
    }
    await i.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.blue)
          .setTitle(`Case #${c.caseId} — ${c.type}`)
          .addFields(
            { name: "User", value: `${c.userTag} (<@${c.userId}>)`, inline: true },
            { name: "Moderator", value: `${c.moderatorTag} (<@${c.moderatorId}>)`, inline: true },
            { name: "Reason", value: c.reason },
          )
          .setTimestamp(new Date(c.createdAt)),
      ],
      ephemeral: true,
    });
  },
};

const reasonCmd: Command = {
  json: new SlashCommandBuilder()
    .setName("reason")
    .setDescription("Update the reason on a moderation case")
    .addIntegerOption((o) => o.setName("case_id").setDescription("Case number").setRequired(true).setMinValue(1))
    .addStringOption((o) => o.setName("reason").setDescription("New reason").setRequired(true).setMaxLength(500))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .toJSON(),
  async run(i) {
    if (!i.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) return void (await missingPermReply(i, "Moderate Members"));
    const id = i.options.getInteger("case_id", true);
    const next = i.options.getString("reason", true).trim();
    const c = getCaseById(i.guildId!, id);
    if (!c) {
      await i.reply({ content: `Case #${id} not found.`, ephemeral: true });
      return;
    }
    c.reason = next;
    scheduleSave();
    await i.reply({ content: `Updated reason for **Case #${c.caseId}** (${c.type}).`, ephemeral: true });
  },
};

const modlogs: Command = {
  json: new SlashCommandBuilder()
    .setName("modlogs")
    .setDescription("View full moderation history for a user")
    .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .toJSON(),
  async run(i) {
    if (!i.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) return void (await missingPermReply(i, "Moderate Members"));
    const user = i.options.getUser("user", true);
    const list = getUserCases(i.guildId!, user.id);
    if (list.length === 0) {
      await i.reply({ content: `<@${user.id}> has no moderation history on this server.`, ephemeral: true });
      return;
    }
    await i.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.blue)
          .setTitle(`Modlogs for ${user.username} (${list.length} total)`)
          .setDescription(
            list
              .slice(-15)
              .reverse()
              .map((c) => `**#${c.caseId} [${c.type}]**${!c.active ? " *(cleared)*" : ""} • <t:${Math.floor(c.createdAt / 1000)}:d> by <@${c.moderatorId}>\n${c.reason}`)
              .join("\n\n"),
          ),
      ],
      ephemeral: true,
    });
  },
};

const purge: Command = {
  json: new SlashCommandBuilder()
    .setName("purge")
    .setDescription("Bulk delete recent messages in this channel (with optional filters)")
    .addIntegerOption((o) => o.setName("amount").setDescription("How many messages to scan/delete (1-100)").setRequired(true).setMinValue(1).setMaxValue(100))
    .addUserOption((o) => o.setName("user").setDescription("Only delete messages from this user"))
    .addStringOption((o) => o.setName("contains").setDescription("Only delete messages containing this text").setMaxLength(100))
    .addBooleanOption((o) => o.setName("bots_only").setDescription("Only delete messages from bots"))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false)
    .toJSON(),
  async run(i) {
    if (!i.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) return void (await missingPermReply(i, "Manage Messages"));
    const ch = i.channel;
    if (!ch || !("bulkDelete" in ch)) {
      await i.reply({ content: "Use this in a text channel or thread.", ephemeral: true });
      return;
    }
    const amount = i.options.getInteger("amount", true);
    const filterUser = i.options.getUser("user");
    const contains = i.options.getString("contains")?.toLowerCase();
    const botsOnly = i.options.getBoolean("bots_only") ?? false;
    await i.deferReply({ ephemeral: true });
    const fetched = await ch.messages.fetch({ limit: amount });
    const filtered = fetched.filter((m) => {
      if (filterUser && m.author.id !== filterUser.id) return false;
      if (botsOnly && !m.author.bot) return false;
      if (contains && !m.content.toLowerCase().includes(contains)) return false;
      return true;
    });
    const deleted = await (ch as TextChannel).bulkDelete(filtered, true);
    await i.editReply(`Deleted **${deleted.size}** message${deleted.size === 1 ? "" : "s"} (messages older than 14 days cannot be bulk-deleted).`);
  },
};

const slowmode: Command = {
  json: new SlashCommandBuilder()
    .setName("slowmode")
    .setDescription("Set or remove slowmode in a channel")
    .addIntegerOption((o) => o.setName("seconds").setDescription("0 turns slowmode off (max 21600)").setRequired(true).setMinValue(0).setMaxValue(21600))
    .addChannelOption((o) => o.setName("channel").setDescription("Channel (defaults to current)").addChannelTypes(ChannelType.GuildText))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setDMPermission(false)
    .toJSON(),
  async run(i) {
    if (!i.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) return void (await missingPermReply(i, "Manage Channels"));
    const ch = (i.options.getChannel("channel") ?? i.channel) as TextChannel | null;
    if (!ch || !("setRateLimitPerUser" in ch)) {
      await i.reply({ content: "Select a valid text channel.", ephemeral: true });
      return;
    }
    const s = i.options.getInteger("seconds", true);
    await ch.setRateLimitPerUser(s, `Set by ${i.user.username}`);
    await i.reply({ content: s === 0 ? `Slowmode disabled in <#${ch.id}>.` : `Slowmode in <#${ch.id}> set to **${s} seconds**.`, ephemeral: true });
  },
};

function makeLockCommand(lockState: boolean): Command {
  return {
    json: new SlashCommandBuilder()
      .setName(lockState ? "lock" : "unlock")
      .setDescription(lockState ? "Lock a channel so @everyone cannot send messages" : "Unlock a channel so @everyone can send messages again")
      .addChannelOption((o) => o.setName("channel").setDescription("Channel (defaults to current)").addChannelTypes(ChannelType.GuildText))
      .addStringOption((o) => o.setName("reason").setDescription("Optional reason").setMaxLength(300))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
      .setDMPermission(false)
      .toJSON(),
    async run(i) {
      if (!i.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) return void (await missingPermReply(i, "Manage Channels"));
      const ch = (i.options.getChannel("channel") ?? i.channel) as TextChannel | null;
      if (!ch || ch.type !== ChannelType.GuildText) {
        await i.reply({ content: "Use this on a text channel.", ephemeral: true });
        return;
      }
      const reason = i.options.getString("reason")?.trim();
      await ch.permissionOverwrites.edit(i.guild!.roles.everyone, { SendMessages: lockState ? false : null }, { reason: `${i.user.username}: ${reason ?? (lockState ? "Lock" : "Unlock")}` });
      await ch.send({
        embeds: [
          new EmbedBuilder()
            .setColor(lockState ? COLORS.red : COLORS.green)
            .setDescription(
              lockState
                ? `🔒 Channel locked by <@${i.user.id}>.${reason ? `\n**Reason:** ${reason}` : ""}`
                : `🔓 Channel unlocked by <@${i.user.id}>.${reason ? `\n**Reason:** ${reason}` : ""}`,
            ),
        ],
      });
      await i.reply({ content: `${lockState ? "Locked" : "Unlocked"} <#${ch.id}>.`, ephemeral: true });
    },
  };
}

const nick: Command = {
  json: new SlashCommandBuilder()
    .setName("nick")
    .setDescription("Change or reset a member's server nickname")
    .addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true))
    .addStringOption((o) => o.setName("nickname").setDescription("New nickname (leave empty to reset)").setMaxLength(32))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
    .setDMPermission(false)
    .toJSON(),
  async run(i) {
    if (!i.memberPermissions?.has(PermissionFlagsBits.ManageNicknames)) return void (await missingPermReply(i, "Manage Nicknames"));
    const user = i.options.getUser("user", true);
    const next = i.options.getString("nickname")?.trim() || null;
    const guild = i.guild!;
    const actor = i.member as GuildMember;
    const bot = guild.members.me ?? (await guild.members.fetchMe());
    const target = await guild.members.fetch(user.id).catch(() => null);
    if (!target) {
      await i.reply({ content: "Member not found in this server.", ephemeral: true });
      return;
    }
    const err = canModerateTarget(actor, bot, target, guild);
    if (err && target.id !== actor.id) {
      await i.reply({ content: err, ephemeral: true });
      return;
    }
    await target.setNickname(next, `Changed by ${i.user.username}`);
    await i.reply({ content: next ? `Changed <@${user.id}>'s nickname to **${next}**.` : `Reset <@${user.id}>'s nickname.`, ephemeral: true });
  },
};

const roleCmd: Command = {
  json: new SlashCommandBuilder()
    .setName("role")
    .setDescription("Add or remove a role from a member")
    .addSubcommand((s) =>
      s
        .setName("add")
        .setDescription("Give a role to a member")
        .addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true))
        .addRoleOption((o) => o.setName("role").setDescription("Role").setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName("remove")
        .setDescription("Remove a role from a member")
        .addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true))
        .addRoleOption((o) => o.setName("role").setDescription("Role").setRequired(true)),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false)
    .toJSON(),
  async run(i) {
    if (!i.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) return void (await missingPermReply(i, "Manage Roles"));
    const sub = i.options.getSubcommand();
    const user = i.options.getUser("user", true);
    const role = i.options.getRole("role", true);
    const guild = i.guild!;
    const actor = i.member as GuildMember;
    const bot = guild.members.me ?? (await guild.members.fetchMe());
    if (role.id === guild.id || role.managed) {
      await i.reply({ content: "That role cannot be assigned manually.", ephemeral: true });
      return;
    }
    if (actor.id !== guild.ownerId && role.position >= actor.roles.highest.position) {
      await i.reply({ content: "That role is at or above your highest role.", ephemeral: true });
      return;
    }
    if (role.position >= bot.roles.highest.position) {
      await i.reply({ content: "That role is at or above my highest role.", ephemeral: true });
      return;
    }
    const target = await guild.members.fetch(user.id).catch(() => null);
    if (!target) {
      await i.reply({ content: "Member not found in this server.", ephemeral: true });
      return;
    }
    if (sub === "add") {
      await target.roles.add(role.id, `Added by ${i.user.username}`);
      await i.reply({ content: `Added <@&${role.id}> to <@${user.id}>.`, ephemeral: true });
    } else {
      await target.roles.remove(role.id, `Removed by ${i.user.username}`);
      await i.reply({ content: `Removed <@&${role.id}> from <@${user.id}>.`, ephemeral: true });
    }
  },
};

const modlog: Command = {
  json: new SlashCommandBuilder()
    .setName("modlog")
    .setDescription("Set or disable the moderation log channel")
    .addSubcommand((s) =>
      s
        .setName("set")
        .setDescription("Set the channel where moderation cases and AutoMod alerts are posted")
        .addChannelOption((o) => o.setName("channel").setDescription("Modlog channel").addChannelTypes(ChannelType.GuildText).setRequired(true)),
    )
    .addSubcommand((s) => s.setName("off").setDescription("Disable moderation logging"))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .toJSON(),
  async run(i) {
    if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return void (await missingPermReply(i, "Manage Server"));
    const cfg = getGuildConfig(i.guildId!);
    if (i.options.getSubcommand() === "set") {
      const ch = i.options.getChannel("channel", true) as TextChannel;
      cfg.modLogChannelId = ch.id;
      scheduleSave();
      await i.reply({ content: `Moderation logs will now be posted to <#${ch.id}>.`, ephemeral: true });
    } else {
      cfg.modLogChannelId = null;
      scheduleSave();
      await i.reply({ content: "Moderation logging disabled.", ephemeral: true });
    }
  },
};

const automod: Command = {
  json: new SlashCommandBuilder()
    .setName("automod")
    .setDescription("Configure Dyno-style AutoMod filters")
    .addSubcommand((s) =>
      s.setName("toggle").setDescription("Turn AutoMod on or off").addBooleanOption((o) => o.setName("enabled").setDescription("On or off").setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName("rules")
        .setDescription("Adjust AutoMod filter settings")
        .addBooleanOption((o) => o.setName("anti_invite").setDescription("Block Discord server invite links"))
        .addBooleanOption((o) => o.setName("anti_links").setDescription("Block all http/https links"))
        .addIntegerOption((o) => o.setName("max_mentions").setDescription("Max user/role mentions per message (0 = off)").setMinValue(0).setMaxValue(30))
        .addIntegerOption((o) => o.setName("caps_percent").setDescription("Block messages with >= this % caps (0 = off)").setMinValue(0).setMaxValue(100)),
    )
    .addSubcommand((s) =>
      s
        .setName("badword")
        .setDescription("Add or remove a blocked word/phrase")
        .addStringOption((o) => o.setName("action").setDescription("add or remove").setRequired(true).addChoices({ name: "add", value: "add" }, { name: "remove", value: "remove" }))
        .addStringOption((o) => o.setName("word").setDescription("Word or phrase").setRequired(true).setMaxLength(60)),
    )
    .addSubcommand((s) =>
      s
        .setName("exempt")
        .setDescription("Toggle a role exempt from AutoMod")
        .addRoleOption((o) => o.setName("role").setDescription("Role").setRequired(true)),
    )
    .addSubcommand((s) => s.setName("status").setDescription("View current AutoMod configuration"))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .toJSON(),
  async run(i) {
    if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return void (await missingPermReply(i, "Manage Server"));
    const cfg = getGuildConfig(i.guildId!);
    const am = cfg.automod;
    const sub = i.options.getSubcommand();

    if (sub === "toggle") {
      am.enabled = i.options.getBoolean("enabled", true);
      scheduleSave();
      await i.reply({ content: `AutoMod is now **${am.enabled ? "enabled" : "disabled"}**.`, ephemeral: true });
      return;
    }

    if (sub === "rules") {
      const antiInvite = i.options.getBoolean("anti_invite");
      const antiLinks = i.options.getBoolean("anti_links");
      const maxMentions = i.options.getInteger("max_mentions");
      const capsPercent = i.options.getInteger("caps_percent");
      if (antiInvite !== null) am.antiInvite = antiInvite;
      if (antiLinks !== null) am.antiLinks = antiLinks;
      if (maxMentions !== null) am.maxMentions = maxMentions;
      if (capsPercent !== null) am.capsPercent = capsPercent;
      scheduleSave();
      await i.reply({ content: "AutoMod rules updated.", ephemeral: true });
      return;
    }

    if (sub === "badword") {
      const action = i.options.getString("action", true);
      const word = i.options.getString("word", true).trim().toLowerCase();
      if (action === "add") {
        if (!am.blockedWords.includes(word)) am.blockedWords.push(word);
        scheduleSave();
        await i.reply({ content: `Added \`${word}\` to AutoMod blocked words.`, ephemeral: true });
      } else {
        am.blockedWords = am.blockedWords.filter((w) => w !== word);
        scheduleSave();
        await i.reply({ content: `Removed \`${word}\` from AutoMod blocked words.`, ephemeral: true });
      }
      return;
    }

    if (sub === "exempt") {
      const role = i.options.getRole("role", true);
      if (am.exemptRoleIds.includes(role.id)) {
        am.exemptRoleIds = am.exemptRoleIds.filter((id) => id !== role.id);
        scheduleSave();
        await i.reply({ content: `<@&${role.id}> is no longer exempt from AutoMod.`, ephemeral: true });
      } else {
        am.exemptRoleIds.push(role.id);
        scheduleSave();
        await i.reply({ content: `<@&${role.id}> is now exempt from AutoMod.`, ephemeral: true });
      }
      return;
    }

    await i.reply({
      ephemeral: true,
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.blue)
          .setTitle("AutoMod Configuration")
          .addFields(
            { name: "Enabled", value: am.enabled ? "Yes" : "No", inline: true },
            { name: "Anti-Invite", value: am.antiInvite ? "On" : "Off", inline: true },
            { name: "Anti-Links", value: am.antiLinks ? "On" : "Off", inline: true },
            { name: "Max Mentions", value: am.maxMentions > 0 ? String(am.maxMentions) : "Off", inline: true },
            { name: "Caps Filter", value: am.capsPercent > 0 ? `${am.capsPercent}%` : "Off", inline: true },
            { name: "Blocked Words", value: am.blockedWords.length ? `${am.blockedWords.length} word(s)` : "None", inline: true },
            { name: "Exempt Roles", value: am.exemptRoleIds.length ? am.exemptRoleIds.map((id) => `<@&${id}>`).join(", ") : "Mods only" },
          ),
      ],
    });
  },
};

export const moderationCommands: Command[] = [
  warn,
  warnings,
  delwarn,
  clearwarns,
  makeMuteCommand("mute"),
  makeMuteCommand("timeout"),
  unmute,
  kick,
  ban,
  softban,
  unban,
  caseCmd,
  reasonCmd,
  modlogs,
  purge,
  slowmode,
  makeLockCommand(true),
  makeLockCommand(false),
  nick,
  roleCmd,
  modlog,
  automod,
];
