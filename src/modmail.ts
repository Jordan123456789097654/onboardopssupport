import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  StringSelectMenuBuilder,
  type ButtonInteraction,
  type Client,
  type Guild,
  type Message,
  type StringSelectMenuInteraction,
  type TextChannel,
  type ThreadChannel,
  type User,
} from "discord.js";
import {
  appendTicketMessage,
  createTicketRecord,
  getConfiguredModmailGuilds,
  getGuildConfig,
  getOpenTicketByThread,
  getOpenTicketByUser,
  getAllTickets,
  getTicketById,
  getTicketsDueForClose,
  scheduleSave,
  type GuildConfig,
  type ModmailCategory,
  type Ticket,
} from "./store";
import { COLORS, formatDuration, isStaffMember } from "./util";

const pendingInitialText = new Map<string, { text: string; files: string[]; at: number }>();
const pendingPrompts = new Map<string, number>();

function cleanupPending() {
  const cutoff = Date.now() - 15 * 60_000;
  for (const [k, v] of pendingInitialText) if (v.at < cutoff) pendingInitialText.delete(k);
  for (const [k, at] of pendingPrompts) if (at < cutoff) pendingPrompts.delete(k);
}

const brandOf = (guild: Guild, cfg: GuildConfig) => cfg.brandName?.trim() || guild.name;
const footerOf = (guild: Guild, cfg: GuildConfig) => cfg.brandFooter?.trim() || `${brandOf(guild, cfg)} | Support`;

function ticketControlRow(ticketId: string, claimed: boolean) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`mmbtn:claim:${ticketId}`)
      .setLabel(claimed ? "Claimed" : "Claim")
      .setStyle(claimed ? ButtonStyle.Success : ButtonStyle.Primary)
      .setDisabled(claimed),
    new ButtonBuilder().setCustomId(`mmbtn:transfer:${ticketId}`).setLabel("Transfer").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`mmbtn:resolve:${ticketId}`).setLabel("Resolve (2h)").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`mmbtn:close:${ticketId}`).setLabel("Close Now").setStyle(ButtonStyle.Danger),
  );
}

function buildCategorySelect(guildId: string, nonce: string, categories: ModmailCategory[]) {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`mm:cat:${guildId}:${nonce}`)
      .setPlaceholder("Select an option to contact the staff team...")
      .addOptions(
        categories.slice(0, 25).map((c) => ({
          label: c.label.slice(0, 100),
          description: (c.description || "Contact staff").slice(0, 100),
          value: c.id.slice(0, 100),
          emoji: c.emoji || undefined,
        })),
      ),
  );
}

async function findMutualConfiguredGuilds(client: Client, userId: string): Promise<{ guild: Guild; cfg: GuildConfig }[]> {
  const configured = getConfiguredModmailGuilds();
  const out: { guild: Guild; cfg: GuildConfig }[] = [];
  for (const cfg of configured) {
    const guild = client.guilds.cache.get(cfg.guildId);
    if (!guild) continue;
    const member = guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null));
    if (member) out.push({ guild, cfg });
  }
  return out;
}

/* ---------------- Incoming DM from a user ---------------- */

export async function handleDirectMessage(client: Client, msg: Message): Promise<void> {
  if (msg.author.bot || msg.channel.type !== ChannelType.DM) return;
  cleanupPending();

  const existing = getOpenTicketByUser(msg.author.id);
  if (existing) {
    await relayUserMessageToTicket(client, existing, msg);
    return;
  }

  // Prevent spam opening multiple menus within a few seconds
  const lastPrompt = pendingPrompts.get(msg.author.id) ?? 0;
  if (Date.now() - lastPrompt < 4000) return;

  const mutual = await findMutualConfiguredGuilds(client, msg.author.id);
  if (mutual.length === 0) {
    await msg.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.amber)
          .setDescription("Modmail is not configured on any server we share yet. Ask a server admin to run `/modmail-config channel` first."),
      ],
    });
    return;
  }

  const nonce = Math.random().toString(36).slice(2, 10);
  const files = [...msg.attachments.values()].map((a) => a.url);
  if (msg.content.trim() || files.length) {
    pendingInitialText.set(`${msg.author.id}:${nonce}`, { text: msg.content.trim(), files, at: Date.now() });
  }
  pendingPrompts.set(msg.author.id, Date.now());

  if (mutual.length === 1) {
    const { guild, cfg } = mutual[0];
    if (cfg.blacklistedUserIds.includes(msg.author.id)) {
      await msg.reply({
        embeds: [new EmbedBuilder().setColor(COLORS.red).setDescription(`You are currently blocked from opening Modmail tickets in **${brandOf(guild, cfg)}**.`)],
      });
      return;
    }
    await msg.channel.send({
      embeds: [new EmbedBuilder().setColor(COLORS.green).setDescription("Please select an option.")],
      components: [buildCategorySelect(guild.id, nonce, cfg.modmailCategories)],
    });
    return;
  }

  const guildRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`mm:guild:${nonce}`)
      .setPlaceholder("Select a server to contact...")
      .addOptions(
        mutual.slice(0, 25).map(({ guild, cfg }) => ({
          label: brandOf(guild, cfg).slice(0, 100),
          description: `Open a support ticket in ${guild.name}`.slice(0, 100),
          value: guild.id,
        })),
      ),
  );

  await msg.channel.send({
    embeds: [new EmbedBuilder().setColor(COLORS.green).setDescription("Please select a server to contact.")],
    components: [guildRow],
  });
}

