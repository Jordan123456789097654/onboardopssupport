import cookieParser from "cookie-parser";
import type { Client, GuildMember } from "discord.js";
import express, { type Request, type Response } from "express";
import {
  deleteTag,
  getAllGuildConfigs,
  getAllTickets,
  getGuildCases,
  getGuildConfig,
  getGuildTags,
  getTag,
  getTicketById,
  saveGuildConfig,
  upsertTag,
  type GuildConfig,
  type Ticket,
} from "../store";

export type WebServerOptions = {
  port?: number;
  baseUrl?: string;
};

type SessionUser = {
  id: string;
  username: string;
  avatar: string | null;
  roleIds: string[];
  guildId: string;
};

const BRAND_NAME = "OnboardOps";
const SESSION_COOKIE = "oo_session";

function parseAllowedRoles(): string[] {
  const raw =
    process.env.DASHBOARD_ROLE_IDS ||
    process.env.ALLOWED_STAFF_ROLE_IDS ||
    process.env.STAFF_ROLE_IDS ||
    "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function renderHtml(title: string, bodyContent: string, user?: SessionUser | null): string {
  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} — ${BRAND_NAME} Support</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { background-color: #0f1117; color: #e5e7eb; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    .discord-blurple { background-color: #5865F2; }
    .discord-blurple:hover { background-color: #4752C4; }
    .discord-card { background-color: #1a1d24; border: 1px solid #2a2e39; }
    .discord-subtle { background-color: #232730; }
  </style>
</head>
<body class="min-h-screen flex flex-col">
  <header class="border-b border-gray-800 bg-[#16181f] sticky top-0 z-50">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center font-bold text-white shadow-lg shadow-blue-500/20">
          OO
        </div>
        <div>
          <a href="/dashboard" class="font-bold text-lg text-white hover:text-blue-400 transition tracking-tight">${BRAND_NAME} Support</a>
          <span class="text-xs text-gray-400 block -mt-1">Management Panel</span>
        </div>
      </div>
      <nav class="flex items-center gap-4 text-sm">
        ${
          user
            ? `
          <a href="/dashboard" class="text-gray-300 hover:text-white px-2 py-1">Overview</a>
          <a href="/dashboard/modmail" class="text-gray-300 hover:text-white px-2 py-1">Modmail</a>
          <a href="/dashboard/tags" class="text-gray-300 hover:text-white px-2 py-1">Tags</a>
          <a href="/dashboard/automod" class="text-gray-300 hover:text-white px-2 py-1">AutoMod</a>
          <a href="/dashboard/autorole" class="text-gray-300 hover:text-white px-2 py-1">Autorole</a>
          <a href="/dashboard/tickets" class="text-gray-300 hover:text-white px-2 py-1">Tickets</a>
          <div class="h-4 w-px bg-gray-700"></div>
          <div class="flex items-center gap-2">
            ${
              user.avatar
                ? `<img src="${user.avatar}" class="w-7 h-7 rounded-full border border-gray-700" alt="avatar" />`
                : `<div class="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold">${user.username.slice(0, 2).toUpperCase()}</div>`
            }
            <span class="text-xs font-medium text-gray-300 hidden md:inline">${escapeHtml(user.username)}</span>
            <a href="/auth/logout" class="text-xs text-red-400 hover:text-red-300 ml-2">Log out</a>
          </div>
        `
            : `
          <a href="/auth/login" class="discord-blurple text-white font-medium px-4 py-2 rounded-lg text-xs shadow transition flex items-center gap-2">
            <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07..07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.893.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>
            Staff Login
          </a>
        `
        }
      </nav>
    </div>
  </header>
  <main class="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
    ${bodyContent}
  </main>
  <footer class="border-t border-gray-800 bg-[#12141a] py-6 text-center text-xs text-gray-500">
    <p>${BRAND_NAME} Support Platform &bull; Hosted on <a href="https://support.onboardops.org" class="text-blue-400 hover:underline">support.onboardops.org</a></p>
  </footer>
</body>
</html>`;
}

function escapeHtml(str: unknown): string {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function startWebServer(client: Client, opts: WebServerOptions = {}): express.Express {
  const app = express();
  const port = opts.port ?? (Number(process.env.PORT) || 3000);
  const secret = process.env.SESSION_SECRET || "onboardops-support-secret-98741";
  const baseUrl = (process.env.BASE_URL || opts.baseUrl || "https://support.onboardops.org").replace(/\/+$/, "");

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser(secret));

  // Health check for Railway
  // Always 200 while the process is up, so Railway doesn't restart the service during a slow Discord login.
  // "ready" in the body shows whether Discord has connected yet.
  app.get("/healthz", (req, res) => {
    const ready = client.isReady();
    res.status(200).json({
      status: ready ? "ok" : "down",
      ready,
      guilds: ready ? client.guilds.cache.size : 0,
      gatewayPingMs: ready ? Math.round(client.ws.ping) : null,
      uptimeSeconds: Math.floor(process.uptime()),
    });
  });

  // Root redirect
  app.get("/", (req, res) => {
    const session = getSessionUser(req);
    if (session) {
      res.redirect("/dashboard");
    } else {
      res.redirect("/auth/login");
    }
  });

  /* =========================================================================
     PUBLIC TRANSCRIPTS
     ========================================================================= */
  app.get("/transcript/:id", (req, res) => {
    const ticket = getTicketById(req.params.id);
    if (!ticket) {
      res.status(404).send(
        renderHtml(
          "Transcript Not Found",
          `
        <div class="max-w-xl mx-auto text-center py-20">
          <div class="w-16 h-16 bg-red-900/30 text-red-400 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl font-bold">!</div>
          <h1 class="text-2xl font-bold text-white mb-2">Transcript Not Found</h1>
          <p class="text-gray-400 mb-6">No support ticket with ID <code class="bg-gray-800 px-2 py-1 rounded text-red-300">#${escapeHtml(req.params.id)}</code> was found.</p>
          <a href="/dashboard" class="inline-block bg-gray-800 hover:bg-gray-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition">Back to Dashboard</a>
        </div>
      `,
          null,
        ),
      );
      return;
    }

    const guild = client.guilds.cache.get(ticket.guildId);
    const guildName = guild?.name || "OnboardOps";
    const closedDate = ticket.closedAt ? new Date(ticket.closedAt).toLocaleString() : "Still Open";
    const openedDate = new Date(ticket.createdAt).toLocaleString();

    const messagesHtml = ticket.messages
      .map((m) => {
        const isStaff = m.role === "staff";
        const isSystem = m.role === "system";
        const bubbleBg = isStaff ? "border-l-4 border-emerald-500 bg-[#162520]/40" : isSystem ? "bg-gray-800/60" : "bg-[#1c2230]/40";
        const roleBadge = isStaff
          ? `<span class="bg-emerald-500/20 text-emerald-400 text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ml-2">Staff</span>`
          : isSystem
          ? `<span class="bg-gray-700 text-gray-300 text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ml-2">System</span>`
          : `<span class="bg-blue-500/20 text-blue-400 text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ml-2">User</span>`;

        const avatar =
          m.authorAvatar ||
          "https://cdn.discordapp.com/embed/avatars/0.png";

        const attachmentsHtml = (m.attachments || [])
          .map((url) => {
            const isImg = url.match(/\.(png|jpe?g|webp|gif)(\?.*)?$/i);
            if (isImg) {
              return `<div class="mt-2"><a href="${escapeHtml(url)}" target="_blank" rel="noopener"><img src="${escapeHtml(url)}" class="max-w-md max-h-80 rounded-lg border border-gray-700 object-cover hover:opacity-90 transition" alt="attachment" /></a></div>`;
            }
            return `<div class="mt-1"><a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="text-xs text-blue-400 hover:underline flex items-center gap-1">📎 ${escapeHtml(url.split("/").pop() || "Attachment")}</a></div>`;
          })
          .join("");

        return `
        <div class="p-4 rounded-xl ${bubbleBg} border border-gray-800/80 mb-3 flex gap-3.5">
          <img src="${escapeHtml(avatar)}" class="w-10 h-10 rounded-full border border-gray-700/60 flex-shrink-0" alt="avatar" />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <span class="font-semibold text-sm text-white">${escapeHtml(m.authorName)}</span>
              ${roleBadge}
              <span class="text-xs text-gray-400 ml-auto">${new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            <div class="text-sm text-gray-200 whitespace-pre-wrap break-words leading-relaxed">${escapeHtml(m.content)}</div>
            ${attachmentsHtml}
          </div>
        </div>
      `;
      })
      .join("");

    const pageContent = `
      <div class="max-w-4xl mx-auto">
        <div class="discord-card rounded-2xl p-6 mb-6 shadow-xl">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-gray-800">
            <div>
              <div class="flex items-center gap-2 mb-1">
                <span class="text-2xl font-extrabold text-white">Ticket #${escapeHtml(ticket.id)}</span>
                <span class="px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                  ticket.status === "closed" ? "bg-red-500/20 text-red-400 border border-red-500/30" : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                }">
                  ${ticket.status.toUpperCase()}
                </span>
              </div>
              <p class="text-sm text-gray-400">${escapeHtml(guildName)} &bull; Category: <span class="text-gray-200 font-medium">${escapeHtml(ticket.categoryEmoji)} ${escapeHtml(ticket.categoryLabel)}</span></p>
            </div>
            <div class="flex items-center gap-2">
              <a href="/transcript/${ticket.id}/raw" download="transcript-${ticket.id}.txt" class="bg-gray-800 hover:bg-gray-700 text-gray-200 px-4 py-2 rounded-lg text-xs font-medium transition flex items-center gap-2">
                Download Plaintext
              </a>
              <button onclick="navigator.clipboard.writeText(window.location.href); alert('Transcript URL copied to clipboard!')" class="discord-blurple text-white px-4 py-2 rounded-lg text-xs font-medium transition">
                Copy Link
              </button>
            </div>
          </div>

          <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-6 text-xs">
            <div>
              <span class="text-gray-400 block mb-1">User</span>
              <span class="text-white font-medium flex items-center gap-1.5">
                ${escapeHtml(ticket.username)}
              </span>
            </div>
            <div>
              <span class="text-gray-400 block mb-1">Opened</span>
              <span class="text-gray-200">${escapeHtml(openedDate)}</span>
            </div>
            <div>
              <span class="text-gray-400 block mb-1">Closed</span>
              <span class="text-gray-200">${escapeHtml(closedDate)}</span>
            </div>
            <div>
              <span class="text-gray-400 block mb-1">Total Messages</span>
              <span class="text-gray-200 font-bold">${ticket.messages.length}</span>
            </div>
          </div>

          ${
            ticket.closeReason
              ? `<div class="mt-4 pt-4 border-t border-gray-800 text-xs"><span class="text-gray-400">Closure Reason:</span> <span class="text-yellow-400 font-medium">${escapeHtml(ticket.closeReason)}</span></div>`
              : ""
          }
        </div>

        <div class="space-y-1">
          <h2 class="text-xs font-bold uppercase tracking-wider text-gray-400 mb-4 px-1">Message Stream (${ticket.messages.length})</h2>
          ${messagesHtml || `<div class="p-8 text-center text-gray-400 discord-card rounded-xl">No messages recorded in this ticket.</div>`}
        </div>
      </div>
    `;

    res.send(renderHtml(`Transcript #${ticket.id}`, pageContent, null));
  });

  app.get("/transcript/:id/raw", (req, res) => {
    const ticket = getTicketById(req.params.id);
    if (!ticket) {
      res.status(404).send("Ticket not found");
      return;
    }
    const lines = [
      `Modmail Transcript — Ticket #${ticket.id}`,
      `Guild ID: ${ticket.guildId}`,
      `User: ${ticket.username} (${ticket.userId})`,
      `Category: ${ticket.categoryEmoji} ${ticket.categoryLabel}`,
      `Status: ${ticket.status.toUpperCase()}`,
      `Created At: ${new Date(ticket.createdAt).toISOString()}`,
      `Closed At: ${ticket.closedAt ? new Date(ticket.closedAt).toISOString() : "N/A"}`,
      ticket.closeReason ? `Closure Reason: ${ticket.closeReason}` : "",
      "============================================================",
      ...ticket.messages.map(
        (m) =>
          `[${new Date(m.at).toISOString()}] [${m.role.toUpperCase()}] ${m.authorName}: ${m.content}${
            m.attachments?.length ? ` [Attachments: ${m.attachments.join(", ")}]` : ""
          }`,
      ),
    ]
      .filter(Boolean)
      .join("\n");

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="transcript-${ticket.id}.txt"`);
    res.send(lines);
  });

  /* =========================================================================
     DISCORD OAUTH2 AUTHENTICATION
     ========================================================================= */
  app.get("/auth/login", (req, res) => {
    const clientId = process.env.DISCORD_CLIENT_ID?.trim();
    if (!clientId) {
      res.status(500).send("DISCORD_CLIENT_ID is not configured in .env");
      return;
    }
    const redirectUri = `${baseUrl}/auth/callback`;
    const oauthUrl = `https://discord.com/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(
      redirectUri,
    )}&response_type=code&scope=identify+guilds`;
    res.redirect(oauthUrl);
  });

  app.get("/auth/callback", async (req, res) => {
    const code = req.query.code as string;
    if (!code) {
      res.redirect("/auth/login");
      return;
    }

    const clientId = process.env.DISCORD_CLIENT_ID?.trim();
    const clientSecret = process.env.DISCORD_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) {
      res.status(500).send("DISCORD_CLIENT_ID or DISCORD_CLIENT_SECRET is missing in .env.");
      return;
    }

    try {
      const tokenRes = await fetch("https://discord.com/api/v10/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "authorization_code",
          code,
          redirect_uri: `${baseUrl}/auth/callback`,
        }),
      });

      if (!tokenRes.ok) {
        const errText = await tokenRes.text();
        res.status(400).send(`OAuth token error: ${errText}`);
        return;
      }

      const tokenData = (await tokenRes.json()) as { access_token: string; token_type: string };
      const userRes = await fetch("https://discord.com/api/v10/users/@me", {
        headers: { Authorization: `${tokenData.token_type} ${tokenData.access_token}` },
      });

      if (!userRes.ok) {
        res.status(400).send("Failed to fetch Discord user profile.");
        return;
      }

      const discordUser = (await userRes.json()) as { id: string; username: string; avatar: string | null };

      // Determine user roles in target Discord server
      const allowedRoles = parseAllowedRoles();
      let matchedGuildId = "";
      const userRoleIds: string[] = [];
      let isStaff = false;

      // Check member in all mutual guilds or target guild
      const targetGuildId = process.env.DASHBOARD_GUILD_ID || process.env.DEV_GUILD_ID || "";
      const candidateGuilds = targetGuildId
        ? [client.guilds.cache.get(targetGuildId)].filter(Boolean)
        : [...client.guilds.cache.values()];

      for (const g of candidateGuilds) {
        if (!g) continue;
        try {
          const member: GuildMember | null = await g.members.fetch(discordUser.id).catch(() => null);
          if (member) {
            matchedGuildId = g.id;
            const roles = [...member.roles.cache.keys()];
            userRoleIds.push(...roles);

            // Administrator bypass or role ID check
            if (member.permissions.has("Administrator")) {
              isStaff = true;
            }
            if (allowedRoles.length > 0) {
              if (roles.some((r) => allowedRoles.includes(r))) {
                isStaff = true;
              }
            } else {
              // If no specific roles in .env, check admin/manage_guild
              if (member.permissions.has("ManageGuild")) isStaff = true;
            }
          }
        } catch {
          // ignore fetch error
        }
      }

      if (!isStaff) {
        const roleReqText = allowedRoles.length
          ? `Requires one of role ID(s): <code class="bg-gray-800 text-yellow-400 px-1 py-0.5 rounded">${allowedRoles.join(
              ", ",
            )}</code>`
          : "Requires Administrator or Manage Server permission.";

        res.status(403).send(
          renderHtml(
            "Access Denied",
            `
          <div class="max-w-md mx-auto text-center py-20">
            <div class="w-16 h-16 bg-red-900/30 text-red-400 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl font-bold">⛔</div>
            <h1 class="text-2xl font-bold text-white mb-2">Access Denied</h1>
            <p class="text-gray-300 text-sm mb-4">Hello <strong class="text-white">${escapeHtml(
              discordUser.username,
            )}</strong>! Your Discord account does not have the required staff role to view this panel.</p>
            <div class="bg-gray-900 p-4 rounded-xl text-xs text-gray-400 mb-6 border border-gray-800">${roleReqText}</div>
            <a href="/auth/login" class="inline-block bg-blue-600 hover:bg-blue-500 text-white px-5 py-2.5 rounded-lg text-xs font-semibold">Try Another Account</a>
          </div>
        `,
            null,
          ),
        );
        return;
      }

      const avatarUrl = discordUser.avatar
        ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
        : null;

      const session: SessionUser = {
        id: discordUser.id,
        username: discordUser.username,
        avatar: avatarUrl,
        roleIds: userRoleIds,
        guildId: matchedGuildId || candidateGuilds[0]?.id || "",
      };

      res.cookie(SESSION_COOKIE, JSON.stringify(session), {
        httpOnly: true,
        signed: true,
        maxAge: 7 * 86400 * 1000,
        sameSite: "lax",
      });

      res.redirect("/dashboard");
    } catch (err) {
      console.error("OAuth callback error:", err);
      res.status(500).send("An unexpected error occurred during authentication.");
    }
  });

  app.get("/auth/logout", (req, res) => {
    res.clearCookie(SESSION_COOKIE);
    res.redirect("/");
  });

  /* =========================================================================
     PROTECTED DASHBOARD ROUTES
     ========================================================================= */
  function getSessionUser(req: Request): SessionUser | null {
    try {
      const raw = req.signedCookies[SESSION_COOKIE];
      if (!raw) return null;
      return JSON.parse(raw) as SessionUser;
    } catch {
      return null;
    }
  }

  function requireStaff(req: Request, res: Response, next: () => void): void {
    const user = getSessionUser(req);
    if (!user) {
      res.redirect("/auth/login");
      return;
    }
    next();
  }

  function getTargetGuild(req: Request): { guildId: string; cfg: GuildConfig } {
    const user = getSessionUser(req);
    const targetGuildId =
      (req.query.guild as string) ||
      user?.guildId ||
      process.env.DASHBOARD_GUILD_ID ||
      process.env.DEV_GUILD_ID ||
      client.guilds.cache.firstKey() ||
      "default";
    const cfg = getGuildConfig(targetGuildId);
    return { guildId: targetGuildId, cfg };
  }

  // Dashboard Overview
  app.get("/dashboard", requireStaff, (req, res) => {
    const user = getSessionUser(req)!;
    const { guildId, cfg } = getTargetGuild(req);
    const guild = client.guilds.cache.get(guildId);
    const tickets = getAllTickets(guildId);
    const openTickets = tickets.filter((t) => t.status !== "closed");
    const tags = getGuildTags(guildId);
    const cases = getGuildCases(guildId);

    const content = `
      <div class="space-y-6">
        <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 class="text-2xl font-extrabold text-white tracking-tight">Dashboard Overview</h1>
            <p class="text-sm text-gray-400">Server: <strong class="text-white">${escapeHtml(
              guild?.name || cfg.brandName || "Default Server",
            )}</strong> &bull; Total Members: ${guild?.memberCount || "N/A"}</p>
          </div>
          <div class="flex items-center gap-2">
            <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span> Bot Online (${Math.round(
                client.ws.ping,
              )}ms)
            </span>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div class="discord-card p-5 rounded-2xl shadow">
            <span class="text-xs font-medium text-gray-400 uppercase tracking-wider block mb-1">Open Tickets</span>
            <div class="flex items-baseline justify-between">
              <span class="text-3xl font-extrabold text-white">${openTickets.length}</span>
              <a href="/dashboard/tickets" class="text-xs text-blue-400 hover:underline">View all &rarr;</a>
            </div>
            <span class="text-[11px] text-gray-500 mt-2 block">${tickets.length} total tickets all-time</span>
          </div>

          <div class="discord-card p-5 rounded-2xl shadow">
            <span class="text-xs font-medium text-gray-400 uppercase tracking-wider block mb-1">Canned Tags</span>
            <div class="flex items-baseline justify-between">
              <span class="text-3xl font-extrabold text-white">${tags.length}</span>
              <a href="/dashboard/tags" class="text-xs text-blue-400 hover:underline">Manage &rarr;</a>
            </div>
            <span class="text-[11px] text-gray-500 mt-2 block">Quick responses in DMs & threads</span>
          </div>

          <div class="discord-card p-5 rounded-2xl shadow">
            <span class="text-xs font-medium text-gray-400 uppercase tracking-wider block mb-1">AutoMod Filter</span>
            <div class="flex items-baseline justify-between">
              <span class="text-xl font-bold ${cfg.automod?.enabled ? "text-emerald-400" : "text-gray-400"}">
                ${cfg.automod?.enabled ? "Active" : "Disabled"}
              </span>
              <a href="/dashboard/automod" class="text-xs text-blue-400 hover:underline">Configure &rarr;</a>
            </div>
            <span class="text-[11px] text-gray-500 mt-2 block">Anti-invite, caps & bad words</span>
          </div>

          <div class="discord-card p-5 rounded-2xl shadow">
            <span class="text-xs font-medium text-gray-400 uppercase tracking-wider block mb-1">Autorole on Join</span>
            <div class="flex items-baseline justify-between">
              <span class="text-xl font-bold ${cfg.autorole?.enabled ? "text-emerald-400" : "text-gray-400"}">
                ${cfg.autorole?.enabled ? `${cfg.autorole.roleIds.length} Role(s)` : "Disabled"}
              </span>
              <a href="/dashboard/autorole" class="text-xs text-blue-400 hover:underline">Edit &rarr;</a>
            </div>
            <span class="text-[11px] text-gray-500 mt-2 block">Auto-assigns to new members</span>
          </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div class="discord-card p-6 rounded-2xl">
            <div class="flex items-center justify-between mb-4">
              <h2 class="font-bold text-white text-base">Modmail Categories</h2>
              <a href="/dashboard/modmail" class="text-xs text-blue-400 hover:underline">Edit Categories</a>
            </div>
            <div class="space-y-2">
              ${cfg.modmailCategories
                .map(
                  (c) => `
                <div class="p-3 bg-gray-900/60 rounded-xl border border-gray-800 flex items-center justify-between">
                  <div class="flex items-center gap-2.5">
                    <span class="text-xl">${escapeHtml(c.emoji)}</span>
                    <div>
                      <span class="font-semibold text-sm text-gray-200 block">${escapeHtml(c.label)}</span>
                      <span class="text-xs text-gray-400 block">${escapeHtml(c.description)}</span>
                    </div>
                  </div>
                  ${c.staffRoleId ? `<span class="text-[10px] bg-blue-900/40 text-blue-300 px-2 py-0.5 rounded border border-blue-800">Pings Role</span>` : ""}
                </div>
              `,
                )
                .join("")}
            </div>
          </div>

          <div class="discord-card p-6 rounded-2xl">
            <div class="flex items-center justify-between mb-4">
              <h2 class="font-bold text-white text-base">Recent Closed Tickets</h2>
              <a href="/dashboard/tickets" class="text-xs text-blue-400 hover:underline">View All</a>
            </div>
            <div class="space-y-2">
              ${tickets
                .filter((t) => t.status === "closed")
                .slice(0, 4)
                .map(
                  (t) => `
                <div class="p-3 bg-gray-900/60 rounded-xl border border-gray-800 flex items-center justify-between text-xs">
                  <div>
                    <span class="font-semibold text-white">#${escapeHtml(t.id)} &bull; ${escapeHtml(t.username)}</span>
                    <span class="text-gray-400 block">${escapeHtml(t.categoryEmoji)} ${escapeHtml(t.categoryLabel)}</span>
                  </div>
                  <a href="/transcript/${t.id}" target="_blank" class="bg-blue-600/20 text-blue-400 border border-blue-500/30 px-3 py-1 rounded-lg hover:bg-blue-600/30 font-medium">
                    Transcript &rarr;
                  </a>
                </div>
              `,
                )
                .join("") || `<p class="text-xs text-gray-500">No closed tickets yet.</p>`}
            </div>
          </div>
        </div>
      </div>
    `;

    res.send(renderHtml("Overview", content, user));
  });

  // Modmail Configuration
  app.get("/dashboard/modmail", requireStaff, (req, res) => {
    const user = getSessionUser(req)!;
    const { guildId, cfg } = getTargetGuild(req);
    const guild = client.guilds.cache.get(guildId);

    const channels = guild
      ? [...guild.channels.cache.values()].filter((c) => c.type === 0)
      : [];
    const roles = guild ? [...guild.roles.cache.values()] : [];

    const content = `
      <div class="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 class="text-2xl font-extrabold text-white tracking-tight">Modmail Configuration</h1>
          <p class="text-sm text-gray-400">Configure channels, Vero-style category dropdowns, staff roles, and auto-close timers.</p>
        </div>

        <form method="POST" action="/dashboard/modmail/save?guild=${guildId}" class="discord-card p-6 rounded-2xl space-y-6 shadow-xl">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label class="block text-xs font-bold uppercase tracking-wider text-gray-300 mb-2">Brand Display Name</label>
              <input type="text" name="brandName" value="${escapeHtml(cfg.brandName || "OnboardOps")}" class="w-full bg-[#12141a] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" placeholder="e.g. OnboardOps" />
              <span class="text-[11px] text-gray-500 mt-1 block">Shown on embed titles and headers in user DMs.</span>
            </div>

            <div>
              <label class="block text-xs font-bold uppercase tracking-wider text-gray-300 mb-2">Embed Footer Text</label>
              <input type="text" name="brandFooter" value="${escapeHtml(cfg.brandFooter || "OnboardOps Support")}" class="w-full bg-[#12141a] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" placeholder="e.g. OnboardOps Support" />
            </div>

            <div>
              <label class="block text-xs font-bold uppercase tracking-wider text-gray-300 mb-2">Modmail Inbox Channel ID</label>
              <input type="text" name="modmailChannelId" value="${escapeHtml(cfg.modmailChannelId || "")}" class="w-full bg-[#12141a] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" placeholder="e.g. 123456789012345678" />
              <span class="text-[11px] text-gray-500 mt-1 block">New tickets will create threads inside this channel.</span>
            </div>

            <div>
              <label class="block text-xs font-bold uppercase tracking-wider text-gray-300 mb-2">Closing Log Channel ID</label>
              <input type="text" name="modmailLogChannelId" value="${escapeHtml(cfg.modmailLogChannelId || "")}" class="w-full bg-[#12141a] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" placeholder="e.g. 123456789012345678" />
              <span class="text-[11px] text-gray-500 mt-1 block">Where transcripts and closure logs are sent.</span>
            </div>

            <div>
              <label class="block text-xs font-bold uppercase tracking-wider text-gray-300 mb-2">Staff Role ID</label>
              <input type="text" name="modmailStaffRoleId" value="${escapeHtml(cfg.modmailStaffRoleId || "")}" class="w-full bg-[#12141a] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" placeholder="e.g. 123456789012345678" />
              <span class="text-[11px] text-gray-500 mt-1 block">Users with this role can reply and manage tickets.</span>
            </div>

            <div>
              <label class="block text-xs font-bold uppercase tracking-wider text-gray-300 mb-2">Default Auto-Close Delay (Hours)</label>
              <input type="number" name="defaultCloseHours" value="${Math.round(cfg.defaultCloseDelayMinutes / 60)}" min="1" max="168" class="w-full bg-[#12141a] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
              <span class="text-[11px] text-gray-500 mt-1 block">When staff does /resolve, ticket closes after this delay.</span>
            </div>
          </div>

          <div class="pt-4 border-t border-gray-800">
            <h3 class="text-sm font-bold text-white mb-3">Category Dropdown Selector (User DM menu)</h3>
            <p class="text-xs text-gray-400 mb-4">Users see these categories in a dropdown menu when they DM the bot.</p>
            <div class="space-y-3">
              ${cfg.modmailCategories
                .map(
                  (c, idx) => `
                <div class="grid grid-cols-12 gap-2 items-center bg-[#12141a] p-3 rounded-xl border border-gray-800">
                  <div class="col-span-1">
                    <input type="text" name="cat_emoji_${idx}" value="${escapeHtml(c.emoji)}" class="w-full text-center bg-gray-900 border border-gray-700 rounded py-1 text-sm text-white" />
                  </div>
                  <div class="col-span-3">
                    <input type="text" name="cat_label_${idx}" value="${escapeHtml(c.label)}" class="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-white" placeholder="Label" />
                  </div>
                  <div class="col-span-5">
                    <input type="text" name="cat_desc_${idx}" value="${escapeHtml(c.description)}" class="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-white" placeholder="Description" />
                  </div>
                  <div class="col-span-3">
                    <input type="text" name="cat_role_${idx}" value="${escapeHtml(c.staffRoleId || "")}" class="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-white" placeholder="Ping Role ID" />
                  </div>
                </div>
              `,
                )
                .join("")}
            </div>
          </div>

          <div class="flex justify-end pt-4 border-t border-gray-800">
            <button type="submit" class="bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs px-6 py-2.5 rounded-lg shadow-lg shadow-blue-500/20 transition">
              Save Modmail Settings
            </button>
          </div>
        </form>
      </div>
    `;

    res.send(renderHtml("Modmail Config", content, user));
  });

  app.post("/dashboard/modmail/save", requireStaff, (req, res) => {
    const { guildId, cfg } = getTargetGuild(req);
    cfg.brandName = req.body.brandName?.trim() || null;
    cfg.brandFooter = req.body.brandFooter?.trim() || null;
    cfg.modmailChannelId = req.body.modmailChannelId?.trim() || null;
    cfg.modmailLogChannelId = req.body.modmailLogChannelId?.trim() || null;
    cfg.modmailStaffRoleId = req.body.modmailStaffRoleId?.trim() || null;
    const hours = Number(req.body.defaultCloseHours) || 2;
    cfg.defaultCloseDelayMinutes = Math.max(1, hours * 60);

    // Update categories
    for (let i = 0; i < cfg.modmailCategories.length; i++) {
      const emoji = req.body[`cat_emoji_${i}`]?.trim();
      const label = req.body[`cat_label_${i}`]?.trim();
      const desc = req.body[`cat_desc_${i}`]?.trim();
      const role = req.body[`cat_role_${i}`]?.trim();
      if (emoji) cfg.modmailCategories[i].emoji = emoji;
      if (label) cfg.modmailCategories[i].label = label;
      if (desc) cfg.modmailCategories[i].description = desc;
      cfg.modmailCategories[i].staffRoleId = role || null;
    }

    saveGuildConfig(cfg);
    res.redirect(`/dashboard/modmail?guild=${guildId}`);
  });

  // Tags / Canned Responses
  app.get("/dashboard/tags", requireStaff, (req, res) => {
    const user = getSessionUser(req)!;
    const { guildId } = getTargetGuild(req);
    const tags = getGuildTags(guildId);

    const content = `
      <div class="max-w-5xl mx-auto space-y-6">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 class="text-2xl font-extrabold text-white tracking-tight">Canned Tags & Responses</h1>
            <p class="text-sm text-gray-400">Use <code class="bg-gray-800 text-blue-300 px-1.5 py-0.5 rounded text-xs">/tag send</code> in Discord channels or Modmail ticket threads to reply instantly.</p>
          </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div class="lg:col-span-1">
            <form method="POST" action="/dashboard/tags/save?guild=${guildId}" class="discord-card p-5 rounded-2xl space-y-4 shadow-xl">
              <h2 class="font-bold text-white text-base">Add or Edit Tag</h2>

              <div>
                <label class="block text-xs font-bold uppercase tracking-wider text-gray-300 mb-1">Tag Name</label>
                <input type="text" name="name" required class="w-full bg-[#12141a] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" placeholder="e.g. rules, refund, appeal" />
                <span class="text-[11px] text-gray-500 mt-1 block">Used as /tag send [name]</span>
              </div>

              <div>
                <label class="block text-xs font-bold uppercase tracking-wider text-gray-300 mb-1">Tag Content</label>
                <textarea name="content" rows="4" required class="w-full bg-[#12141a] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" placeholder="Hello {user}, here are our guidelines..."></textarea>
                <span class="text-[11px] text-gray-400 mt-1 block">Variables: <code class="text-yellow-300">{user}</code>, <code class="text-yellow-300">{username}</code>, <code class="text-yellow-300">{server}</code>, <code class="text-yellow-300">{staff}</code></span>
              </div>

              <div>
                <label class="block text-xs font-bold uppercase tracking-wider text-gray-300 mb-1">Category (Optional)</label>
                <input type="text" name="category" class="w-full bg-[#12141a] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" placeholder="General, Billing, Policy" />
              </div>

              <div class="flex items-center gap-2">
                <input type="checkbox" id="embedCheck" name="embed" value="true" class="rounded bg-gray-900 border-gray-700 text-blue-600 focus:ring-0" />
                <label for="embedCheck" class="text-xs text-gray-300">Send formatted as Discord Embed</label>
              </div>

              <button type="submit" class="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs py-2.5 rounded-lg transition shadow-md shadow-blue-500/20">
                Save Tag
              </button>
            </form>
          </div>

          <div class="lg:col-span-2 space-y-3">
            <h2 class="font-bold text-white text-base mb-2">Existing Tags (${tags.length})</h2>
            ${
              tags.length === 0
                ? `<div class="p-8 text-center text-gray-500 discord-card rounded-2xl">No tags created yet. Add your first tag using the form on the left!</div>`
                : tags
                    .map(
                      (t) => `
              <div class="discord-card p-4 rounded-xl flex items-start justify-between gap-4">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2 mb-1">
                    <span class="font-bold text-sm text-blue-400">${escapeHtml(t.name)}</span>
                    ${t.category ? `<span class="bg-gray-800 text-gray-400 text-[10px] px-2 py-0.5 rounded font-medium">${escapeHtml(t.category)}</span>` : ""}
                    ${t.embed ? `<span class="bg-purple-900/40 text-purple-300 border border-purple-800 text-[10px] px-1.5 py-0.5 rounded font-medium">Embed</span>` : ""}
                  </div>
                  <p class="text-xs text-gray-300 whitespace-pre-wrap break-words leading-relaxed">${escapeHtml(t.content)}</p>
                  <span class="text-[10px] text-gray-500 mt-2 block">Uses: ${t.uses || 0}</span>
                </div>
                <form method="POST" action="/dashboard/tags/delete?guild=${guildId}&name=${encodeURIComponent(t.name)}">
                  <button type="submit" onclick="return confirm('Delete tag ${escapeHtml(t.name)}?')" class="text-red-400 hover:text-red-300 text-xs px-2 py-1 rounded bg-red-950/40 border border-red-900/60 transition">
                    Delete
                  </button>
                </form>
              </div>
            `,
                    )
                    .join("")
            }
          </div>
        </div>
      </div>
    `;

    res.send(renderHtml("Tags", content, user));
  });

  app.post("/dashboard/tags/save", requireStaff, (req, res) => {
    const { guildId } = getTargetGuild(req);
    const user = getSessionUser(req)!;
    const name = (req.body.name as string)?.trim().toLowerCase();
    const content = (req.body.content as string)?.trim();
    if (!name || !content) {
      res.redirect(`/dashboard/tags?guild=${guildId}`);
      return;
    }

    const existing = getTag(guildId, name);
    upsertTag({
      guildId,
      name,
      content,
      category: (req.body.category as string)?.trim() || null,
      embed: req.body.embed === "true",
      authorId: user.id,
      uses: existing?.uses ?? 0,
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    });

    res.redirect(`/dashboard/tags?guild=${guildId}`);
  });

  app.post("/dashboard/tags/delete", requireStaff, (req, res) => {
    const { guildId } = getTargetGuild(req);
    const name = (req.query.name as string)?.trim().toLowerCase();
    if (name) deleteTag(guildId, name);
    res.redirect(`/dashboard/tags?guild=${guildId}`);
  });

  // AutoMod
  app.get("/dashboard/automod", requireStaff, (req, res) => {
    const user = getSessionUser(req)!;
    const { guildId, cfg } = getTargetGuild(req);
    const am = cfg.automod;

    const content = `
      <div class="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 class="text-2xl font-extrabold text-white tracking-tight">AutoMod Protection</h1>
          <p class="text-sm text-gray-400">Dyno-style automatic content moderation rules and invite filters.</p>
        </div>

        <form method="POST" action="/dashboard/automod/save?guild=${guildId}" class="discord-card p-6 rounded-2xl space-y-6 shadow-xl">
          <div class="flex items-center justify-between pb-4 border-b border-gray-800">
            <div>
              <span class="font-bold text-white text-base block">Enable AutoMod System</span>
              <span class="text-xs text-gray-400">Master toggle for all automatic scanning and message deletion.</span>
            </div>
            <label class="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" name="enabled" value="true" ${am.enabled ? "checked" : ""} class="sr-only peer" />
              <div class="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          <div class="space-y-4">
            <div class="flex items-center justify-between p-4 bg-gray-900/60 rounded-xl border border-gray-800">
              <div>
                <span class="font-semibold text-sm text-gray-200 block">Anti-Discord Invites</span>
                <span class="text-xs text-gray-400">Automatically delete discord.gg / discord.com/invite links.</span>
              </div>
              <input type="checkbox" name="antiInvite" value="true" ${am.antiInvite ? "checked" : ""} class="rounded bg-gray-800 border-gray-700 text-blue-600 focus:ring-0 w-4 h-4" />
            </div>

            <div class="flex items-center justify-between p-4 bg-gray-900/60 rounded-xl border border-gray-800">
              <div>
                <span class="font-semibold text-sm text-gray-200 block">Anti-External Links</span>
                <span class="text-xs text-gray-400">Block all external http/https web links.</span>
              </div>
              <input type="checkbox" name="antiLinks" value="true" ${am.antiLinks ? "checked" : ""} class="rounded bg-gray-800 border-gray-700 text-blue-600 focus:ring-0 w-4 h-4" />
            </div>

            <div class="p-4 bg-gray-900/60 rounded-xl border border-gray-800 space-y-2">
              <div class="flex items-center justify-between">
                <div>
                  <span class="font-semibold text-sm text-gray-200 block">Mass Mention Spam Limit</span>
                  <span class="text-xs text-gray-400">Delete messages with more than this many user/role mentions (0 to disable).</span>
                </div>
                <input type="number" name="maxMentions" value="${am.maxMentions}" min="0" max="50" class="w-20 bg-gray-950 border border-gray-700 rounded px-2 py-1 text-sm text-white text-center" />
              </div>
            </div>

            <div class="p-4 bg-gray-900/60 rounded-xl border border-gray-800 space-y-2">
              <div class="flex items-center justify-between">
                <div>
                  <span class="font-semibold text-sm text-gray-200 block">Excessive Caps Threshold (%)</span>
                  <span class="text-xs text-gray-400">Delete messages with uppercase letters exceeding this percentage (0 to disable).</span>
                </div>
                <input type="number" name="capsPercent" value="${am.capsPercent}" min="0" max="100" class="w-20 bg-gray-950 border border-gray-700 rounded px-2 py-1 text-sm text-white text-center" />
              </div>
            </div>

            <div class="p-4 bg-gray-900/60 rounded-xl border border-gray-800 space-y-2">
              <label class="font-semibold text-sm text-gray-200 block">Blocked Words & Profanity List</label>
              <textarea name="blockedWords" rows="3" class="w-full bg-[#12141a] border border-gray-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500" placeholder="badword, scam, free-nitro (comma separated)">${am.blockedWords.join(", ")}</textarea>
              <span class="text-[11px] text-gray-400 block">Enter words separated by commas. Matches will be deleted immediately.</span>
            </div>

            <div class="p-4 bg-gray-900/60 rounded-xl border border-gray-800 space-y-2">
              <label class="font-semibold text-sm text-gray-200 block">Exempt Role IDs</label>
              <input type="text" name="exemptRoleIds" value="${am.exemptRoleIds.join(", ")}" class="w-full bg-[#12141a] border border-gray-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500" placeholder="123456789012345678, 987654321098765432" />
              <span class="text-[11px] text-gray-400 block">Members with these role IDs bypass all AutoMod rules.</span>
            </div>
          </div>

          <div class="flex justify-end pt-4 border-t border-gray-800">
            <button type="submit" class="bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs px-6 py-2.5 rounded-lg shadow-lg shadow-blue-500/20 transition">
              Save AutoMod Rules
            </button>
          </div>
        </form>
      </div>
    `;

    res.send(renderHtml("AutoMod", content, user));
  });

  app.post("/dashboard/automod/save", requireStaff, (req, res) => {
    const { guildId, cfg } = getTargetGuild(req);
    cfg.automod.enabled = req.body.enabled === "true";
    cfg.automod.antiInvite = req.body.antiInvite === "true";
    cfg.automod.antiLinks = req.body.antiLinks === "true";
    cfg.automod.maxMentions = Math.max(0, Number(req.body.maxMentions) || 0);
    cfg.automod.capsPercent = Math.max(0, Math.min(100, Number(req.body.capsPercent) || 0));

    const words = (req.body.blockedWords as string)
      ?.split(",")
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean) || [];
    cfg.automod.blockedWords = words;

    const exempt = (req.body.exemptRoleIds as string)
      ?.split(",")
      .map((r) => r.trim())
      .filter(Boolean) || [];
    cfg.automod.exemptRoleIds = exempt;

    saveGuildConfig(cfg);
    res.redirect(`/dashboard/automod?guild=${guildId}`);
  });

  // Autorole
  app.get("/dashboard/autorole", requireStaff, (req, res) => {
    const user = getSessionUser(req)!;
    const { guildId, cfg } = getTargetGuild(req);
    const autorole = cfg.autorole || { enabled: false, roleIds: [] };

    const content = `
      <div class="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 class="text-2xl font-extrabold text-white tracking-tight">Autorole Configuration</h1>
          <p class="text-sm text-gray-400">Automatically grant roles to members as soon as they join your server.</p>
        </div>

        <form method="POST" action="/dashboard/autorole/save?guild=${guildId}" class="discord-card p-6 rounded-2xl space-y-6 shadow-xl">
          <div class="flex items-center justify-between pb-4 border-b border-gray-800">
            <div>
              <span class="font-bold text-white text-base block">Enable Autorole System</span>
              <span class="text-xs text-gray-400">When enabled, the bot assigns configured roles upon member join.</span>
            </div>
            <label class="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" name="enabled" value="true" ${autorole.enabled ? "checked" : ""} class="sr-only peer" />
              <div class="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-gray-300 mb-2">Role IDs to Assign (Comma-separated)</label>
            <input type="text" name="roleIds" value="${autorole.roleIds.join(", ")}" class="w-full bg-[#12141a] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" placeholder="123456789012345678, 987654321098765432" />
            <span class="text-[11px] text-gray-500 mt-1 block">Make sure the bot's own role is higher in the Discord role hierarchy than the roles being assigned!</span>
          </div>

          <div class="flex justify-end pt-4 border-t border-gray-800">
            <button type="submit" class="bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs px-6 py-2.5 rounded-lg shadow-lg shadow-blue-500/20 transition">
              Save Autorole
            </button>
          </div>
        </form>
      </div>
    `;

    res.send(renderHtml("Autorole", content, user));
  });

  app.post("/dashboard/autorole/save", requireStaff, (req, res) => {
    const { guildId, cfg } = getTargetGuild(req);
    const enabled = req.body.enabled === "true";
    const roles = (req.body.roleIds as string)
      ?.split(",")
      .map((r) => r.trim())
      .filter(Boolean) || [];

    cfg.autorole = { enabled, roleIds: roles };
    saveGuildConfig(cfg);
    res.redirect(`/dashboard/autorole?guild=${guildId}`);
  });

  // Tickets List & Transcripts
  app.get("/dashboard/tickets", requireStaff, (req, res) => {
    const user = getSessionUser(req)!;
    const { guildId } = getTargetGuild(req);
    const tickets = getAllTickets(guildId);

    const content = `
      <div class="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 class="text-2xl font-extrabold text-white tracking-tight">Support Tickets & Transcripts</h1>
          <p class="text-sm text-gray-400">All Modmail tickets and their permanent public web transcript links.</p>
        </div>

        <div class="discord-card rounded-2xl overflow-hidden shadow-xl border border-gray-800">
          <table class="w-full text-left text-xs">
            <thead class="bg-[#12141a] border-b border-gray-800 text-gray-400 font-bold uppercase tracking-wider">
              <tr>
                <th class="p-4">Ticket</th>
                <th class="p-4">User</th>
                <th class="p-4">Category</th>
                <th class="p-4">Status</th>
                <th class="p-4">Opened</th>
                <th class="p-4">Transcript</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-800/80">
              ${
                tickets.length === 0
                  ? `<tr><td colspan="6" class="p-8 text-center text-gray-500">No tickets found.</td></tr>`
                  : tickets
                      .map(
                        (t) => `
                <tr class="hover:bg-gray-800/30 transition">
                  <td class="p-4 font-bold text-white">#${escapeHtml(t.id)}</td>
                  <td class="p-4 font-medium text-gray-200">${escapeHtml(t.username)}</td>
                  <td class="p-4">${escapeHtml(t.categoryEmoji)} ${escapeHtml(t.categoryLabel)}</td>
                  <td class="p-4">
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      t.status === "closed"
                        ? "bg-red-500/20 text-red-400"
                        : t.status === "resolving"
                        ? "bg-yellow-500/20 text-yellow-400"
                        : "bg-emerald-500/20 text-emerald-400"
                    }">
                      ${t.status.toUpperCase()}
                    </span>
                  </td>
                  <td class="p-4 text-gray-400">${new Date(t.createdAt).toLocaleDateString()}</td>
                  <td class="p-4">
                    <a href="/transcript/${t.id}" target="_blank" class="text-blue-400 hover:text-blue-300 font-semibold underline flex items-center gap-1">
                      View Online &rarr;
                    </a>
                  </td>
                </tr>
              `,
                      )
                      .join("")
              }
            </tbody>
          </table>
        </div>
      </div>
    `;

    res.send(renderHtml("Tickets", content, user));
  });

  app.listen(port, () => {
    console.log(`Web server & Support Dashboard listening on port ${port} (${baseUrl})`);
  });

  return app;
}
