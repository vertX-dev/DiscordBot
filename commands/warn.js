import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { hierarchyError, logMod } from '../lib/moderation.js';
import { addWarning } from '../lib/store.js';

export const data = new SlashCommandBuilder()
  .setName('warn')
  .setDescription('Issues a warning to a member (stored on their record).')
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .setDMPermission(false)
  .addUserOption((o) => o.setName('user').setDescription('The member to warn').setRequired(true))
  .addStringOption((o) => o.setName('reason').setDescription('Reason for the warning').setRequired(true));

export async function execute(interaction) {
  const user = interaction.options.getUser('user');
  const member = interaction.options.getMember('user');
  const reason = interaction.options.getString('reason');

  if (member) {
    const err = hierarchyError(interaction, member);
    if (err) return interaction.reply({ ephemeral: true, content: err });
  }

  const count = await addWarning(interaction.guild.id, user.id, {
    reason,
    moderator: interaction.user.tag,
    moderatorId: interaction.user.id,
    timestamp: Date.now(),
  });

  // Best-effort DM so the member knows.
  await user.send(`You were warned in **${interaction.guild.name}**: ${reason}`).catch(() => {});

  await interaction.reply({ content: `⚠️ Warned **${user.tag}**. They now have **${count}** warning(s). Reason: ${reason}` });
  await logMod(interaction.guild, {
    action: '⚠️ Member Warned', color: 0xf1c40f, user, moderator: interaction.user, reason,
    fields: [{ name: 'Total warnings', value: `${count}` }],
  });
}
