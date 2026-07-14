import { SlashCommandBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('hello')
  .setDescription('Greets you, or someone you mention.')
  .addUserOption((option) =>
    option
      .setName('user')
      .setDescription('The person to greet (defaults to you).')
      .setRequired(false),
  );

export async function execute(interaction) {
  const target = interaction.options.getUser('user') ?? interaction.user;
  await interaction.reply(`Hello, ${target}! 👋`);
}
