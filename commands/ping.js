import { SlashCommandBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('ping')
  .setDescription('Checks if the bot is online and shows its latency.');

export async function execute(interaction) {
  const sent = await interaction.reply({ content: 'Pinging...', fetchReply: true });
  const roundtrip = sent.createdTimestamp - interaction.createdTimestamp;
  await interaction.editReply(
    `Pong! Roundtrip: **${roundtrip}ms** · API: **${Math.round(interaction.client.ws.ping)}ms**`,
  );
}
