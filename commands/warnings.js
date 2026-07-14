import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { getWarnings, clearWarnings } from '../lib/store.js';

export const data = new SlashCommandBuilder()
  .setName('warnings')
  .setDescription('View or clear a member\'s warnings.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .setDMPermission(false)
  .addSubcommand((s) =>
    s.setName('list').setDescription('List a member\'s warnings')
      .addUserOption((o) => o.setName('user').setDescription('The member').setRequired(true)))
  .addSubcommand((s) =>
    s.setName('clear').setDescription('Clear all of a member\'s warnings')
      .addUserOption((o) => o.setName('user').setDescription('The member').setRequired(true)));

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const user = interaction.options.getUser('user');

  if (sub === 'clear') {
    const removed = clearWarnings(interaction.guild.id, user.id);
    return interaction.reply({ content: `🧹 Cleared **${removed}** warning(s) from **${user.tag}**.` });
  }

  const list = getWarnings(interaction.guild.id, user.id);
  if (!list.length) {
    return interaction.reply({ ephemeral: true, content: `**${user.tag}** has no warnings.` });
  }

  const embed = new EmbedBuilder()
    .setTitle(`⚠️ Warnings for ${user.tag}`)
    .setColor(0xf1c40f)
    .setThumbnail(user.displayAvatarURL())
    .setDescription(
      list
        .slice(-15)
        .map((w, i) => `**${i + 1}.** ${w.reason}\n— by ${w.moderator} · <t:${Math.floor(w.timestamp / 1000)}:R>`)
        .join('\n\n'),
    )
    .setFooter({ text: `${list.length} total warning(s)` });

  return interaction.reply({ ephemeral: true, embeds: [embed] });
}