/* ---------------- DM Select Menus ---------------- */

export async function handleModmailSelect(client: Client, i: StringSelectMenuInteraction): Promise<void> {
  const parts = i.customId.split(":");
  const kind = parts[1];

  if (kind === "guild") {
    const nonce = parts[2];
    const guildId = i.values[0];
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      await i.update({ embeds: [new EmbedBuilder().setColor(COLORS.red).setDescription("That server is no longer available.")], components: [] });
      return;
    }
    const cfg = getGuildConfig(guild.id);
    if (cfg.blacklistedUserIds.includes(i.user.id)) {
      await i.update({
        embeds: [new EmbedBuilder().setColor(COLORS.red).setDescription(`You are currently blocked from opening Modmail tickets in **${brandOf(guild, cfg)}**.`)],
        components: [],
      });
      return;
    }
    await i.update({
      embeds: [new EmbedBuilder().setColor(COLORS.green).setDescription("Please select an option.")],
      components: [buildCategorySelect(guild.id, nonce, cfg.modmailCategories)],
    });
    return;
  }

  if (kind === "cat") {
    const guildId = parts[2];
    const nonce = parts[3];
    const catId = i.values[0];
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      await i.update({ embeds: [new EmbedBuilder().setColor(COLORS.red).setDescription("That server is no longer available.")], components: [] });
      return;
    }
    const cfg = getGuildConfig(guild.id);
    const cat = cfg.modmailCategories.find((c) => c.id === catId) ?? cfg.modmailCategories[0];
    if (!cat) {
      await i.update({ embeds: [new EmbedBuilder().setColor(COLORS.red).setDescription("No Modmail categories are configured.")], components: [] });
      return;
    }

    const existing = getOpenTicketByUser(i.user.id, guild.id);
    if (existing) {
      await i.update({
        embeds: [new EmbedBuilder().setColor(COLORS.amber).setDescription(`You already have an open ticket (**#${existing.id}**). Just send your message here!`)],
        components: [],
      });
      return;
    }

    await i.update({
      embeds: [new EmbedBuilder().setColor(COLORS.green).setDescription(`You selected: ${cat.label}`)],
      components: [],
    });

    const initial = pendingInitialText.get(`${i.user.id}:${nonce}`);
    pendingInitialText.delete(`${i.user.id}:${nonce}`);
    await openTicket(guild, cfg, i.user, cat, initial);
    return;
  }

  if (kind === "transfer") {
    const ticketId = parts[2];
    if (!i.guild) return;
    const member = await i.guild.members.fetch(i.user.id).catch(() => null);
    if (!isStaffMember(member, i.guild)) {
      await i.reply({ content: "Only staff can transfer tickets.", ephemeral: true });
      return;
    }
    const ticket = getOpenTicketByThread(i.channelId);
    if (!ticket || ticket.id !== ticketId) {
      await i.reply({ content: "This ticket is no longer open.", ephemeral: true });
      return;
    }
    const catId = i.values[0];
    const res = await transferTicket(i.guild, ticket, { categoryId: catId, actor: i.user });
    await i.update({ content: res.message, components: [] });
  }
}

/* ---------------- Per-category channels ---------------- */

const slugOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "tickets";

/**
 * Makes one Discord category per Modmail category ("Modmail · General Questions") with a tickets channel inside it.
 * Existing ones are reused by name, so running it twice is safe. Returns what changed.
 */
export async function ensureCategoryChannels(guild: Guild, cfg: GuildConfig): Promise<{ created: string[]; ready: string[]; failed: string[] }> {
  const out = { created: [] as string[], ready: [] as string[], failed: [] as string[] };
  for (const cat of cfg.modmailCategories) {
    const existing = cat.channelId ? guild.channels.cache.get(cat.channelId) : undefined;
    if (existing?.type === ChannelType.GuildText) {
      // Keep names in line with the label, so renamed categories update in Discord too.
      const wantChannel = `tickets-${slugOf(cat.label)}`;
      const wantParent = `Modmail · ${cat.label}`.slice(0, 100);
      if (existing.name !== wantChannel) await existing.setName(wantChannel).catch(() => undefined);
      const parent = existing.parent;
      if (parent && parent.name !== wantParent) await parent.setName(wantParent).catch(() => undefined);
      out.ready.push(cat.label);
      continue;
    }
    try {
      const catName = `Modmail · ${cat.label}`.slice(0, 100);
      let parent = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === catName);
      if (!parent) {
        parent = await guild.channels.create({ name: catName, type: ChannelType.GuildCategory, reason: "Modmail category" });
      }
      const chName = `tickets-${slugOf(cat.label)}`;
      let ch = guild.channels.cache.find(
        (c): c is TextChannel => c.type === ChannelType.GuildText && c.name === chName && c.parentId === parent!.id,
      );
      if (!ch) {
        ch = await guild.channels.create({
          name: chName,
          type: ChannelType.GuildText,
          parent: parent.id,
          topic: `Support tickets for ${cat.label}. Each ticket is a thread in this channel.`,
          reason: "Modmail category channel",
        });
      }
      cat.channelId = ch.id;
      out.created.push(cat.label);
    } catch (e) {
      console.error(`Could not set up channels for "${cat.label}":`, e instanceof Error ? e.message : e);
      out.failed.push(cat.label);
    }
  }
  scheduleSave();
  return out;
}

/* ---------------- Open Ticket ---------------- */

