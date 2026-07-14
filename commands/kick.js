import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { hierarchyError, logMod } from '../lib/moderation.js';

export const data = new SlashCommandBuilder()
  .setName('kick')
  .setDescription('Kicks a member from the server.')
  .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
  .setDMPermission(false)
  .addUserOption((o) => o.setName('user').setDescription('The member to kick').setRequired(true))
  .addStringOption((o) => o.setName('reason').setDescription('Reason for the kick').setRequired(false));

export async function execute(interaction) {
  const user = interaction.options.getUser('user');
  const member = interaction.options.getMember('user');
  const reason = interaction.options.getString('reason') ?? 'No reason provided';

  if (!member) return interaction.reply({ ephemeral: true, content: 'That user is not in this server.' });
  const err = hierarchyError(interaction, member);
  if (err) return interaction.reply({ ephemeral: true, content: err });
  if (!member.kickable) return interaction.reply({ ephemeral: true, content: "I can't kick that member." });

  await member.kick(`${reason} — by ${interaction.user.tag}`);
  await interaction.reply({ content: `👢 Kicked **${user.tag}**. Reason: ${reason}` });
  await logMod(interaction.guild, { action: '👢 Member Kicked', color: 0xe67e22, user, moderator: interaction.user, reason });
}
