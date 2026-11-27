/**
 * Built-in Modmail tags. They are only usable inside an open Modmail ticket thread, never in general channels.
 * A tag with the same name saved in a server overrides the built-in one. Placeholders such as {user} and {staff}
 * are filled in when the tag is sent. Emoji are the OnboardOps stars, shown in raw Discord format.
 */

export type BuiltinTag = { name: string; category: string; content: string };

const S = {
  white: "<:whitestar:1575910278770589776>",
  red: "<:redstar:1575910308977971391>",
  blue: "<:bluestar:1575910019545964574>",
  green: "<:greenstar:1575910280175689990>",
  purple: "<:purplestar:1575910307421753374>",
  orange: "<:orangestar:1575910288044200006>",
  pink: "<:pinkstar:1575910289499496509>",
  lilac: "<:lilacpurplestar:1575910286764806266>",
  lightBlue: "<:lightbluestar:1575910282323304458>",
  lightPink: "<:lightpinkstar:1575910283778592971>",
};

export const BUILTIN_TAGS: BuiltinTag[] = [
  {
    name: "signin",
    category: "Account",
    content: `${S.blue} **Having trouble signing in, {user}?** We're sorry about that. Please try these steps in order:

> **1.** Reset your password at onboardops.org/login. The reset link arrives by email within a few minutes.
> **2.** Check your spam or junk folder for that email, and add our address to your contacts.
> **3.** If you use a passkey, try again on the same device you set it up on.
> **4.** Make sure your browser isn't blocking pop-ups or third-party cookies for onboardops.org.

If none of that works, reply here with the email address you sign in with (don't send your password), and our team will look into your account. ${S.white}`,
  },
  {
    name: "2fa",
    category: "Account",
    content: `${S.blue} **Lost access to your two-step sign-in, {user}?**

If you saved your **backup codes** when you turned two-step sign-in on, you can use one of them in place of the usual code. Each code works once.

If you don't have a backup code or your authenticator app any more, reply here with the email address on your account. Our team will walk you through verifying your identity before anything on the account changes.

> **Please never send** your password, a full backup code, or a one-time code in a ticket. We will never ask for them. ${S.orange}`,
  },
  {
    name: "invite",
    category: "Account",
    content: `${S.green} **Invite not arriving, {user}?**

Invitations are sent automatically when a workspace admin adds you. Here's what usually helps:

> • Check your spam or junk folder, and search for "OnboardOps".
> • Make sure the email address is spelled exactly as your admin entered it.
> • Ask your admin to resend the invite from the Staff page. An old invite stops working once a new one is sent.
> • Wait a few minutes. Delivery can be slow on some email providers.

If it still doesn't arrive after all of that, tell us your workspace name and the email address the invite should go to, and we'll check it on our side. ${S.lightBlue}`,
  },
  {
    name: "apikey",
    category: "Developers",
    content: `${S.purple} **Working with API keys, {user}?**

There are two kinds of key:

> **Workspace keys** belong to the workspace. An owner or admin creates them under **Settings → Integrations**.
> **Personal keys** act as you, in one workspace you belong to. Create them under **Account settings**. They can do only what your role allows, and they stop working if you leave or your role changes.

**Good practice**
> • Give each system its own key, so you can revoke one without breaking the others.
> • Choose the smallest set of permissions that works.
> • Store keys in a secret manager or environment variables, never in code you share.

The full guide, including rotation and the error codes you might see, is at onboardops.org/support/api-keys. ${S.lilac}`,
  },
  {
    name: "bugreport",
    category: "Technical",
    content: `${S.red} **Thanks for reporting this, {user}!** Bugs are much easier to fix when we have the details. Please reply with:

> **1.** What you were doing right before the problem happened.
> **2.** What you expected to happen, and what actually happened.
> **3.** A screenshot or a short screen recording, if you can.
> **4.** The browser (or phone and app version) you were using, and the time it happened.
> **5.** Whether it happens every time or only sometimes.

Please don't include any passwords or personal records in the report. ${S.green}`,
  },
  {
    name: "feature",
    category: "Feedback",
    content: `${S.pink} **Thanks for the suggestion, {user}!** We read every request.

To help us understand it, it would be great to know:

> • **What problem** would this solve for you or your team?
> • **How often** do you run into it?
> • **What do you do today** instead?

You can also add your idea to the public roadmap discussion at onboardops.org/roadmap. ${S.purple}`,
  },
  {
    name: "legal",
    category: "Legal",
    content: `${S.blue} **About your legal question, {user}**

We're not able to give legal advice, and our team can't tell you how a law or contract applies to your situation. For that, please speak with a qualified adviser of your own.

What we can help with is how OnboardOps works. Our legal documents are published at onboardops.org/legal, including:

> • Terms of Service
> • Privacy Policy
> • Acceptable Use Policy
> • Data Processing Addendum
> • Employee Privacy Notice

If a question is about a specific workspace's records or policies, the workspace owner is the right person to ask. ${S.white}`,
  },
  {
    name: "careers",
    category: "Team",
    content: `${S.lilac} **Thanks for your interest in joining us, {user}!**

We're always glad to hear from people who want to help small teams run better.

> • Send us a short note about yourself and what you'd like to work on.
> • Attach your CV or a link to your portfolio.
> • Tell us your availability and where you're based.

We read every application. If there's a good fit, a member of our team will be in touch here. ${S.pink}`,
  },
  {
    name: "status",
    category: "General",
    content: `${S.orange} **Thanks for checking in, {user}.**

Live status, incidents, and planned maintenance are all posted at **status.onboardops.org**. That's the best place to check first.

> • If something isn't loading, look at the status page before you retry many times.
> • Updates are posted there as soon as we confirm them.
> • You can subscribe to email updates at onboardops.org/status-updates.

We appreciate your patience. ${S.green}`,
  },
  {
    name: "nudge",
    category: "Support",
    content: `${S.blue} **Just checking in on your ticket, {user}.**

Did that sort things out? If you still need help, reply here and we'll pick it straight back up.

If we don't hear from you for a while, we'll close the ticket to keep things tidy. Writing back at any time reopens it, so nothing is lost. ${S.white}`,
  },
  {
    name: "deleteaccount",
    category: "Account",
    content: `${S.red} **About deleting your account, {user}**

You can delete your account yourself under **Account settings → Delete my account**. Here's what to know:

> • You'll be asked for your password and to type your email address to confirm.
> • The deletion is scheduled for **14 days** later, and you'll get an email with the date.
> • You can cancel it at any point during those 14 days from the same page.
> • Workspace records that your employer keeps (such as training history) stay with them.
> • If you're the only owner of a workspace, you'll need to make someone else an owner first.

If anything about this is unclear, reply here and we'll explain it. ${S.purple}`,
  },
  {
    name: "closed",
    category: "Support",
    content: `${S.green} **This ticket is being closed, {user}.**

Thanks for reaching out to {server}. If you need anything else, you can:

> • Write back in this conversation at any time, and it reopens.
> • Open a new ticket by messaging this bot in DMs.
> • Check the help center at onboardops.org/support.

It was a pleasure helping you. ${S.lightPink}`,
  },
];

export const builtinTagByName = (name: string): BuiltinTag | undefined =>
  BUILTIN_TAGS.find((t) => t.name === name.trim().toLowerCase());
