import { SlashCommandBuilder } from 'discord.js';
import { createForumPost } from '../lib/forums.js';
import { awardXp } from '../lib/levels.js';

export const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Open a help request in the #help forum.')
  .setDMPermission(false)
  .addStringOption((o) => o.setName('title').setDescription('What do you need help with?').setRequired(true).setMaxLength(100))
  .addStringOption((o) => o.setName('details').setDescription('More detail (optional)').setRequired(false).setMaxLength(1500));

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const title = interaction.options.getString('title');
  const details = interaction.options.getString('details') ?? '';

  const thread = await createForumPost(interaction.guild, 'help', {
    title, body: details, author: interaction.user, color: 0x3498db,
  });
  if (!thread) return interaction.editReply('The **#help** forum is missing — ask an admin to run `/setup`.');

  await awardXp(interaction.guild, interaction.member, 'help').catch(() => {});
  return interaction.editReply(`Opened your help post: ${thread}. Someone will chime in. 🙋`);
}