export async function openTicket(
  guild: Guild,
  cfg: GuildConfig,
  user: User,
  cat: ModmailCategory,
  initial?: { text: string; files: string[] },
): Promise<Ticket | null> {
  // Each Modmail category gets its own tickets channel. Set them up on first use if they are missing.
  if (!cat.channelId || guild.channels.cache.get(cat.channelId)?.type !== ChannelType.GuildText) {
    await ensureCategoryChannels(guild, cfg);
  }
  const inbox = (cat.channelId ? guild.channels.cache.get(cat.channelId) : undefined) ??
    (cfg.modmailChannelId ? guild.channels.cache.get(cfg.modmailChannelId) : undefined);
  if (!inbox || inbox.type !== ChannelType.GuildText) {
    await user.send({
      embeds: [new EmbedBuilder().setColor(COLORS.red).setDescription("Modmail inbox channel is missing or invalid. Please contact a server admin.")],
    }).catch(() => undefined);
    return null;
  }

  const brand = brandOf(guild, cfg);
  const icon = guild.iconURL() ?? undefined;
  const member = await guild.members.fetch(user.id).catch(() => null);

  const nextNum = cfg.nextTicketNumber;
  const safeUser = user.username.toLowerCase().replace(/[^a-z0-9-_]/g, "").slice(0, 18) || "user";
  const threadName = `${cat.emoji || "📩"}-${safeUser}-${nextNum}`.slice(0, 95);

  const thread = await inbox.threads.create({
    name: threadName,
    autoArchiveDuration: 10080, // 7 days
    reason: `Modmail ticket for ${user.username}`,
  });

  const ticket = createTicketRecord({
    guildId: guild.id,
    userId: user.id,
    username: user.username,
    userAvatar: user.displayAvatarURL(),
    threadId: thread.id,
    parentChannelId: inbox.id,
    categoryId: cat.id,
    categoryLabel: cat.label,
    categoryEmoji: cat.emoji,
    claimedById: null,
    status: "open",
    closeAt: null,
    createdAt: Date.now(),
    closedAt: null,
    closedById: null,
    messages: [],
  });

  const roles = member
    ? [...member.roles.cache.values()]
        .filter((r) => r.id !== guild.id)
        .sort((a, b) => b.position - a.position)
        .slice(0, 8)
        .map((r) => r.toString())
        .join(" ") || "None"
    : "Not in server";

  const staffEmbed = new EmbedBuilder()
    .setColor(COLORS.green)
    .setAuthor({ name: `${user.username} (${user.id})`, iconURL: user.displayAvatarURL() })
    .setTitle(`Ticket #${ticket.id} — ${cat.emoji} ${cat.label}`)
    .setDescription(
      [
        `Type directly in this thread (or use \`/reply\`) to message the user.`,
        `Prefix with \`//\` for internal staff notes, or use \`/note\`, \`/tag send\`, \`/transfer\`, \`/resolve\`, \`/close\`.`,
      ].join("\n"),
    )
    .addFields(
      { name: "User", value: `<@${user.id}>`, inline: true },
      { name: "Category", value: `${cat.emoji} ${cat.label}`, inline: true },
      { name: "Account Created", value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
      { name: "Joined Server", value: member?.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : "Unknown", inline: true },
      { name: "Roles", value: roles },
    )
    .setTimestamp(new Date());

  const pingRoleId = cat.staffRoleId || cfg.modmailStaffRoleId;
  await thread.send({
    content: pingRoleId ? `<@&${pingRoleId}> New Modmail ticket opened.` : undefined,
    embeds: [staffEmbed],
    components: [ticketControlRow(ticket.id, false)],
  });

  // DM confirmation embed matching Screenshot 1
  const dmEmbed = new EmbedBuilder()
    .setColor(COLORS.green)
    .setTitle("Ticket opened")
    .setDescription(
      [
        `**Hello! Welcome to ${brand} Support.**`,
        `Thanks for reaching out. Your message is with our team, and a member of staff will introduce themselves here as soon as they pick it up.`,
        "",
        `> Tip: the more detail you give us (screenshots, error messages, order info), the faster we can help.`,
      ].join("\n"),
    )
    .setFooter({ text: footerOf(guild, cfg), iconURL: icon })
    .setTimestamp(new Date());

  await user.send({ embeds: [dmEmbed] }).catch(() => undefined);

  if (initial && (initial.text || initial.files.length)) {
    const body = [initial.text, ...initial.files].filter(Boolean).join("\n");
    appendTicketMessage(ticket, {
      at: Date.now(),
      authorId: user.id,
      authorName: user.username,
      authorAvatar: user.displayAvatarURL(),
      role: "user",
      content: initial.text || (initial.files.length ? "*Sent attachment(s)*" : ""),
      attachments: initial.files,
    });
    const userMsgEmbed = new EmbedBuilder()
      .setColor(COLORS.blue)
      .setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
      .setDescription(initial.text || "*Attachment(s) sent*")
      .setFooter({ text: `Ticket #${ticket.id} • ${cat.label}` })
      .setTimestamp(new Date());
    await thread.send({
      embeds: [userMsgEmbed],
      files: initial.files.slice(0, 5),
    });
  }

  const openLogCh = (cat.channelId ? guild.channels.cache.get(cat.channelId) : undefined) ?? (cfg.modmailLogChannelId ? guild.channels.cache.get(cfg.modmailLogChannelId) : undefined);
  if (openLogCh) {
    const logCh = openLogCh as TextChannel;
    if (logCh?.type === ChannelType.GuildText) {
      await logCh
        .send({
          embeds: [
            new EmbedBuilder()
              .setColor(COLORS.green)
              .setTitle(`Ticket #${ticket.id} Opened`)
              .addFields(
                { name: "User", value: `${user.username} (<@${user.id}>)`, inline: true },
                { name: "Category", value: `${cat.emoji} ${cat.label}`, inline: true },
                { name: "Thread", value: `<#${thread.id}>`, inline: true },
              )
              .setTimestamp(new Date()),
          ],
        })
        .catch(() => undefined);
    }
  }

  return ticket;
}

/* ---------------- Message Relays ---------------- */

export async function relayUserMessageToTicket(client: Client, ticket: Ticket, msg: Message): Promise<void> {
  const guild = client.guilds.cache.get(ticket.guildId);
  if (!guild) return;
  const thread = (guild.channels.cache.get(ticket.threadId) ??
    (await guild.channels.fetch(ticket.threadId).catch(() => null))) as ThreadChannel | null;
  if (!thread || !thread.isThread()) {
    ticket.status = "closed";
    ticket.closedAt = Date.now();
    scheduleSave();
    await msg.reply("Your previous ticket thread was removed. Send another message to open a new ticket.").catch(() => undefined);
    return;
  }

  if (ticket.status === "resolving" && ticket.closeAt !== null) {
    ticket.status = "open";
    ticket.closeAt = null;
    scheduleSave();
    await thread
      .send({
        embeds: [new EmbedBuilder().setColor(COLORS.amber).setDescription(`🔄 **Auto-close cancelled** — <@${msg.author.id}> sent a new message.`)],
      })
      .catch(() => undefined);
  }

  const files = [...msg.attachments.values()].map((a) => a.url);
  const body = [msg.content.trim(), ...files].filter(Boolean).join("\n") || "*Empty message*";
  appendTicketMessage(ticket, {
    at: Date.now(),
    authorId: msg.author.id,
    authorName: msg.author.username,
    authorAvatar: msg.author.displayAvatarURL(),
    role: "user",
    content: msg.content.trim() || (files.length ? "*Sent attachment(s)*" : ""),
    attachments: files,
  });

  const embed = new EmbedBuilder()
    .setColor(COLORS.blue)
    .setAuthor({ name: msg.author.username, iconURL: msg.author.displayAvatarURL() })
    .setDescription(msg.content.trim() || "*Attachment(s) sent*")
    .setFooter({ text: `Ticket #${ticket.id} • ${ticket.categoryLabel}` })
    .setTimestamp(new Date());

  await thread.send({ embeds: [embed], files: files.slice(0, 5) }).catch(() => undefined);
  await msg.react("✅").catch(() => undefined);
}

/** Handles staff typing directly in a Modmail ticket thread (when autoRelayThreadMessages is on). */
export async function handleStaffThreadMessage(client: Client, msg: Message): Promise<void> {
  if (msg.author.bot || !msg.guild || !msg.channel.isThread()) return;
  if (msg.content.startsWith("//") || msg.content.toLowerCase().startsWith("!note")) return;

  const ticket = getOpenTicketByThread(msg.channel.id);
  if (!ticket) return;

  const cfg = getGuildConfig(msg.guild.id);
  if (!cfg.autoRelayThreadMessages) return;

  const member = msg.member ?? (await msg.guild.members.fetch(msg.author.id).catch(() => null));
  if (!isStaffMember(member, msg.guild)) return;

  const files = [...msg.attachments.values()].map((a) => a.url);
  if (!msg.content.trim() && files.length === 0) return;

  const ok = await sendStaffReply(client, msg.guild, ticket, msg.author, msg.content.trim(), files, cfg.anonymousStaff);
  if (ok) await msg.react("✅").catch(() => undefined);
  else await msg.react("❌").catch(() => undefined);
}

/** Sends a staff reply embed to the user's DM (matching Screenshot 2). */
export async function sendStaffReply(
  client: Client,
  guild: Guild,
  ticket: Ticket,
  staff: User,
  text: string,
  files: string[] = [],
  anonymous = false,
): Promise<boolean> {
  const cfg = getGuildConfig(guild.id);
  const brand = brandOf(guild, cfg);
  const icon = guild.iconURL() ?? undefined;
  const user = await client.users.fetch(ticket.userId).catch(() => null);
  if (!user) return false;

  const dmEmbed = new EmbedBuilder()
    .setColor(COLORS.green)
    .setAuthor({
      name: anonymous ? `${brand} Support` : staff.username,
      iconURL: anonymous ? icon : staff.displayAvatarURL(),
    })
    .setDescription(text || "*Attachment(s) sent*")
    .setFooter({ text: `${brand} Support`, iconURL: icon })
    .setTimestamp(new Date());

  try {
    await user.send({ embeds: [dmEmbed], files: files.slice(0, 5) });
    appendTicketMessage(ticket, {
      at: Date.now(),
      authorId: staff.id,
      authorName: anonymous ? `${brand} Support` : staff.username,
      authorAvatar: anonymous ? (icon ?? null) : staff.displayAvatarURL(),
      role: "staff",
      content: text || (files.length ? "*Sent attachment(s)*" : ""),
      attachments: files,
    });
    return true;
  } catch {
    return false;
  }
}

/* ---------------- Transfer, Resolve (delayed), Close ---------------- */

export async function transferTicket(
  guild: Guild,
  ticket: Ticket,
  opts: {
    categoryId?: string | null;
    staffUser?: User | null;
    roleId?: string | null;
    reason?: string | null;
    notifyUser?: boolean;
    actor: User;
  },
): Promise<{ ok: boolean; message: string }> {
  const cfg = getGuildConfig(guild.id);
  const thread = (guild.channels.cache.get(ticket.threadId) ??
    (await guild.channels.fetch(ticket.threadId).catch(() => null))) as ThreadChannel | null;

  const changes: string[] = [];
  const pings: string[] = [];

  if (opts.categoryId) {
    const nextCat = cfg.modmailCategories.find(
      (c) => c.id.toLowerCase() === opts.categoryId!.toLowerCase() || c.label.toLowerCase() === opts.categoryId!.toLowerCase(),
    );
    if (!nextCat) return { ok: false, message: `Unknown category \`${opts.categoryId}\`.` };
    ticket.categoryId = nextCat.id;
    ticket.categoryLabel = nextCat.label;
    ticket.categoryEmoji = nextCat.emoji;
    changes.push(`Category → **${nextCat.emoji} ${nextCat.label}**`);
    if (nextCat.staffRoleId) pings.push(`<@&${nextCat.staffRoleId}>`);
    if (thread?.isThread()) {
      const safeUser = ticket.username.toLowerCase().replace(/[^a-z0-9-_]/g, "").slice(0, 18) || "user";
      await thread.setName(`${nextCat.emoji || "📩"}-${safeUser}-${ticket.id}`.slice(0, 95)).catch(() => undefined);
    }
  }

  if (opts.staffUser) {
    ticket.claimedById = opts.staffUser.id;
    changes.push(`Assigned to <@${opts.staffUser.id}>`);
    pings.push(`<@${opts.staffUser.id}>`);
  }

  if (opts.roleId) {
    changes.push(`Escalated to <@&${opts.roleId}>`);
    pings.push(`<@&${opts.roleId}>`);
  }

  if (changes.length === 0) {
    return { ok: false, message: "Specify a category, staff member, or role to transfer this ticket to." };
  }

  scheduleSave();
  appendTicketMessage(ticket, {
    at: Date.now(),
    authorId: opts.actor.id,
    authorName: opts.actor.username,
    role: "system",
    content: `Transferred by ${opts.actor.username}: ${changes.join(", ")}${opts.reason ? ` (${opts.reason})` : ""}`,
  });

  if (thread?.isThread()) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.blue)
      .setTitle("Ticket Transferred")
      .setDescription(changes.join("\n"))
      .addFields(
        { name: "Transferred by", value: `<@${opts.actor.id}>`, inline: true },
        ...(opts.reason ? [{ name: "Reason", value: opts.reason, inline: true }] : []),
      )
      .setTimestamp(new Date());
    await thread.send({ content: pings.length ? pings.join(" ") : undefined, embeds: [embed] }).catch(() => undefined);
  }

  if (opts.notifyUser) {
    const user = await guild.client.users.fetch(ticket.userId).catch(() => null);
    if (user) {
      const brand = brandOf(guild, cfg);
      await user
        .send({
          embeds: [
            new EmbedBuilder()
              .setColor(COLORS.blue)
              .setDescription(`Your ticket has been transferred to **${ticket.categoryLabel}**. Someone from that team will follow up shortly.`)
              .setFooter({ text: footerOf(guild, cfg), iconURL: guild.iconURL() ?? undefined })
              .setTimestamp(new Date()),
          ],
        })
        .catch(() => undefined);
    }
  }

  return { ok: true, message: `Ticket #${ticket.id} transferred (${changes.join(", ")}).` };
}

