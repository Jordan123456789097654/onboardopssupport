import { AuditLogEvent, ChannelType, EmbedBuilder, Events, type Client, type Guild, type GuildBasedChannel } from "discord.js";

/**
 * Server audit log, posted to one channel. Covers channels, roles, bans, kicks, timeouts, role and nickname changes,
 * deleted messages, invites, and server name changes. Who did it comes from Discord's own audit log when available.
 */

export const AUDIT_LOG_CHANNEL_ID = "1575694745915756641";

const COLOR = { create: 0x22c55e, update: 0x3b82f6, delete: 0xef4444, member: 0xf59e0b, mod: 0xa855f7 };

const short = (s: string | null | undefined, max = 900) => {
  if (!s) return "(empty)";
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

/** Finds who performed the action, from the audit log. Looks only at entries from the last 15 seconds. */
async function executorOf(guild: Guild, type: AuditLogEvent, targetId?: string | null): Promise<string> {
  try {
    const logs = await guild.fetchAuditLogs({ type, limit: 6 });
    const entry = logs.entries.find(
      (e) => Date.now() - e.createdTimestamp < 15_000 && (!targetId || (e.target as { id?: string } | null)?.id === targetId),
    );
    return entry?.executor ? `<@${entry.executor.id}> (${entry.executor.username})` : "Unknown";
  } catch {
    return "Unknown (the bot needs View Audit Log)";
  }
}

async function post(client: Client, embed: EmbedBuilder): Promise<void> {
  const ch = client.channels.cache.get(AUDIT_LOG_CHANNEL_ID) ?? (await client.channels.fetch(AUDIT_LOG_CHANNEL_ID).catch(() => null));
  if (!ch || !ch.isTextBased() || ch.isDMBased()) return;
  await ch.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => undefined);
}

const base = (title: string, color: number) => new EmbedBuilder().setTitle(title).setColor(color).setTimestamp(new Date());

const channelLabel = (c: GuildBasedChannel | { id: string; name?: string | null }) => `${"name" in c && c.name ? `#${c.name}` : "channel"} (<#${c.id}>)`;

