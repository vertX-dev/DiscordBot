import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { logMod } from '../lib/moderation.js';

export const data = new SlashCommandBuilder()
  .setName('unban')
  .setDescription('Unbans a user by their ID.')
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
  .setDMPermission(false)
  .addStringOption((o) => o.setName('user_id').setDescription('The ID of the user to unban').setRequired(true))
  .addStringOption((o) => o.setName('reason').setDescription('Reason for the unban').setRequired(false));

export async function execute(interaction) {
  const id = interaction.options.getString('user_id').trim();
  const reason = interaction.options.getString('reason') ?? 'No reason provided';

  if (!/^\d{17,20}$/.test(id)) {
    return interaction.reply({ ephemeral: true, content: 'That does not look like a valid user ID.' });
  }

  const ban = await interaction.guild.bans.fetch(id).catch(() => null);
  if (!ban) return interaction.reply({ ephemeral: true, content: 'That user is not banned.' });

  await interaction.guild.bans.remove(id, `${reason} — by ${interaction.user.tag}`);
  await interaction.reply({ content: `♻️ Unbanned **${ban.user.tag}**. Reason: ${reason}` });
  await logMod(interaction.guild, { action: '♻️ User Unbanned', color: 0x2ecc71, user: ban.user, moderator: interaction.user, reason });
}
