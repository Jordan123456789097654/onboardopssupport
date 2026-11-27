import {
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { sendStaffReply } from "../modmail";
import { deleteTag, getGuildTags, getOpenTicketByThread, getTag, scheduleSave, upsertTag, type Tag } from "../store";
import { builtinTagByName } from "../builtin-tags";
import { COLORS, isStaffMember } from "../util";
import type { Command } from "./types";

function renderTagContent(raw: string, i: ChatInputCommandInteraction, targetUser?: { id: string; username: string } | null, ticketId?: string | null): string {
  return raw
    .replace(/\{user\}/gi, targetUser ? `<@${targetUser.id}>` : `<@${i.user.id}>`)
    .replace(/\{username\}/gi, targetUser?.username ?? i.user.username)
    .replace(/\{server\}/gi, i.guild?.name ?? "Server")
    .replace(/\{staff\}/gi, i.user.username)
    .replace(/\{ticket_id\}/gi, ticketId ?? "N/A");
}

const tag: Command = {
  json: new SlashCommandBuilder()
    .setName("tag")
    .setDescription("Send, create, edit, or manage custom response tags")
    .addSubcommand((s) =>
      s
        .setName("send")
        .setDescription("Send a tag (if used in a Modmail ticket thread, sends it to the user's DM)")
        .addStringOption((o) => o.setName("name").setDescription("Tag name").setRequired(true).setAutocomplete(true))
        .addUserOption((o) => o.setName("mention").setDescription("Optional member to mention or substitute {user}")),
    )
    .addSubcommand((s) =>
      s
        .setName("create")
        .setDescription("Create a new tag (supports {user}, {username}, {server}, {staff}, {ticket_id})")
        .addStringOption((o) => o.setName("name").setDescription("Short tag name (e.g. refund, rules, invite)").setRequired(true).setMaxLength(40))
        .addStringOption((o) => o.setName("content").setDescription("Message content").setRequired(true).setMaxLength(1800))
        .addStringOption((o) => o.setName("category").setDescription("Optional category label").setMaxLength(40))
        .addBooleanOption((o) => o.setName("embed").setDescription("Send as an embed when used in regular channels")),
    )
    .addSubcommand((s) =>
      s
        .setName("edit")
        .setDescription("Edit an existing tag")
        .addStringOption((o) => o.setName("name").setDescription("Tag name").setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName("content").setDescription("New content").setRequired(true).setMaxLength(1800))
        .addBooleanOption((o) => o.setName("embed").setDescription("Send as an embed when used in regular channels")),
    )
    .addSubcommand((s) =>
      s
        .setName("delete")
        .setDescription("Delete a tag")
        .addStringOption((o) => o.setName("name").setDescription("Tag name").setRequired(true).setAutocomplete(true)),
    )
    .addSubcommand((s) => s.setName("list").setDescription("List all tags on this server"))
    .addSubcommand((s) =>
      s
        .setName("info")
        .setDescription("Show details about a tag")
        .addStringOption((o) => o.setName("name").setDescription("Tag name").setRequired(true).setAutocomplete(true)),
    )
    .setDMPermission(false)
    .toJSON(),

  async autocomplete(i) {
    if (!i.guildId) {
      await i.respond([]);
      return;
    }
    const typed = i.options.getFocused().toLowerCase();
    const matches = getGuildTags(i.guildId)
      .filter((t) => t.name.includes(typed) || (t.category?.toLowerCase().includes(typed) ?? false) || t.content.toLowerCase().includes(typed))
      .slice(0, 25)
      .map((t) => ({
        name: t.category ? `${t.name} [${t.category}] (${t.uses} uses)` : `${t.name} (${t.uses} uses)`,
        value: t.name,
      }));
    await i.respond(matches).catch(() => undefined);
  },

  async run(i) {
    const guild = i.guild!;
    const sub = i.options.getSubcommand();
    const member = await guild.members.fetch(i.user.id).catch(() => null);
    const canEditTags =
      !!member &&
      (member.permissions.has(PermissionFlagsBits.ManageMessages) ||
        member.permissions.has(PermissionFlagsBits.ManageGuild) ||
        isStaffMember(member, guild));

    if (sub === "list") {
      const list = getGuildTags(guild.id);
      if (list.length === 0) {
        await i.reply({ content: "No tags yet. Create one with `/tag create`.", ephemeral: true });
        return;
      }
      const lines = list.slice(0, 40).map((t) => `• \`${t.name}\`${t.category ? ` [${t.category}]` : ""} — ${t.uses} use${t.uses === 1 ? "" : "s"}`);
      await i.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.blue)
            .setTitle(`Tags in ${guild.name} (${list.length})`)
            .setDescription(lines.join("\n")),
        ],
        ephemeral: true,
      });
      return;
    }

    if (sub === "info") {
      const name = i.options.getString("name", true);
      const t = getTag(guild.id, name);
      if (!t) {
        await i.reply({ content: `Tag \`${name}\` not found.`, ephemeral: true });
        return;
      }
      await i.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.blue)
            .setTitle(`Tag: ${t.name}`)
            .addFields(
              { name: "Author", value: `<@${t.authorId}>`, inline: true },
              { name: "Uses", value: String(t.uses), inline: true },
              { name: "Category", value: t.category ?? "None", inline: true },
              { name: "Content", value: t.content.slice(0, 1000) },
            )
            .setTimestamp(new Date(t.updatedAt)),
        ],
        ephemeral: true,
      });
      return;
    }

    if (sub === "create") {
      if (!canEditTags) {
        await i.reply({ content: "You need Manage Messages (or staff role) to create tags.", ephemeral: true });
        return;
      }
      const rawName = i.options.getString("name", true).trim().toLowerCase().replace(/\s+/g, "-");
      if (!/^[a-z0-9_-]{1,40}$/.test(rawName)) {
        await i.reply({ content: "Tag name must use letters, numbers, `-`, or `_` only.", ephemeral: true });
        return;
      }
      if (getTag(guild.id, rawName)) {
        await i.reply({ content: `Tag \`${rawName}\` already exists. Use \`/tag edit\` instead.`, ephemeral: true });
        return;
      }
      const now = Date.now();
      upsertTag({
        guildId: guild.id,
        name: rawName,
        content: i.options.getString("content", true),
        category: i.options.getString("category")?.trim() || null,
        embed: i.options.getBoolean("embed") ?? false,
        authorId: i.user.id,
        uses: 0,
        createdAt: now,
        updatedAt: now,
      });
      await i.reply({ content: `Tag \`${rawName}\` created. Use \`/tag send ${rawName}\` anywhere (including Modmail tickets!).`, ephemeral: true });
      return;
    }

    if (sub === "edit") {
      if (!canEditTags) {
        await i.reply({ content: "You need Manage Messages (or staff role) to edit tags.", ephemeral: true });
        return;
      }
      const name = i.options.getString("name", true);
      const t = getTag(guild.id, name);
      if (!t) {
        await i.reply({ content: `Tag \`${name}\` not found.`, ephemeral: true });
        return;
      }
      t.content = i.options.getString("content", true);
      const emb = i.options.getBoolean("embed");
      if (emb !== null) t.embed = emb;
      t.updatedAt = Date.now();
      upsertTag(t);
      await i.reply({ content: `Updated tag \`${t.name}\`.`, ephemeral: true });
      return;
    }

    if (sub === "delete") {
      if (!canEditTags) {
        await i.reply({ content: "You need Manage Messages (or staff role) to delete tags.", ephemeral: true });
        return;
      }
      const name = i.options.getString("name", true);
      if (!deleteTag(guild.id, name)) {
        await i.reply({ content: `Tag \`${name}\` not found.`, ephemeral: true });
        return;
      }
      await i.reply({ content: `Deleted tag \`${name.trim().toLowerCase()}\`.`, ephemeral: true });
      return;
    }

    if (sub === "send") {
      const name = i.options.getString("name", true);
      const ticket = getOpenTicketByThread(i.channelId);
      // Built-in tags work in any channel. Inside a Modmail ticket they go to the customer.
      const builtin = builtinTagByName(name);
      const t = getTag(guild.id, name) ?? (builtin ? ({ guildId: guild.id, name: builtin.name, content: builtin.content, category: builtin.category, embed: false, authorId: "builtin", uses: 0, createdAt: 0, updatedAt: 0 } as unknown as Tag) : undefined);
      if (!t) {
        await i.reply({ content: `Tag \`${name}\` not found.`, ephemeral: true });
        return;
      }

      if (ticket) {
        if (!isStaffMember(member, guild)) {
          await i.reply({ content: "Only staff can send tags in Modmail tickets.", ephemeral: true });
          return;
        }
        await i.deferReply({ ephemeral: true });
        const target = await i.client.users.fetch(ticket.userId).catch(() => null);
        const rendered = renderTagContent(t.content, i, target ? { id: target.id, username: target.username } : { id: ticket.userId, username: ticket.username }, ticket.id);
        const ok = await sendStaffReply(i.client, guild, ticket, i.user, rendered);
        if (!ok) {
          await i.editReply("Could not DM the user (they may have DMs disabled).");
          return;
        }
        t.uses++;
        scheduleSave();
        await i.editReply({ content: "Sent to the customer." });
        return;
      }

      const mention = i.options.getUser("mention");
      const rendered = renderTagContent(t.content, i, mention ? { id: mention.id, username: mention.username } : null, null);
      t.uses++;
      scheduleSave();

      // Post the tag as a normal message in the channel, so it doesn't show as a command reply.
      // Only a private confirmation is sent back to the person who ran it.
      await i.reply({ content: "Sent.", ephemeral: true });
      const channel = i.channel;
      if (channel && channel.isSendable()) {
        const body = t.embed
          ? { content: mention ? `<@${mention.id}>` : undefined, embeds: [new EmbedBuilder().setColor(COLORS.blue).setDescription(rendered)] }
          : { content: mention ? `<@${mention.id}> ${rendered}` : rendered };
        await channel.send({ ...body, allowedMentions: mention ? { users: [mention.id] } : { parse: [] } });
      }
    }
  },
};

export const tagCommands: Command[] = [tag];
