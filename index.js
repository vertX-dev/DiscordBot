import 'dotenv/config';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client, Collection, Events, GatewayIntentBits } from 'discord.js';
import { handleComponent } from './lib/components.js';
import { handleBugReportModal } from './commands/bug.js';
import { startBugSync } from './lib/bugs.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Guilds intent is all that's needed for slash commands and the setup flow.
// Add more intents here (e.g. GuildMembers) as your commands require them.
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// --- Auto-load every command in the commands/ folder ---------------------
client.commands = new Collection();
const commandsPath = join(__dirname, 'commands');
const commandFiles = readdirSync(commandsPath).filter((file) => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = await import(pathToFileURL(join(commandsPath, file)).href);
  if ('data' in command && 'execute' in command) {
    client.commands.set(command.data.name, command);
  } else {
    console.warn(`[WARN] ${file} is missing a "data" or "execute" export and was skipped.`);
  }
}

// --- Route incoming interactions -----------------------------------------
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) {
        console.error(`No command matching "${interaction.commandName}" was found.`);
        return;
      }
      await command.execute(interaction);
      return;
    }

    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      if (command?.autocomplete) await command.autocomplete(interaction);
      return;
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('bugreport|')) await handleBugReportModal(interaction);
      return;
    }

    // Buttons and select menus (rules Accept button, project-role picker, ...)
    if (interaction.isButton() || interaction.isStringSelectMenu()) {
      await handleComponent(interaction);
    }
  } catch (error) {
    console.error('Interaction error:', error);
    if (interaction.isRepliable()) {
      const reply = { content: 'There was an error while handling that interaction.', ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(reply).catch(() => {});
      } else {
        await interaction.reply(reply).catch(() => {});
      }
    }
  }
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag} — ready to serve ${client.commands.size} command(s).`);
  startBugSync(readyClient);
});

client.login(process.env.DISCORD_TOKEN);
