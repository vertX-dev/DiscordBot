import 'dotenv/config';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { REST, Routes } from 'discord.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error('Missing DISCORD_TOKEN or CLIENT_ID in your .env file.');
  process.exit(1);
}

// --- Collect the slash command definitions -------------------------------
const commands = [];
const commandsPath = join(__dirname, 'commands');
const commandFiles = readdirSync(commandsPath).filter((file) => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = await import(pathToFileURL(join(commandsPath, file)).href);
  if ('data' in command && 'execute' in command) {
    commands.push(command.data.toJSON());
  } else {
    console.warn(`[WARN] ${file} is missing a "data" or "execute" export and was skipped.`);
  }
}

// --- Push them to Discord -------------------------------------------------
const rest = new REST().setToken(DISCORD_TOKEN);

try {
  console.log(`Registering ${commands.length} slash command(s)...`);

  // If GUILD_ID is set, register to that one server (updates instantly — best
  // for development). Otherwise register globally (can take up to an hour).
  const route = GUILD_ID
    ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
    : Routes.applicationCommands(CLIENT_ID);

  const data = await rest.put(route, { body: commands });

  console.log(`Successfully registered ${data.length} command(s) ${GUILD_ID ? `to guild ${GUILD_ID}` : 'globally'}.`);
} catch (error) {
  console.error(error);
}
