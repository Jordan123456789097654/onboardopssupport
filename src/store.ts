import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import pg from "pg";
const { Pool } = pg;

export type ModmailCategory = {
  id: string;
  label: string;
  description: string;
  emoji: string;
  staffRoleId?: string | null;
  /** The tickets channel the bot created for this category, inside its own Discord category. */
  channelId?: string | null;
};

export type AutomodConfig = {
  enabled: boolean;
  antiInvite: boolean;
  antiLinks: boolean;
  maxMentions: number; // 0 = off
  capsPercent: number; // 0 = off
  blockedWords: string[];
  exemptRoleIds: string[];
};

export type AutoroleConfig = {
  enabled: boolean;
  roleIds: string[];
};

export type GuildConfig = {
  guildId: string;
  brandName: string | null;
  brandFooter: string | null;
  modLogChannelId: string | null;
  modmailChannelId: string | null;
  modmailLogChannelId: string | null;
  modmailStaffRoleId: string | null;
  modmailCategories: ModmailCategory[];
  autoRelayThreadMessages: boolean;
  anonymousStaff: boolean;
  defaultCloseDelayMinutes: number;
  blacklistedUserIds: string[];
  automod: AutomodConfig;
  autorole: AutoroleConfig;
  nextCaseNumber: number;
  nextTicketNumber: number;
  /** Optional custom away message, shown outside support hours. */
  awayMessage?: string | null;
};

export type TicketMessage = {
  at: number;
  authorId: string;
  authorName: string;
  authorAvatar?: string | null;
  role: "user" | "staff" | "system";
  content: string;
  attachments?: string[];
};

export type ScheduledReply = { id: string; at: number; body: string; staffId: string; staffName: string };

export type Ticket = {
  id: string;
  guildId: string;
  userId: string;
  username: string;
  userAvatar?: string | null;
  threadId: string;
  parentChannelId: string;
  categoryId: string;
  categoryLabel: string;
  categoryEmoji: string;
  claimedById: string | null;
  status: "open" | "resolving" | "closed";
  closeAt: number | null;
  createdAt: number;
  closedAt: number | null;
  closedById: string | null;
  closeReason?: string | null;
  transcriptUrl?: string | null;
  /** When we last warned the team that the customer has waited 30 minutes without a reply. */
  slaWarnedAt?: number | null;
  /** When we last warned the customer that an auto-close is about to happen. Reset when the close time changes. */
  closeWarnedAt?: number | null;
  /** When staff asked the customer to accept closing the ticket. */
  closeRequestedAt?: number | null;
  /** One-way mode: the customer can read the thread but not reply. */
  oneway?: boolean | null;
  /** Pauses the stale and no-reply alerts until this time. */
  snoozeUntil?: number | null;
  /** Replies queued to send later. */
  scheduled?: ScheduledReply[] | null;
  messages: TicketMessage[];
};

export type ModCaseType = "WARN" | "MUTE" | "UNMUTE" | "KICK" | "BAN" | "SOFTBAN" | "UNBAN";

export type ModCase = {
  caseId: number;
  guildId: string;
  type: ModCaseType;
  userId: string;
  userTag: string;
  moderatorId: string;
  moderatorTag: string;
  reason: string;
  durationMs: number | null;
  active: boolean;
  createdAt: number;
};

export type Tag = {
  guildId: string;
  name: string;
  content: string;
  category: string | null;
  embed: boolean;
  authorId: string;
  uses: number;
  createdAt: number;
  updatedAt: number;
};

type StoreData = {
  guilds: Record<string, GuildConfig>;
  tickets: Record<string, Ticket>; // key: `${guildId}:${ticketId}`
  cases: Record<string, ModCase[]>; // key: guildId
  tags: Record<string, Record<string, Tag>>; // key: guildId -> tagName -> Tag
};

export const DEFAULT_CATEGORIES: ModmailCategory[] = [
  { id: "general", emoji: "💬", label: "General Questions", description: "Ask us anything about the server or team" },
  { id: "tech", emoji: "🔧", label: "Technical Help", description: "Setup, troubleshooting and bug fixes" },
  { id: "orders", emoji: "⚖️", label: "Legal Inquiries", description: "Legal questions, contracts, notices and compliance" },
  { id: "careers", emoji: "🤝", label: "Careers & Team", description: "Applications and staff matters" },
];

export const DEFAULT_AUTOMOD: AutomodConfig = {
  enabled: false,
  antiInvite: true,
  antiLinks: false,
  maxMentions: 6,
  capsPercent: 0,
  blockedWords: [],
  exemptRoleIds: [],
};

export const DEFAULT_AUTOROLE: AutoroleConfig = {
  enabled: false,
  roleIds: [],
};

const FILE_PATH = resolve(process.cwd(), ".data", "store.json");
const DB_URL = process.env.DATABASE_URL?.trim() || "";