/** Sends the green "ISSUE RESOLVED" DM with auto-close timer (matching Screenshot 3). */
export async function resolveTicketWithDelay(
  client: Client,
  guild: Guild,
  ticket: Ticket,
  actor: User,
  delayMs: number,
): Promise<void> {
  const cfg = getGuildConfig(guild.id);
  const brand = brandOf(guild, cfg);
  const icon = guild.iconURL() ?? undefined;
  const humanDelay = formatDuration(delayMs);

  ticket.status = "resolving";
  ticket.closeAt = Date.now() + delayMs;
  ticket.closeWarnedAt = null;
  scheduleSave();

  const user = await client.users.fetch(ticket.userId).catch(() => null);
  if (user) {
    const dmEmbed = new EmbedBuilder()
      .setColor(COLORS.green)
      .setAuthor({ name: brand, iconURL: icon })
      .setDescription(
        [
          `\`${brand.toUpperCase()} - ISSUE RESOLVED\``,
          `This ticket will close automatically in ${humanDelay}. If you still need help, just send a message and the closure will be cancelled. If you don't need anything else, there's no need to reply.`,
          "",
          `Once it's closed, you're always welcome to open a new ticket in the future!`,
          "",
          `Thank you for contacting ${brand}!`,
        ].join("\n"),
      )
      .setFooter({ text: `${brand} Support`, iconURL: icon })
      .setTimestamp(new Date());
    await user.send({ embeds: [dmEmbed] }).catch(() => undefined);
  }

  const thread = (guild.channels.cache.get(ticket.threadId) ??
    (await guild.channels.fetch(ticket.threadId).catch(() => null))) as ThreadChannel | null;
  if (thread?.isThread()) {
    const unix = Math.floor(ticket.closeAt / 1000);
    await thread
      .send({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.green)
            .setDescription(`Marked resolved by <@${actor.id}>. Auto-closing <t:${unix}:R> unless the user replies.`),
        ],
      })
      .catch(() => undefined);
  }
}

