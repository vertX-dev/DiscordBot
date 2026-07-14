# Discord Bot

A modular Discord bot built with [discord.js](https://discord.js.org/) v14. Slash
commands are auto-loaded from the `commands/` folder, so adding a new command is
just dropping in a new file.

## Project structure

```
DiscordBot/
├── commands/            # One file per slash command (auto-loaded)
│   ├── ping.js
│   ├── hello.js
│   ├── serverinfo.js
│   └── userinfo.js
├── index.js             # Starts the bot, routes interactions to commands
├── deploy-commands.js   # Registers your slash commands with Discord
├── .env.example         # Template for your secrets — copy to .env
└── package.json
```

## Setup

### 1. Create the bot application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and click **New Application**.
2. Open the **Bot** tab → **Reset Token** → copy the token (you'll need it in step 3).
3. On the **General Information** tab, copy the **Application ID**.

### 2. Invite the bot to your server

On the **OAuth2 → URL Generator** tab:
- Scopes: check **`bot`** and **`applications.commands`**
- Bot Permissions: pick what you need (for the included commands, **Send Messages** is enough)
- Open the generated URL, pick your server, and authorize.

### 3. Configure your secrets

```bash
cp .env.example .env
```

Then open `.env` and fill in:
- `DISCORD_TOKEN` — the bot token from step 1
- `CLIENT_ID` — the Application ID from step 1
- `GUILD_ID` — your server ID (enable Developer Mode in Discord, then right-click your server → **Copy Server ID**)
- `DATABASE_URL` — Postgres connection string, only needed for `/bug` (see below)
- `BUG_CHANNEL_ID` — optional; `/bug` falls back to a forum channel named `bug-reports` if blank

> Keep `.env` private — it's already in `.gitignore`. Anyone with your token can control the bot.

### 4. Install dependencies

```bash
npm install
```

### 5. Register the slash commands

```bash
npm run deploy
```

Run this **once**, and again any time you add, remove, or change a command's name/description/options.
(With `GUILD_ID` set, changes appear instantly. Globally, they can take up to an hour.)

### 6. Start the bot

```bash
npm start
```

You should see `Logged in as ...` in the console. Try `/ping` in your server.

## Adding a new command

Create a new file in `commands/`, e.g. `commands/roll.js`:

```js
import { SlashCommandBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('roll')
  .setDescription('Rolls a six-sided die.');

export async function execute(interaction) {
  const result = Math.floor(Math.random() * 6) + 1;
  await interaction.reply(`🎲 You rolled a **${result}**!`);
}
```

Then run `npm run deploy` to register it, and restart the bot (`npm start`).
That's it — the handler picks it up automatically.

## Bug tracking (`/bug`)

`/bug report|status|close|list` is backed by a shared Postgres `bug_reports`
table (schema: `../projectManagerTUI/docs/bug_reports.sql`), so status changes
from Discord or the pm TUI converge automatically via `LISTEN`/`NOTIFY`. One-time
setup:

1. Provision a Postgres database (e.g. the Railway Postgres plugin) and run the
   schema once: `psql "$DATABASE_URL" -f ../projectManagerTUI/docs/bug_reports.sql`
2. Set `DATABASE_URL` in `.env`
3. Run `/setup` (creates the `Maintainer` role and the `#bug-reports` forum's
   status/severity tags) — safe to re-run
4. Give the `Maintainer` role to whoever should run `/bug status` / `/bug close`

If `DATABASE_URL` is unset the bot still starts, but bug sync is disabled
(logged at startup) and `/bug` will error when invoked.

## Common issues

- **Commands don't show up** → run `npm run deploy`, and make sure you invited the bot with the `applications.commands` scope.
- **`Used disallowed intents`** → a command needs an intent you haven't enabled. Add it to the `intents` array in `index.js` and, for privileged intents (e.g. Server Members), also toggle it on in the Developer Portal → Bot tab.
- **Bot is offline** → double-check `DISCORD_TOKEN` in `.env`.
