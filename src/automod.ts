import { ChannelType, EmbedBuilder, PermissionFlagsBits, type Message, type TextChannel } from "discord.js";
import { getGuildConfig } from "./store";
import { COLORS } from "./util";

const INVITE_RE = /(?:discord\.gg|discord\.com\/invite|discordapp\.com\/invite)\/[a-z0-9-]+/i;
const LINK_RE = /https?:\/\/[^\s]+/i;

/** Lightweight Dyno-style auto-moderation for guild messages. Runs only when enabled for the server. */
export async function runAutomod(msg: Message): Promise<boolean> {
  if (msg.author.bot || !msg.guild || !msg.content) return false;
  const cfg = getGuildConfig(msg.guild.id);
  const am = cfg.automod;
  if (!am.enabled) return false;

  const member = msg.member ?? (await msg.guild.members.fetch(msg.author.id).catch(() => null));
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.ManageMessages) || member.permissions.has(PermissionFlagsBits.Administrator)) {
    return false;
  }
  if (am.exemptRoleIds.some((id) => member.roles.cache.has(id))) return false;

  let violation: string | null = null;
  const text = msg.content;

  if (am.blockedWords.length) {
    const lower = text.toLowerCase();
    const hit = am.blockedWords.find((w) => w && lower.includes(w.toLowerCase()));
    if (hit) violation = `Blocked word (${hit})`;
  }

  if (!violation && am.antiInvite && INVITE_RE.test(text)) {
    violation = "Discord server invite link";
  }

  if (!violation && am.antiLinks && LINK_RE.test(text)) {
    violation = "External link not allowed";
  }

  if (!violation && am.maxMentions > 0) {
    const mentionCount = msg.mentions.users.size + msg.mentions.roles.size + (msg.mentions.everyone ? 1 : 0);
    if (mentionCount >= am.maxMentions) {
      violation = `Mass mentions (${mentionCount})`;
    }
  }

  if (!violation && am.capsPercent > 0 && text.length >= 12) {
    const letters = text.replace(/[^a-zA-Z]/g, "");
    if (letters.length >= 8) {
      const upper = letters.replace(/[^A-Z]/g, "").length;
      const pct = Math.round((upper / letters.length) * 100);
      if (pct >= am.capsPercent) violation = `Excessive caps (${pct}%)`;
    }
  }

  if (!violation) return false;

  await msg.delete().catch(() => undefined);
  if ('send' in msg.channel) {
    const warnReply = await (msg.channel as TextChannel)
      .send({ content: `<@${msg.author.id}>, your message was removed (${violation}).` })
      .catch(() => null);
    if (warnReply) setTimeout(() => void warnReply.delete().catch(() => undefined), 6000);
  }

  if (cfg.modLogChannelId) {
    const logCh = msg.guild.channels.cache.get(cfg.modLogChannelId) as TextChannel | undefined;
    if (logCh?.type === ChannelType.GuildText) {
      await logCh
        .send({
          embeds: [
            new EmbedBuilder()
              .setColor(COLORS.amber)
              .setTitle("AutoMod Action")
              .addFields(
                { name: "User", value: `${msg.author.username} (<@${msg.author.id}>)`, inline: true },
                { name: "Channel", value: `<#${msg.channel.id}>`, inline: true },
                { name: "Rule", value: violation, inline: true },
                { name: "Content", value: text.slice(0, 900) },
              )
              .setTimestamp(new Date()),
          ],
        })
        .catch(() => undefined);
    }
  }

  return true;
}
