import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { logMod } from '../lib/moderation.js';

export const data = new SlashCommandBuilder()
  .setName('untimeout')
  .setDescription('Removes an active timeout from a member.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .setDMPermission(false)
  .addUserOption((o) => o.setName('user').setDescription('The member to un-timeout').setRequired(true))
  .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(false));

export async function execute(interaction) {
  const user = interaction.options.getUser('user');
  const member = interaction.options.getMember('user');
  const reason = interaction.options.getString('reason') ?? 'No reason provided';

  if (!member) return interaction.reply({ ephemeral: true, content: 'That user is not in this server.' });
  if (!member.isCommunicationDisabled()) {
    return interaction.reply({ ephemeral: true, content: 'That member is not currently timed out.' });
  }

  await member.timeout(null, `${reason} — by ${interaction.user.tag}`);
  await interaction.reply({ content: `🔊 Removed timeout from **${user.tag}**.` });
  await logMod(interaction.guild, { action: '🔊 Timeout Removed', color: 0x2ecc71, user, moderator: interaction.user, reason });
}
