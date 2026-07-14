import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { hierarchyError, logMod } from '../lib/moderation.js';

export const data = new SlashCommandBuilder()
  .setName('ban')
  .setDescription('Bans a user from the server.')
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
  .setDMPermission(false)
  .addUserOption((o) => o.setName('user').setDescription('The user to ban').setRequired(true))
  .addStringOption((o) => o.setName('reason').setDescription('Reason for the ban').setRequired(false))
  .addIntegerOption((o) =>
    o.setName('delete_days')
      .setDescription('Days of their recent messages to delete (0–7)')
      .setMinValue(0).setMaxValue(7).setRequired(false));

export async function execute(interaction) {
  const user = interaction.options.getUser('user');
  const member = interaction.options.getMember('user');
  const reason = interaction.options.getString('reason') ?? 'No reason provided';
  const days = interaction.options.getInteger('delete_days') ?? 0;

  // member is null if the user isn't in the server — banning by ID is still allowed.
  if (member) {
    const err = hierarchyError(interaction, member);
    if (err) return interaction.reply({ ephemeral: true, content: err });
    if (!member.bannable) return interaction.reply({ ephemeral: true, content: "I can't ban that member." });
  }

  try {
    await interaction.guild.members.ban(user.id, {
      reason: `${reason} — by ${interaction.user.tag}`,
      deleteMessageSeconds: days * 86400,
    });
  } catch {
    return interaction.reply({ ephemeral: true, content: "I couldn't ban that user." });
  }

  await interaction.reply({ content: `🔨 Banned **${user.tag}**. Reason: ${reason}` });
  await logMod(interaction.guild, {
    action: '🔨 User Banned', color: 0xe74c3c, user, moderator: interaction.user, reason,
    fields: days ? [{ name: 'Messages deleted', value: `last ${days} day(s)` }] : [],
  });
}