/** Closes the ticket immediately, sends the red closed embed (matching Screenshot 4), posts transcript, and locks/archives. */
export async function closeTicketNow(
  client: Client,
  guild: Guild,
  ticket: Ticket,
  actor: User | null,
  opts: { reason?: string | null; silent?: boolean } = {},
): Promise<void> {
  if (ticket.status === "closed") return;
  const cfg = getGuildConfig(guild.id);
  const brand = brandOf(guild, cfg);
  const icon = guild.iconURL() ?? undefined;

  ticket.status = "closed";
  ticket.closeAt = null;
  ticket.closedAt = Date.now();
  ticket.closedById = actor?.id ?? client.user?.id ?? null;
  ticket.closeReason = opts.reason ?? null;
  const baseUrl = (process.env.BASE_URL?.trim() || "https://support.onboardops.org").replace(/\/+$/, "");
  const transcriptUrl = `${baseUrl}/transcript/${ticket.id}`;
  ticket.transcriptUrl = transcriptUrl;
  scheduleSave();

  if (!opts.silent) {
    const user = await client.users.fetch(ticket.userId).catch(() => null);
    if (user) {
      const dmEmbed = new EmbedBuilder()
        .setColor(COLORS.red)
        .setTitle("Ticket closed")
        .setDescription(
          opts.reason
            ? `This ticket has been closed by a member of our team.\n\n**Reason:** ${opts.reason}\n\nThank you for contacting ${brand}. If you have any further questions or concerns, don't hesitate to open another ticket. Have a great day!`
            : `This ticket has been successfully closed by a member of our team. We thank you for contacting ${brand}. If you have any further questions or concerns, don't hesitate to open another ticket. Have a great day!`,
        )
        .addFields({ name: "Online Transcript", value: `[View Full Web Transcript](${transcriptUrl})` })
        .setFooter({ text: footerOf(guild, cfg), iconURL: icon })
        .setTimestamp(new Date());
      await user.send({ embeds: [dmEmbed] }).catch(() => undefined);
    }
  }

  const lines = [
    `Modmail Transcript — Ticket #${ticket.id}`,
    `Server: ${guild.name} (${guild.id})`,
    `User: ${ticket.username} (${ticket.userId})`,
    `Category: ${ticket.categoryLabel}`,
    `Opened: ${new Date(ticket.createdAt).toISOString()}`,
    `Closed: ${new Date().toISOString()}${actor ? ` by ${actor.username}` : " (auto-closed)"}`,
    opts.reason ? `Reason: ${opts.reason}` : "",
    `Web Transcript: ${transcriptUrl}`,
    "------------------------------------------------------------",
    ...ticket.messages.flatMap((m) => {
      const who = m.role === "user" ? "Customer" : m.role === "staff" ? "Staff" : "System";
      return [
        `[${new Date(m.at).toISOString()}] [${who}] ${m.authorName}: ${m.content}`,
        ...(m.attachments ?? []).map((u) => `    Attachment: ${u}`),
      ];
    }),
  ]
    .filter(Boolean)
    .join("\n");

  const transcript = new AttachmentBuilder(Buffer.from(lines, "utf8"), {
    name: `ticket-${ticket.id}-${ticket.username.replace(/[^a-z0-9_-]/gi, "") || "user"}.txt`,
  });

  const closeCat = cfg.modmailCategories.find((c) => c.id === ticket.categoryId);
  const closeLogCh = (closeCat?.channelId ? guild.channels.cache.get(closeCat.channelId) : undefined) ?? (cfg.modmailLogChannelId ? guild.channels.cache.get(cfg.modmailLogChannelId) : undefined);
  if (closeLogCh) {
    const logCh = closeLogCh as TextChannel;
    if (logCh?.type === ChannelType.GuildText) {
      await logCh
        .send({
          embeds: [
            new EmbedBuilder()
              .setColor(COLORS.red)
              .setTitle(`Ticket #${ticket.id} Closed`)
              .addFields(
                { name: "User", value: `${ticket.username} (<@${ticket.userId}>)`, inline: true },
                { name: "Category", value: `${ticket.categoryEmoji} ${ticket.categoryLabel}`, inline: true },
                { name: "Closed by", value: actor ? `<@${actor.id}>` : "Auto-close", inline: true },
                ...(opts.reason ? [{ name: "Reason", value: opts.reason }] : []),
                { name: "Web Transcript", value: `[${transcriptUrl.replace(/^https?:\/\//, "")}](${transcriptUrl})`, inline: false },
              )
              .setTimestamp(new Date()),
          ],
          files: [transcript],
        })
        .catch(() => undefined);
    }
  }

  const thread = (guild.channels.cache.get(ticket.threadId) ??
    (await guild.channels.fetch(ticket.threadId).catch(() => null))) as ThreadChannel | null;
  if (thread?.isThread()) {
    await thread
      .send({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.red)
            .setDescription(`Ticket closed${actor ? ` by <@${actor.id}>` : " automatically"}.\n**Web Transcript:** [${transcriptUrl.replace(/^https?:\/\//, "")}](${transcriptUrl})\nThread locked & archived.`),
        ],
      })
      .catch(() => undefined);
    await thread.setLocked(true).catch(() => undefined);
    await thread.setArchived(true).catch(() => undefined);
  }
}