let pool: pg.Pool | null = null;
let data: StoreData = { guilds: {}, tickets: {}, cases: {}, tags: {} };
let writeQueue: Promise<void> = Promise.resolve();
let dirty = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export async function initStore(): Promise<"postgres" | "file"> {
  // If DATABASE_URL looks like a placeholder (e.g., "base" or empty), fall back to file storage.
  if (!DB_URL || DB_URL.includes("base")) {
    console.warn("DATABASE_URL missing or placeholder – using file storage instead of PostgreSQL.");
    await loadFileStore();
    return "file";
  }
  try {
    pool = new Pool({
      connectionString: DB_URL,
      ssl: DB_URL.includes("localhost") || DB_URL.includes("127.0.0.1") ? undefined : { rejectUnauthorized: false },
      max: 3,
    });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public_bot_state (
        id TEXT PRIMARY KEY,
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    const res = await pool.query<{ payload: StoreData }>("SELECT payload FROM public_bot_state WHERE id = 'main'");
    if (res.rows[0]?.payload) {
      data = {
        guilds: res.rows[0].payload.guilds ?? {},
        tickets: res.rows[0].payload.tickets ?? {},
        cases: res.rows[0].payload.cases ?? {},
        tags: res.rows[0].payload.tags ?? {},
      };
    }
    return "postgres";
  } catch (e) {
    console.error("Failed to connect to PostgreSQL – falling back to file storage:", e instanceof Error ? e.message : e);
    await loadFileStore();
    return "file";
  }
}

// Helper to load the JSON file store when we cannot use PostgreSQL.
async function loadFileStore() {
  try {
    const raw = await readFile(FILE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<StoreData>;
    data = {
      guilds: parsed.guilds ?? {},
      tickets: parsed.tickets ?? {},
      cases: parsed.cases ?? {},
      tags: parsed.tags ?? {},
    };
  } catch {
    data = { guilds: {}, tickets: {}, cases: {}, tags: {} };
  }
}

async function persistNow(): Promise<void> {
  const snapshot = JSON.stringify(data);
  if (pool) {
    await pool.query(
      `INSERT INTO public_bot_state (id, payload, updated_at)
       VALUES ('main', $1::jsonb, NOW())
       ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
      [snapshot],
    );
    return;
  }
  await mkdir(dirname(FILE_PATH), { recursive: true });
  const tmp = `${FILE_PATH}.tmp`;
  await writeFile(tmp, snapshot, "utf8");
  await rename(tmp, FILE_PATH);
}

export function scheduleSave(): void {
  dirty = true;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    if (!dirty) return;
    dirty = false;
    writeQueue = writeQueue.then(() => persistNow()).catch((e) => console.error("Store persist error:", e));
  }, 400);
}

export async function flushStore(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  dirty = false;
  writeQueue = writeQueue.then(() => persistNow()).catch((e) => console.error("Store flush error:", e));
  await writeQueue;
}

/* ---------------- Guild Config ---------------- */

export function getGuildConfig(guildId: string): GuildConfig {
  let cfg = data.guilds[guildId];
  if (!cfg) {
    cfg = {
      guildId,
      brandName: null,
      brandFooter: null,
      modLogChannelId: null,
      modmailChannelId: null,
      modmailLogChannelId: null,
      modmailStaffRoleId: null,
      modmailCategories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
      autoRelayThreadMessages: true,
      anonymousStaff: false,
      defaultCloseDelayMinutes: 120,
      blacklistedUserIds: [],
      automod: { ...DEFAULT_AUTOMOD, blockedWords: [], exemptRoleIds: [] },
      autorole: { ...DEFAULT_AUTOROLE, roleIds: [] },
      nextCaseNumber: 1,
      nextTicketNumber: 1001,
    };
    data.guilds[guildId] = cfg;
    scheduleSave();
  } else {
    if (!cfg.modmailCategories?.length) cfg.modmailCategories = DEFAULT_CATEGORIES.map((c) => ({ ...c }));
    if (!cfg.automod) cfg.automod = { ...DEFAULT_AUTOMOD, blockedWords: [], exemptRoleIds: [] };
    if (!cfg.autorole) cfg.autorole = { ...DEFAULT_AUTOROLE, roleIds: [] };
    if (!cfg.blacklistedUserIds) cfg.blacklistedUserIds = [];
    if (typeof cfg.autoRelayThreadMessages !== "boolean") cfg.autoRelayThreadMessages = true;
    if (typeof cfg.defaultCloseDelayMinutes !== "number") cfg.defaultCloseDelayMinutes = 120;
    if (typeof cfg.nextCaseNumber !== "number") cfg.nextCaseNumber = 1;
    if (typeof cfg.nextTicketNumber !== "number") cfg.nextTicketNumber = 1001;
  }
  return cfg;
}

export function saveGuildConfig(cfg: GuildConfig): void {
  data.guilds[cfg.guildId] = cfg;
  scheduleSave();
}

export function getAllGuildConfigs(): GuildConfig[] {
  return Object.values(data.guilds);
}

/** Renames the old "Licenses & Orders" category to "Legal Inquiries" on guilds that already have it. Returns true if anything changed. */
export function migrateLegalCategory(cfg: GuildConfig): boolean {
  let changed = false;
  for (const c of cfg.modmailCategories) {
    if (c.label === "Licenses & Orders") {
      c.label = "Legal Inquiries";
      c.emoji = "⚖️";
      c.description = "Legal questions, contracts, notices and compliance";
      changed = true;
    }
  }
  if (changed) scheduleSave();
  return changed;
}

export function getConfiguredModmailGuilds(): GuildConfig[] {
  return Object.values(data.guilds).filter((g) => !!g.modmailChannelId);
}

/* ---------------- Tickets ---------------- */

const tKey = (guildId: string, ticketId: string) => `${guildId}:${ticketId}`;

export function createTicketRecord(input: Omit<Ticket, "id">): Ticket {
  const cfg = getGuildConfig(input.guildId);
  const id = String(cfg.nextTicketNumber++);
  const ticket: Ticket = { ...input, id };
  data.tickets[tKey(input.guildId, id)] = ticket;
  scheduleSave();
  return ticket;
}

export function getOpenTicketByUser(userId: string, guildId?: string): Ticket | undefined {
  return Object.values(data.tickets).find(
    (t) => t.status !== "closed" && t.userId === userId && (!guildId || t.guildId === guildId),
  );
}

export function getOpenTicketByThread(threadId: string): Ticket | undefined {
  return Object.values(data.tickets).find((t) => t.status !== "closed" && t.threadId === threadId);
}

export function getTicketById(ticketId: string): Ticket | undefined {
  const clean = ticketId.trim();
  return Object.values(data.tickets).find((t) => t.id === clean || `${t.guildId}:${t.id}` === clean);
}

export function getAllTickets(guildId?: string): Ticket[] {
  const all = Object.values(data.tickets);
  if (!guildId) return all.sort((a, b) => b.createdAt - a.createdAt);
  return all.filter((t) => t.guildId === guildId).sort((a, b) => b.createdAt - a.createdAt);
}

export function getTicketsDueForClose(nowMs = Date.now()): Ticket[] {
  return Object.values(data.tickets).filter((t) => t.status === "resolving" && t.closeAt !== null && t.closeAt <= nowMs);
}

export function appendTicketMessage(ticket: Ticket, msg: TicketMessage): void {
  ticket.messages.push(msg);
  if (ticket.messages.length > 500) ticket.messages.splice(0, ticket.messages.length - 500);
  scheduleSave();
}

/* ---------------- Moderation Cases & Warnings ---------------- */

export function addModCase(input: Omit<ModCase, "caseId" | "createdAt" | "active">): ModCase {
  const cfg = getGuildConfig(input.guildId);
  const entry: ModCase = {
    ...input,
    caseId: cfg.nextCaseNumber++,
    active: true,
    createdAt: Date.now(),
  };
  const list = (data.cases[input.guildId] ??= []);
  list.push(entry);
  scheduleSave();
  return entry;
}

export function getGuildCases(guildId: string): ModCase[] {
  return data.cases[guildId] ?? [];
}

export function getUserCases(guildId: string, userId: string): ModCase[] {
  return getGuildCases(guildId).filter((c) => c.userId === userId);
}

export function getUserActiveWarnings(guildId: string, userId: string): ModCase[] {
  return getUserCases(guildId, userId).filter((c) => c.type === "WARN" && c.active);
}

export function getCaseById(guildId: string, caseId: number): ModCase | undefined {
  return getGuildCases(guildId).find((c) => c.caseId === caseId);
}

export function removeWarning(guildId: string, userId: string, caseId: number): boolean {
  const c = getCaseById(guildId, caseId);
  if (!c || c.userId !== userId || c.type !== "WARN" || !c.active) return false;
  c.active = false;
  scheduleSave();
  return true;
}

export function clearWarnings(guildId: string, userId: string): number {
  let count = 0;
  for (const c of getUserCases(guildId, userId)) {
    if (c.type === "WARN" && c.active) {
      c.active = false;
      count++;
    }
  }
  if (count > 0) scheduleSave();
  return count;
}

/* ---------------- Tags ---------------- */

export function getGuildTags(guildId: string): Tag[] {
  return Object.values(data.tags[guildId] ?? {}).sort((a, b) => a.name.localeCompare(b.name));
}

export function getTag(guildId: string, name: string): Tag | undefined {
  return data.tags[guildId]?.[name.trim().toLowerCase()];
}

export function upsertTag(tag: Tag): void {
  const g = (data.tags[tag.guildId] ??= {});
  g[tag.name] = tag;
  scheduleSave();
}

export function deleteTag(guildId: string, name: string): boolean {
  const g = data.tags[guildId];
  const key = name.trim().toLowerCase();
  if (!g || !g[key]) return false;
  delete g[key];
  scheduleSave();
  return true;
}
