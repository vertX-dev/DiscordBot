import { SlashCommandBuilder } from 'discord.js';
import { createForumPost } from '../lib/forums.js';
import { awardXp } from '../lib/levels.js';

export const data = new SlashCommandBuilder()
  .setName('suggest')
  .setDescription('Post a suggestion to the #suggestions forum.')
  .setDMPermission(false)
  .addStringOption((o) => o.setName('title').setDescription('Short summary').setRequired(true).setMaxLength(100))
  .addStringOption((o) => o.setName('details').setDescription('More detail (optional)').setRequired(false).setMaxLength(1500));

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const title = interaction.options.getString('title');
  const details = interaction.options.getString('details') ?? '';

  const thread = await createForumPost(interaction.guild, 'suggestions', {
    title, body: details, author: interaction.user, color: 0xf1c40f,
  });
  if (!thread) return interaction.editReply('The **#suggestions** forum is missing — ask an admin to run `/setup`.');

  await awardXp(interaction.guild, interaction.member, 'suggestion').catch(() => {});
  return interaction.editReply(`Posted your suggestion: ${thread}. Thanks! 💡`);
}