/* ---------------- Staff Thread Buttons ---------------- */

export async function handleModmailButton(client: Client, i: ButtonInteraction): Promise<void> {
  if (!i.guild) {
    await handleCustomerTicketButton(client, i);
    return;
  }
  const [, action, ticketId] = i.customId.split(":");
  const member = await i.guild.members.fetch(i.user.id).catch(() => null);
  if (!isStaffMember(member, i.guild)) {
    await i.reply({ content: "Only staff can manage Modmail tickets.", ephemeral: true });
    return;
  }

  const ticket = getOpenTicketByThread(i.channelId);
  if (!ticket || ticket.id !== ticketId) {
    await i.reply({ content: "This ticket is already closed.", ephemeral: true });
    return;
  }

  const cfg = getGuildConfig(i.guild.id);

  if (action === "claim") {
    ticket.claimedById = i.user.id;
    scheduleSave();
    await i.update({ components: [ticketControlRow(ticket.id, true)] });
    await i.followUp({ content: `Claimed by <@${i.user.id}>.` });
    await sendClaimGreeting(client, i.guild, ticket, i.user, member?.displayName ?? i.user.username);
    return;
  }

  if (action === "transfer") {
    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`mm:transfer:${ticket.id}`)
        .setPlaceholder("Choose a category to transfer this ticket to...")
        .addOptions(
          cfg.modmailCategories.slice(0, 25).map((c) => ({
            label: c.label.slice(0, 100),
            description: (c.description || "Transfer here").slice(0, 100),
            value: c.id,
            emoji: c.emoji || undefined,
          })),
        ),
    );
    await i.reply({ content: "Pick the destination category (or use `/transfer` for staff/role):", components: [row], ephemeral: true });
    return;
  }

  if (action === "resolve") {
    await i.deferReply({ ephemeral: true });
    await resolveTicketWithDelay(client, i.guild, ticket, i.user, cfg.defaultCloseDelayMinutes * 60_000);
    await i.editReply(`Sent resolution notice to user. Auto-closing in ${cfg.defaultCloseDelayMinutes} minutes unless they reply.`);
    return;
  }

  if (action === "close") {
    await i.deferReply({ ephemeral: true });
    await closeTicketNow(client, i.guild, ticket, i.user);
    await i.editReply(`Ticket #${ticket.id} closed.`);
  }
}

