import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { hierarchyError, logMod, parseDuration, humanDuration, MAX_TIMEOUT } from '../lib/moderation.js';

export const data = new SlashCommandBuilder()
  .setName('timeout')
  .setDescription('Temporarily mutes a member (max 28 days).')
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .setDMPermission(false)
  .addUserOption((o) => o.setName('user').setDescription('The member to time out').setRequired(true))
  .addStringOption((o) => o.setName('duration').setDescription('e.g. 10m, 1h, 1d, 1h30m').setRequired(true))
  .addStringOption((o) => o.setName('reason').setDescription('Reason for the timeout').setRequired(false));

export async function execute(interaction) {
  const user = interaction.options.getUser('user');
  const member = interaction.options.getMember('user');
  const reason = interaction.options.getString('reason') ?? 'No reason provided';

  const ms = parseDuration(interaction.options.getString('duration'));
  if (!ms || ms < 1000) {
    return interaction.reply({ ephemeral: true, content: 'Invalid duration. Use formats like `10m`, `1h`, `2d`.' });
  }
  const clamped = Math.min(ms, MAX_TIMEOUT);

  if (!member) return interaction.reply({ ephemeral: true, content: 'That user is not in this server.' });
  const err = hierarchyError(interaction, member);
  if (err) return interaction.reply({ ephemeral: true, content: err });
  if (!member.moderatable) return interaction.reply({ ephemeral: true, content: "I can't time out that member." });

  await member.timeout(clamped, `${reason} — by ${interaction.user.tag}`);
  const dur = humanDuration(clamped);
  await interaction.reply({ content: `🔇 Timed out **${user.tag}** for **${dur}**. Reason: ${reason}` });
  await logMod(interaction.guild, {
    action: '🔇 Member Timed Out', color: 0xf1c40f, user, moderator: interaction.user, reason,
    fields: [{ name: 'Duration', value: dur }],
  });
}
