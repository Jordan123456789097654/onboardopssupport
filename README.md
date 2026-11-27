# OnboardOps Public Discord Bot

Public community & support bot — **no server-wipe `/setup`**. Invite it to any Discord server and configure only what you want.

## Features
- **Modmail (DM Support):**
  - Users DM the bot → pick a category from the dropdown (`General Questions`, `Technical Help`, `Licenses & Orders`, `Careers & Team`, or your own custom categories).
  - Opens a dedicated thread in your Modmail inbox channel with **Claim**, **Transfer**, **Resolve (2h)**, and **Close Now** buttons.
  - Staff can type directly in the thread (or use `/reply` / `/r`), add internal notes (`//...` or `/note`), transfer to another category/staff/role (`/transfer`), schedule delayed auto-close (`/resolve [delay]`, automatically cancelled if the user replies!), or close immediately with a `.txt` transcript (`/close`).
- **Tags & Snippets (`/tag`):**
  - `/tag send`, `/tag create`, `/tag edit`, `/tag delete`, `/tag list`, `/tag info` with live autocomplete and variables (`{user}`, `{username}`, `{server}`, `{staff}`, `{ticket_id}`).
  - Works in both normal channels and inside Modmail ticket threads (sending the tag straight to the user's DM).
- **Dyno-Style Moderation & AutoMod:**
  - `/warn`, `/warnings`, `/delwarn`, `/clearwarns`
  - `/mute` (`/timeout`), `/unmute`, `/kick`, `/ban`, `/softban`, `/unban`
  - `/case`, `/reason`, `/modlogs`, `/modlog set|off`
  - `/purge` (with user/text/bot filters), `/slowmode`, `/lock`, `/unlock`, `/nick`, `/role`, `/automod`
- **Utilities:** `/whois`, `/serverinfo`, `/avatar`, `/announce`, `/ping`, `/help`.

## Setup on Railway
1. Add a new service from `Jordan123456789097654/OnboardOps-Status` with **Root Directory** = `/public-bot`.
2. In the **Discord Developer Portal** for your public bot app:
   - Under **Bot → Privileged Gateway Intents**, turn ON **Message Content Intent** (and optionally **Server Members Intent**).
   - Under **OAuth2 → URL Generator**, select `bot` + `applications.commands`.
3. In Railway **Variables**, set:
   - `DISCORD_TOKEN`
   - `DISCORD_CLIENT_ID`
   - `DATABASE_URL` *(optional — e.g. `${{Postgres.DATABASE_URL}}` so cases, tags, and tickets persist across redeploys)*
4. In Discord, run:
   - `/modmail-config channel #modmail` *(pick any existing channel)*
   - `/modmail-config staff-role @Support` *(optional)*
   - `/modlog set #mod-logs` *(optional)*