/* ---------------- Close requests, customer buttons, SLA and close warnings ---------------- */

const SLA_MS = 30 * 60_000;
const CLOSE_WARN_MS = 10 * 60_000;

function lastMessageAt(ticket: Ticket, role: "user" | "staff"): number | null {
  let last = 0;
  for (const m of ticket.messages) if (m.role === role && m.at > last) last = m.at;
  return last || null;
}

async function ticketThreadOf(guild: Guild, ticket: Ticket): Promise<ThreadChannel | null> {
  const t = (guild.channels.cache.get(ticket.threadId) ??
    (await guild.channels.fetch(ticket.threadId).catch(() => null))) as ThreadChannel | null;
  return t?.isThread() ? t : null;
}

/** Asks the customer to accept closing. They get Accept and Reject buttons in their DM. */
export async function requestCloseFromCustomer(
  client: Client,
  guild: Guild,
  ticket: Ticket,
  actor: User,
  reason: string | null,
): Promise<boolean> {
  const cfg = getGuildConfig(guild.id);
  const brand = brandOf(guild, cfg);
  const user = await client.users.fetch(ticket.userId).catch(() => null);
  if (!user) return false;
  const lines = [
    `**${actor.username}** from ${brand} wants to close this ticket.`,
    "Click **Accept** to close it now, or **Reject** if you still need help.",
    "",
    "The messages in this conversation will be archived for future reference.",
  ];
  if (reason) lines.push("", `**Note from the team:** ${reason}`);
  const embed = new EmbedBuilder()
    .setColor(COLORS.amber)
    .setTitle("Can this ticket be closed?")
    .setDescription(lines.join("\n"))
    .setFooter({ text: `${brand} Support`, iconURL: guild.iconURL() ?? undefined })
    .setTimestamp(new Date());
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`mmbtn:accept:${ticket.id}`).setLabel("Accept").setEmoji("✅").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`mmbtn:reject:${ticket.id}`).setLabel("Reject").setEmoji("❌").setStyle(ButtonStyle.Danger),
  );
  const sent = await user.send({ embeds: [embed], components: [row] }).catch(() => null);
  if (!sent) return false;
  ticket.closeRequestedAt = Date.now();
  scheduleSave();
  const thread = await ticketThreadOf(guild, ticket);
  await thread
    ?.send({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.amber)
          .setDescription(`Close request sent to the customer by <@${actor.id}>. Waiting for Accept or Reject. Use \`/close now:true\` to close straight away.`),
      ],
    })
    .catch(() => undefined);
  return true;
}

/** Buttons the customer presses in their DM: Accept or Reject a close request, or Keep open during an auto-close warning. */
async function handleCustomerTicketButton(client: Client, i: ButtonInteraction): Promise<void> {
  const [, action, ticketId] = i.customId.split(":");
  const ticket = getTicketById(ticketId);
  if (!ticket || ticket.userId !== i.user.id || ticket.status === "closed") {
    await i.reply({ content: "This ticket is already closed.", ephemeral: true }).catch(() => undefined);
    return;
  }
  const guild = client.guilds.cache.get(ticket.guildId);
  if (!guild) {
    await i.reply({ content: "That server is no longer available, so this ticket can't be changed.", ephemeral: true }).catch(() => undefined);
    return;
  }
  if (action === "accept") {
    await i.update({ components: [] }).catch(() => undefined);
    await closeTicketNow(client, guild, ticket, i.user, { reason: "Closed at the customer's request" });
    return;
  }
  if (action === "reject" || action === "keep") {
    ticket.closeRequestedAt = null;
    ticket.closeWarnedAt = null;
    if (ticket.status === "resolving") {
      ticket.status = "open";
      ticket.closeAt = null;
    }
    scheduleSave();
    await i.update({ components: [] }).catch(() => undefined);
    await i.followUp({ content: "Thanks. Your ticket stays open. Reply here any time.", ephemeral: true }).catch(() => undefined);
    const thread = await ticketThreadOf(guild, ticket);
    const note = action === "reject" ? " (rejected the close request)" : "";
    await thread
      ?.send({ embeds: [new EmbedBuilder().setColor(COLORS.green).setDescription(`🔄 The customer kept this ticket open${note}.`)] })
      .catch(() => undefined);
    return;
  }
  await i.reply({ content: "That button isn't valid.", ephemeral: true }).catch(() => undefined);
}

