/**
 * Built-in tags. They ship with the bot, and are saved for every Modmail server on startup.
 * They can be sent in any channel with /tag send. Inside a Modmail ticket, the message goes to the customer.
 * Emoji are the OnboardOps stars, shown in raw Discord format. Placeholders like {server} and {staff} are filled in when sent.
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
  // ----- Account and sign-in -----
  {
    name: "signin",
    category: "Account",
    content: `${S.blue} **Having trouble signing in?** We're sorry about that. Please try these steps in order:

> **1.** Reset your password at onboardops.org/login. The reset link arrives by email within a few minutes.
> **2.** Check your spam or junk folder for that email, and add our address to your contacts.
> **3.** If you use a passkey, try again on the same device you set it up on.
> **4.** Make sure your browser isn't blocking pop-ups or third-party cookies for onboardops.org.

If none of that works, reply here with the email address you sign in with (don't send your password), and our team will look into your account. ${S.white}`,
  },
  {
    name: "2fa",
    category: "Account",
    content: `${S.blue} **Lost access to your two-step sign-in?**

If you saved your **backup codes** when you turned two-step sign-in on, you can use one of them in place of the usual code. Each code works once.

If you don't have a backup code or your authenticator app any more, reply here with the email address on your account. Our team will walk you through verifying your identity before anything on the account changes.

> **Please never send** your password, a full backup code, or a one-time code in a ticket. We will never ask for them. ${S.orange}`,
  },
  {
    name: "passkey",
    category: "Account",
    content: `${S.lilac} **Passkey help**

A passkey signs you in with your fingerprint, face, or device PIN. It's set up in **Account settings → Passkeys**.

> • You can keep up to 10 passkeys, so add a second one on another device as a backup.
> • A passkey only works on the device or password manager where it was created.
> • If you lose every device with a passkey, sign in with your password and two-step code, then remove the lost passkey.

If you're locked out completely, reply here with your sign-in email, and we'll help you regain access. ${S.purple}`,
  },
  {
    name: "invite",
    category: "Account",
    content: `${S.green} **Invite not arriving?**

Invitations are sent automatically when a workspace admin adds you. Here's what usually helps:

> • Check your spam or junk folder, and search for "OnboardOps".
> • Make sure the email address is spelled exactly as your admin entered it.
> • Ask your admin to resend the invite from the Staff page. An old invite stops working once a new one is sent.
> • Wait a few minutes. Delivery can be slow on some email providers.

If it still doesn't arrive after all of that, tell us your workspace name and the email address the invite should go to, and we'll check it on our side. ${S.lightBlue}`,
  },
  {
    name: "deleteaccount",
    category: "Account",
    content: `${S.red} **About deleting your account**

You can delete your account yourself under **Account settings → Delete my account**. Here's what to know:

> • You'll be asked for your password and to type your email address to confirm.
> • The deletion is scheduled for **14 days** later, and you'll get an email with the date.
> • You can cancel it at any point during those 14 days from the same page.
> • Workspace records that your employer keeps (such as training history) stay with them.
> • If you're the only owner of a workspace, you'll need to make someone else an owner first.

If anything about this is unclear, reply here and we'll explain it. ${S.purple}`,
  },
  {
    name: "privacy",
    category: "Account",
    content: `${S.blue} **Privacy and your data**

> • **Download your data:** we can prepare a copy of your account data. Reply here with your sign-in email, and we'll confirm your identity first.
> • **Correct your data:** you can change your name, nickname, and contact details yourself in Account settings.
> • **Delete your data:** see the account deletion steps, or ask here.

Our full Privacy Policy is at onboardops.org/legal/privacy. We can't give legal advice, so for anything beyond how OnboardOps handles data, please speak with your own adviser. ${S.lightPink}`,
  },

  // ----- Workspaces and setup -----
  {
    name: "setup",
    category: "Setup",
    content: `${S.green} **Getting your workspace set up**

Here's the order that works best for most teams:

> **1.** Create your workspace and add your details.
> **2.** Add your departments and job roles.
> **3.** Invite your managers first, then the rest of the team.
> **4.** Build one course or checklist, then assign it to a small group to test it.

The two-minute tutorial at onboardops.org/tutorial walks through it step by step. ${S.white}`,
  },
  {
    name: "addstaff",
    category: "Setup",
    content: `${S.blue} **Adding staff to your workspace**

> • Go to the **Staff** page and choose **Invite**.
> • Pick a role. Owners and admins can manage the whole workspace, managers handle their teams, and employees see only their own records.
> • The invite is sent by email. It stops working once a new one is sent.

If someone needs a role you don't see, reply here and we'll explain your options. ${S.lilac}`,
  },
  {
    name: "roles",
    category: "Setup",
    content: `${S.purple} **Roles and permissions**

Each person in a workspace has one role. The role decides what they can see and change.

> • **Owner:** everything, including ownership and billing.
> • **Admin:** manages people, settings, and courses.
> • **Manager:** manages their own teams and records.
> • **Employee:** sees their own training, checklists, and shifts.

If you need a custom role, reply here and tell us what it should be able to do. ${S.pink}`,
  },
  {
    name: "transferowner",
    category: "Setup",
    content: `${S.orange} **Transferring ownership**

Ownership can be passed to another member of the workspace. Here's how:

> **1.** Add the new owner to the workspace, so they're a member already.
> **2.** The current owner changes that person's role to Owner on the Staff page.
> **3.** Decide whether the previous owner stays on as an admin.

A workspace must always have at least one owner. If you can't make the change yourself, reply here with your workspace name, and we'll help. ${S.red}`,
  },

  // ----- Training and checklists -----
  {
    name: "courses",
    category: "Training",
    content: `${S.green} **Building and assigning courses**

> • Open **Training** and choose **New course**. Add lessons in Markdown, and video links where helpful.
> • Add quiz questions. Quizzes are graded automatically, and you choose the pass mark.
> • Assign the course to a person, a department, or a job role.
> • People see their results and certificates in their own training page.

If a quiz isn't grading the way you expect, reply here with the course name, and we'll take a look. ${S.blue}`,
  },
  {
    name: "certificates",
    category: "Training",
    content: `${S.lilac} **Certificates**

Certificates are issued when someone passes a course. They can be printed, and each one has a code that anyone can check.

> • To find a certificate, open the person's training page.
> • The code on the certificate links back to the verification page.
> • If a certificate is wrong or missing, reply here with the course and the person's name.

We can't confirm a certificate's legal standing. For that, check the requirements with the body that issues the qualification. ${S.white}`,
  },
  {
    name: "checklists",
    category: "Training",
    content: `${S.purple} **Shift and onboarding checklists**

> • Create a checklist with each task on its own line.
> • Add a supervisor check if a task needs sign-off.
> • Assign the checklist to a shift, a role, or a person.
> • Completed checklists are saved with a time stamp.

If you'd like a checklist template to start from, let us know which kind of business you run. ${S.orange}`,
  },
  {
    name: "policies",
    category: "Training",
    content: `${S.blue} **Policies and sign-offs**

> • Add your policy in the **Policies** page, and give it a version number.
> • Choose who must read and sign it.
> • When you publish a new version, people are asked to sign it again.
> • Each sign-off is recorded with the date, time, and version.

Our free policy builder at onboardops.org/tools/policy-builder can help you draft one. Your policies should be checked by a qualified adviser before you rely on them. ${S.pink}`,
  },

  // ----- Shifts and daily operations -----
  {
    name: "shifts",
    category: "Operations",
    content: `${S.green} **Shifts**

> • Add shifts on the **Schedule** page, and assign people to them.
> • Shift checklists can be attached to each shift.
> • Staff see their upcoming shifts on their own page.

If you'd like shifts to repeat each week, reply here and we'll show you how. ${S.lightBlue}`,
  },
  {
    name: "import",
    category: "Operations",
    content: `${S.purple} **Importing people from a spreadsheet**

> • Export your list as a CSV file, with one row per person.
> • Use **Import** on the People page. You'll see a preview before anything changes.
> • Fix any rows the preview flags, then confirm.

Please check that the file contains only the people you want, and that you have permission to store their details. If an import doesn't look right, reply here and we'll look at it with you. ${S.lilac}`,
  },
  {
    name: "export",
    category: "Operations",
    content: `${S.blue} **Exporting your data**

Owners and admins can export records as CSV files. Exports include only what your role can see.

> • Go to the page you need, and choose **Export**.
> • Keep exports somewhere secure, since they contain personal details.
> • Delete any copies you no longer need.

If you need a full export of a workspace, reply here and we'll help. ${S.white}`,
  },
  {
    name: "notifications",
    category: "Operations",
    content: `${S.pink} **Notifications**

> • Email notifications can be turned on or off for each type of message in **Account settings**.
> • Quiet hours stop non-urgent alerts during the times you choose.
> • Workspaces can also send alerts to Discord, Slack, or Microsoft Teams from **Settings → Integrations**.

If you're getting too many alerts, reply here with the type, and we'll help you tune them. ${S.green}`,
  },

  // ----- Security and business questions -----
  {
    name: "security",
    category: "Security",
    content: `${S.orange} **Security questions**

Our security overview is at onboardops.org/security, and a printable summary is at onboardops.org/security/summary. These cover how we encrypt data, control access, and keep audit records.

> • Please don't include any real records, passwords, or personal data in a ticket.
> • To report a security problem, use the security contact listed on the security page. Don't post details in public channels.

We aim to be accurate about what we do and don't have in place. If you need a specific document for your own review, reply here and tell us what it's for. ${S.red}`,
  },
  {
    name: "dpa",
    category: "Legal",
    content: `${S.blue} **Data Processing Addendum**

If your organisation needs a signed data processing agreement, the standard addendum is published at onboardops.org/legal/data-processing.

> • Reply here with your organisation's name and who should sign.
> • Our team will confirm the terms that apply to your account.

We can't negotiate legal terms in a ticket, but we can answer questions about how the addendum works. ${S.lightBlue}`,
  },
  {
    name: "beta",
    category: "Billing",
    content: `${S.green} **About the beta**

OnboardOps is free during the beta. There's no credit card to start, and you don't need to do anything to keep your workspace.

> • The beta terms are at onboardops.org/legal/beta-terms.
> • Any change to pricing will be posted in the changelog first, with time to decide.

Questions about billing or pricing? Reply here, and we'll make sure the right person answers. ${S.purple}`,
  },
  {
    name: "refund",
    category: "Billing",
    content: `${S.orange} **Billing and refund questions**

Thanks for asking. Refunds and billing changes are reviewed by our team, so we can't promise an outcome in a ticket.

> • Reply with your workspace name, the email on the account, and the date of the charge.
> • Include a screenshot of the charge if you can, but blank out your card number.
> • We'll review it and reply here.

Please don't send full card details in a ticket. ${S.pink}`,
  },

  // ----- Developers -----
  {
    name: "apikey",
    category: "Developers",
    content: `${S.purple} **Working with API keys**

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
    name: "api",
    category: "Developers",
    content: `${S.blue} **API basics**

> • The base address is api.onboardops.org.
> • Send your key in the header: Authorization: Bearer your-key.
> • Requests are limited per minute, so back off and retry if you get a rate-limit response.
> • Every error includes a request ID. Send it to us if you need help.

The full endpoint list and examples are in the API reference at onboardops.org/support/api-reference. ${S.white}`,
  },

  // ----- Bugs and feedback -----
  {
    name: "bugreport",
    category: "Technical",
    content: `${S.red} **Thanks for reporting this!** Bugs are much easier to fix when we have the details. Please reply with:

> **1.** What you were doing right before the problem happened.
> **2.** What you expected to happen, and what actually happened.
> **3.** A screenshot or a short screen recording, if you can.
> **4.** The browser (or phone and app version) you were using, and the time it happened.
> **5.** Whether it happens every time or only sometimes.

Please don't include any passwords or personal records in the report. ${S.green}`,
  },
  {
    name: "slow",
    category: "Technical",
    content: `${S.orange} **Something loading slowly?**

A few quick things to try:

> • Refresh the page once, then wait a minute before trying again.
> • Check the live status at status.onboardops.org in case we're already working on it.
> • Try a different browser or turn off extensions for a moment.
> • Note the page and roughly the time, and send it to us.

If it stays slow, reply here with those details. ${S.lightPink}`,
  },
  {
    name: "feature",
    category: "Feedback",
    content: `${S.pink} **Thanks for the suggestion!** We read every request.

To help us understand it, it would be great to know:

> • **What problem** would this solve for you or your team?
> • **How often** do you run into it?
> • **What do you do today** instead?

You can also add your idea to the public roadmap at onboardops.org/roadmap. ${S.purple}`,
  },

  // ----- Team and general -----
  {
    name: "careers",
    category: "Team",
    content: `${S.lilac} **Thanks for your interest in joining us!**

We're always glad to hear from people who want to help small teams run better.

> • Send a short note about yourself and what you'd like to work on.
> • Attach your CV or a link to your portfolio.
> • Tell us your availability and where you're based.

We read every application. If there's a good fit, a member of our team will be in touch here. ${S.pink}`,
  },
  {
    name: "legal",
    category: "Legal",
    content: `${S.blue} **About your legal question**

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
    name: "status",
    category: "General",
    content: `${S.orange} **Checking in on the status of things?**

Live status, incidents, and planned maintenance are all posted at **status.onboardops.org**. That's the best place to check first.

> • If something isn't loading, look at the status page before you retry many times.
> • Updates are posted there as soon as we confirm them.
> • You can subscribe to email updates at onboardops.org/status-updates.

We appreciate your patience. ${S.green}`,
  },

  // ----- Ticket handling -----
  {
    name: "waiting",
    category: "Support",
    content: `${S.blue} **We're waiting on a detail from you.**

To keep moving, we need:

> • The information listed in your last message, or a screenshot of the problem.

Once we have it, we'll pick this up straight away. The ticket stays open until then, and writing back at any time reopens it. ${S.white}`,
  },
  {
    name: "handoff",
    category: "Support",
    content: `${S.purple} **Passing this to a specialist**

Thanks for your patience. This one needs a closer look from a colleague who works on this area day to day.

> • They'll pick it up in this same conversation.
> • You don't need to explain it again. Everything so far is in the ticket.

We'll reply here as soon as they've had a look. ${S.lilac}`,
  },
  {
    name: "thanks",
    category: "Support",
    content: `${S.green} **Thanks for reaching out!**

We're glad we could help. If anything else comes up, write back here, or open a new ticket by messaging this bot in DMs.

Thanks for being part of OnboardOps. ${S.pink}`,
  },
  {
    name: "nudge",
    category: "Support",
    content: `${S.blue} **Just checking in on your ticket.**

Did that sort things out? If you still need help, reply here and we'll pick it straight back up.

If we don't hear from you for a while, we'll close the ticket to keep things tidy. Writing back at any time reopens it, so nothing is lost. ${S.white}`,
  },
  {
    name: "closed",
    category: "Support",
    content: `${S.green} **This ticket is being closed.**

Thanks for reaching out to {server}. If you need anything else, you can:

> • Write back in this conversation at any time, and it reopens.
> • Open a new ticket by messaging this bot in DMs.
> • Check the help center at onboardops.org/support.

It was a pleasure helping you. ${S.lightPink}`,
  },
];

export const builtinTagByName = (name: string): BuiltinTag | undefined =>
  BUILTIN_TAGS.find((t) => t.name === name.trim().toLowerCase());
