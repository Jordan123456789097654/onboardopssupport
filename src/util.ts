import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
  type TextChannel,
  type User,
} from "discord.js";
import { getGuildConfig, type ModCase } from "./store";

export const COLORS = {
  green: 0x22c55e,
  red: 0xef4444,
  amber: 0xf59e0b,
  blue: 0x3b82f6,
  slate: 0x64748b,
} as const;

/* ---------------- Duration parser & formatter ---------------- */

const UNITS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

/** Parses durations like "10m", "2h", "1d", "1h30m". Returns null if invalid. */
export function parseDuration(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  let total = 0;
  let matched = false;
  const re = /(\d+)\s*([smhdw])/g;
  let m: RegExpExecArray | null;
  let consumed = 0;
  while ((m = re.exec(s))) {
    matched = true;
    consumed += m[0].length;
    total += Number(m[1]) * UNITS[m[2]];
  }
  if (!matched || consumed !== s.replace(/\s+/g, "").length || total <= 0) return null;
  return total;
}

export function formatDuration(ms: number): string {
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec} second${sec === 1 ? "" : "s"}`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"}`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"}`;
  const day = Math.round(hr / 24);
  return `${day} day${day === 1 ? "" : "s"}`;
}

/* ---------------- Permissions & role hierarchy ---------------- */

export const DEFAULT_ALWAYS_ACCESS_ROLE_ID = "1575918473585107186";

export function alwaysAccessRoles(guildId: string): string[] {
  const cfg = getGuildConfig(guildId);
  return cfg.alwaysAccessRoleIds ?? [DEFAULT_ALWAYS_ACCESS_ROLE_ID];
}

export function isStaffMember(member: GuildMember | null, guild: Guild): boolean {
  if (!member) return false;
  if (alwaysAccessRoles(guild.id).some((id) => member.roles.cache.has(id))) return true;
  if (guild.ownerId === member.id) return true;
  if (member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageMessages)) return true;
  const cfg = getGuildConfig(guild.id);
  if (cfg.modmailStaffRoleId && member.roles.cache.has(cfg.modmailStaffRoleId)) return true;
  return cfg.modmailCategories.some((c) => c.staffRoleId && member.roles.cache.has(c.staffRoleId));
}

export function canModerateTarget(
  actor: GuildMember,
  bot: GuildMember,
  target: GuildMember,
  guild: Guild,
): string | null {
  if (target.id === actor.id) return "You can't moderate yourself.";
  if (target.id === bot.id) return "I can't moderate myself.";
  if (target.id === guild.ownerId) return "You can't moderate the server owner.";
  if (actor.id !== guild.ownerId && target.roles.highest.position >= actor.roles.highest.position) {
    return "That member's highest role is at or above yours.";
  }
  if (target.roles.highest.position >= bot.roles.highest.position) {
    return "That member's highest role is at or above my highest role. Move my role higher in Server Settings.";
  }
  return null;
}

/* ---------------- Modlog helper ---------------- */

const CASE_COLOR: Record<ModCase["type"], number> = {
  WARN: COLORS.amber,
  MUTE: COLORS.amber,
  UNMUTE: COLORS.green,
  KICK: COLORS.red,
  BAN: COLORS.red,
  SOFTBAN: COLORS.red,
  UNBAN: COLORS.green,
};

export async function postModLog(guild: Guild, c: ModCase): Promise<void> {
  const cfg = getGuildConfig(guild.id);
  if (!cfg.modLogChannelId) return;
  const ch = guild.channels.cache.get(cfg.modLogChannelId) as TextChannel | undefined;
  if (!ch || ch.type !== ChannelType.GuildText) return;
  const embed = new EmbedBuilder()
    .setColor(CASE_COLOR[c.type])
    .setTitle(`Case #${c.caseId} | ${c.type}`)
    .addFields(
      { name: "User", value: `${c.userTag} (<@${c.userId}>)`, inline: true },
      { name: "Moderator", value: `${c.moderatorTag} (<@${c.moderatorId}>)`, inline: true },
      ...(c.durationMs ? [{ name: "Duration", value: formatDuration(c.durationMs), inline: true }] : []),
      { name: "Reason", value: c.reason || "No reason provided." },
    )
    .setFooter({ text: `User ID: ${c.userId}` })
    .setTimestamp(new Date(c.createdAt));
  await ch.send({ embeds: [embed] }).catch(() => undefined);
}

export async function notifyUserPunishment(
  user: User,
  guild: Guild,
  action: string,
  reason: string,
  durationMs?: number | null,
): Promise<boolean> {
  const embed = new EmbedBuilder()
    .setColor(action === "Unmuted" || action === "Unbanned" ? COLORS.green : COLORS.red)
    .setTitle(`${action} in ${guild.name}`)
    .addFields(
      { name: "Reason", value: reason || "No reason provided." },
      ...(durationMs ? [{ name: "Duration", value: formatDuration(durationMs), inline: true }] : []),
    )
    .setTimestamp(new Date());
  try {
    await user.send({ embeds: [embed] });
    return true;
  } catch {
    return false;
  }
}

/* ---------------- Rate limit: 8 commands / 10s per user ---------------- */

const hits = new Map<string, number[]>();
export function tooFast(userId: string): boolean {
  const now = Date.now();
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < 10_000);
  recent.push(now);
  hits.set(userId, recent);
  return recent.length > 8;
}

export function missingPermReply(i: ChatInputCommandInteraction, permName: string) {
  return i.reply({ content: `You need the **${permName}** permission to use this command.`, ephemeral: true });
}

export const confirmButtons = (yesId: string, noId: string) =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(yesId).setLabel("Confirm").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(noId).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  );