/**
 * Every minute: (1) tell the team when a customer has waited 30 minutes with no staff reply,
 * (2) warn the customer 10 minutes before an auto-close, with a Keep open button.
 */
export async function sweepSlaAndCloseWarnings(client: Client): Promise<void> {
  const now = Date.now();
  for (const ticket of getAllTickets()) {
    if (ticket.status === "closed") continue;
    const guild = client.guilds.cache.get(ticket.guildId);
    if (!guild) continue;

    if (ticket.status === "open") {
      const lastUser = lastMessageAt(ticket, "user");
      const lastStaff = lastMessageAt(ticket, "staff");
      if (lastUser !== null && (lastStaff === null || lastStaff < lastUser)) {
        const alreadyWarned = (ticket.slaWarnedAt ?? 0) >= lastUser;
        if (!alreadyWarned && now - lastUser >= SLA_MS) {
          ticket.slaWarnedAt = now;
          scheduleSave();
          const thread = await ticketThreadOf(guild, ticket);
          await thread
            ?.send({
              embeds: [
                new EmbedBuilder()
                  .setColor(COLORS.amber)
                  .setTitle("No staff reply yet")
                  .setDescription(`The customer's last message was <t:${Math.floor(lastUser / 1000)}:R> and nobody has replied since.`),
              ],
              allowedMentions: { parse: [] },
            })
            .catch(() => undefined);
        }
      }
    }

    if (ticket.status === "resolving" && ticket.closeAt !== null && ticket.closeAt > now && !ticket.closeWarnedAt && ticket.closeAt - now <= CLOSE_WARN_MS) {
      const cfg = getGuildConfig(guild.id);
      const brand = brandOf(guild, cfg);
      const user = await client.users.fetch(ticket.userId).catch(() => null);
      if (user) {
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`mmbtn:keep:${ticket.id}`).setLabel("Keep ticket open").setStyle(ButtonStyle.Primary),
        );
        await user
          .send({
            embeds: [
              new EmbedBuilder()
                .setColor(COLORS.amber)
                .setTitle("Your ticket closes soon")
                .setDescription(
                  `Your ${brand} ticket will close <t:${Math.floor(ticket.closeAt / 1000)}:R>. If you still need help, press **Keep ticket open** or just send a message, and it stays open.`,
                ),
            ],
            components: [row],
          })
          .catch(() => undefined);
      }
      ticket.closeWarnedAt = now;
      scheduleSave();
      const thread = await ticketThreadOf(guild, ticket);
      await thread
        ?.send({ embeds: [new EmbedBuilder().setColor(COLORS.amber).setDescription("⏳ Warned the customer that this ticket closes in about 10 minutes.")] })
        .catch(() => undefined);
    }
  }
}

/** "Hello! My name is …" to the customer when a staff member picks up their ticket. Anonymous mode uses the team name. */
export async function sendClaimGreeting(client: Client, guild: Guild, ticket: Ticket, staff: User, staffName: string): Promise<void> {
  const cfg = getGuildConfig(guild.id);
  const brand = brandOf(guild, cfg);
  const name = cfg.anonymousStaff ? `${brand} Support` : staffName;
  const user = await client.users.fetch(ticket.userId).catch(() => null);
  if (!user) return;
  const embed = new EmbedBuilder()
    .setColor(COLORS.green)
    .setAuthor({ name, iconURL: cfg.anonymousStaff ? guild.iconURL() ?? undefined : staff.displayAvatarURL() })
    .setDescription(
      [
        `**Hello! My name is ${name}.**`,
        `I'm picking up your ticket now, so you're in good hands. I've read your message and I'm working on it.`,
        "",
        "You can reply right here at any time, and I'll see it in this conversation.",
      ].join("\n"),
    )
    .setFooter({ text: footerOf(guild, cfg), iconURL: guild.iconURL() ?? undefined })
    .setTimestamp(new Date());
  await user.send({ embeds: [embed] }).catch(() => undefined);
  const thread = await ticketThreadOf(guild, ticket);
  await thread
    ?.send({ embeds: [new EmbedBuilder().setColor(COLORS.green).setDescription(`👋 Greeted the customer as **${name}**.`)], allowedMentions: { parse: [] } })
    .catch(() => undefined);
}

/* ---------------- Auto-Close Background Sweep ---------------- */

export async function sweepDueTicketClosures(client: Client): Promise<void> {
  const due = getTicketsDueForClose(Date.now());
  for (const ticket of due) {
    const guild = client.guilds.cache.get(ticket.guildId);
    if (!guild) {
      ticket.status = "closed";
      ticket.closedAt = Date.now();
      scheduleSave();
      continue;
    }
    await closeTicketNow(client, guild, ticket, null).catch(() => undefined);
  }
}