export function registerAuditLog(client: Client): void {
  /* ---------- Channels ---------- */
  client.on(Events.ChannelCreate, async (c) => {
    if (!c.guild) return;
    const by = await executorOf(c.guild, AuditLogEvent.ChannelCreate, c.id);
    await post(client, base("Channel created", COLOR.create).addFields(
      { name: "Channel", value: channelLabel(c), inline: true },
      { name: "Type", value: ChannelType[c.type] ?? String(c.type), inline: true },
      { name: "By", value: by, inline: true },
    ));
  });

  client.on(Events.ChannelDelete, async (c) => {
    if (c.isDMBased() || !c.guild) return;
    const by = await executorOf(c.guild, AuditLogEvent.ChannelDelete, c.id);
    await post(client, base("Channel deleted", COLOR.delete).addFields(
      { name: "Channel", value: `#${c.name ?? "unknown"} (\`${c.id}\`)`, inline: true },
      { name: "Type", value: ChannelType[c.type] ?? String(c.type), inline: true },
      { name: "By", value: by, inline: true },
    ));
  });

  client.on(Events.ChannelUpdate, async (oldC, newC) => {
    if (oldC.isDMBased() || newC.isDMBased() || !newC.guild) return;
    const changes: string[] = [];
    if (oldC.name !== newC.name) changes.push(`**Name:** #${oldC.name} → #${newC.name}`);
    const oldTopic = oldC.isTextBased() && "topic" in oldC ? oldC.topic : undefined;
    const newTopic = newC.isTextBased() && "topic" in newC ? newC.topic : undefined;
    if (oldTopic !== newTopic) changes.push(`**Topic:** ${short(oldTopic ?? "", 200)} → ${short(newTopic ?? "", 200)}`);
    if (oldC.parentId !== newC.parentId) changes.push(`**Category:** ${oldC.parentId ? `<#${oldC.parentId}>` : "none"} → ${newC.parentId ? `<#${newC.parentId}>` : "none"}`);
    if (!changes.length) return;
    const by = await executorOf(newC.guild, AuditLogEvent.ChannelUpdate, newC.id);
    await post(client, base("Channel updated", COLOR.update).setDescription(changes.join("\n")).addFields(
      { name: "Channel", value: channelLabel(newC), inline: true },
      { name: "By", value: by, inline: true },
    ));
  });

  /* ---------- Roles ---------- */
  client.on(Events.GuildRoleCreate, async (role) => {
    const by = await executorOf(role.guild, AuditLogEvent.RoleCreate, role.id);
    await post(client, base("Role created", COLOR.create).addFields(
      { name: "Role", value: `${role.name} (<@&${role.id}>)`, inline: true },
      { name: "By", value: by, inline: true },
    ));
  });

  client.on(Events.GuildRoleDelete, async (role) => {
    const by = await executorOf(role.guild, AuditLogEvent.RoleDelete, role.id);
    await post(client, base("Role deleted", COLOR.delete).addFields(
      { name: "Role", value: `${role.name} (\`${role.id}\`)`, inline: true },
      { name: "By", value: by, inline: true },
    ));
  });

  client.on(Events.GuildRoleUpdate, async (oldRole, newRole) => {
    const changes: string[] = [];
    if (oldRole.name !== newRole.name) changes.push(`**Name:** ${oldRole.name} → ${newRole.name}`);
    if (oldRole.permissions.bitfield !== newRole.permissions.bitfield) changes.push("**Permissions** changed");
    if (oldRole.color !== newRole.color) changes.push("**Colour** changed");
    if (!changes.length) return;
    const by = await executorOf(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);
    await post(client, base("Role updated", COLOR.update).setDescription(changes.join("\n")).addFields(
      { name: "Role", value: `<@&${newRole.id}>`, inline: true },
      { name: "By", value: by, inline: true },
    ));
  });

  /* ---------- Members and moderation ---------- */
  client.on(Events.GuildBanAdd, async (ban) => {
    const by = await executorOf(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);
    await post(client, base("Member banned", COLOR.mod).addFields(
      { name: "User", value: `${ban.user.username} (\`${ban.user.id}\`)`, inline: true },
      { name: "By", value: by, inline: true },
      { name: "Reason", value: short(ban.reason ?? "None given", 300), inline: false },
    ));
  });

  client.on(Events.GuildBanRemove, async (ban) => {
    const by = await executorOf(ban.guild, AuditLogEvent.MemberBanRemove, ban.user.id);
    await post(client, base("Ban removed", COLOR.mod).addFields(
      { name: "User", value: `${ban.user.username} (\`${ban.user.id}\`)`, inline: true },
      { name: "By", value: by, inline: true },
    ));
  });

  client.on(Events.GuildMemberRemove, async (member) => {
    const kicked = await member.guild.fetchAuditLogs({ type: AuditLogEvent.MemberKick, limit: 3 }).then(
      (l) => l.entries.find((e) => Date.now() - e.createdTimestamp < 15_000 && (e.target as { id?: string } | null)?.id === member.id),
      () => undefined,
    );
    await post(client, base(kicked ? "Member kicked" : "Member left", kicked ? COLOR.mod : COLOR.member).addFields(
      { name: "User", value: `${member.user.username} (\`${member.id}\`)`, inline: true },
      ...(kicked ? [{ name: "By", value: kicked.executor ? `<@${kicked.executor.id}>` : "Unknown", inline: true }] : []),
      { name: "Reason", value: short(kicked?.reason ?? "None", 300), inline: false },
    ));
  });

  client.on(Events.GuildMemberUpdate, async (oldM, newM) => {
    const lines: string[] = [];
    const oldTimeout = oldM.communicationDisabledUntilTimestamp;
    const newTimeout = newM.communicationDisabledUntilTimestamp;
    if (oldTimeout !== newTimeout) {
      lines.push(newTimeout && newTimeout > Date.now() ? `**Timed out** until <t:${Math.floor(newTimeout / 1000)}:f>` : "**Timeout removed**");
    }
    if (oldM.nickname !== newM.nickname) lines.push(`**Nickname:** ${oldM.nickname ?? "none"} → ${newM.nickname ?? "none"}`);
    const added = newM.roles.cache.filter((r) => !oldM.roles.cache.has(r.id));
    const removed = oldM.roles.cache.filter((r) => !newM.roles.cache.has(r.id));
    if (added.size) lines.push(`**Roles added:** ${added.map((r) => `<@&${r.id}>`).join(" ")}`);
    if (removed.size) lines.push(`**Roles removed:** ${removed.map((r) => `<@&${r.id}>`).join(" ")}`);
    if (!lines.length) return;
    const isTimeout = oldTimeout !== newTimeout;
    const by = await executorOf(newM.guild, isTimeout ? AuditLogEvent.MemberUpdate : AuditLogEvent.MemberRoleUpdate, newM.id);
    await post(client, base("Member updated", COLOR.member).setDescription(lines.join("\n")).addFields(
      { name: "User", value: `${newM.user.username} (<@${newM.id}>)`, inline: true },
      { name: "By", value: by, inline: true },
    ));
  });

  /* ---------- Messages ---------- */
  client.on(Events.MessageDelete, async (msg) => {
    if (!msg.guild || msg.channelId === AUDIT_LOG_CHANNEL_ID) return;
    const by = await executorOf(msg.guild, AuditLogEvent.MessageDelete, msg.author?.id ?? null);
    await post(client, base("Message deleted", COLOR.delete).setDescription(short(msg.content ?? "(not cached)", 1000)).addFields(
      { name: "Channel", value: `<#${msg.channelId}>`, inline: true },
      { name: "Author", value: msg.author ? `${msg.author.username} (<@${msg.author.id}>)` : "Unknown", inline: true },
      { name: "Deleted by", value: by === "Unknown" ? "The author, or unknown" : by, inline: true },
    ));
  });

  client.on(Events.MessageBulkDelete, async (messages, channel) => {
    if (!("guild" in channel) || !channel.guild) return;
    await post(client, base("Messages purged", COLOR.delete).addFields(
      { name: "Channel", value: `<#${channel.id}>`, inline: true },
      { name: "Count", value: String(messages.size), inline: true },
    ));
  });

  /* ---------- Invites and server ---------- */
  client.on(Events.InviteCreate, async (invite) => {
    if (!invite.guild) return;
    await post(client, base("Invite created", COLOR.create).addFields(
      { name: "Code", value: `discord.gg/${invite.code}`, inline: true },
      { name: "Channel", value: invite.channel ? `<#${invite.channel.id}>` : "Unknown", inline: true },
      { name: "By", value: invite.inviter ? `<@${invite.inviter.id}>` : "Unknown", inline: true },
      { name: "Expires", value: invite.maxAge ? `in ${Math.round(invite.maxAge / 3600)}h` : "Never", inline: true },
    ));
  });

  client.on(Events.InviteDelete, async (invite) => {
    if (!invite.guild) return;
    await post(client, base("Invite deleted", COLOR.delete).addFields({ name: "Code", value: `discord.gg/${invite.code}`, inline: true }));
  });

  client.on(Events.GuildUpdate, async (oldG, newG) => {
    if (oldG.name === newG.name) return;
    const by = await executorOf(newG, AuditLogEvent.GuildUpdate, newG.id);
    await post(client, base("Server renamed", COLOR.update).addFields(
      { name: "Name", value: `${oldG.name} → ${newG.name}`, inline: false },
      { name: "By", value: by, inline: true },
    ));
  });
}
