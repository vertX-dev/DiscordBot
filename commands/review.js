import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } from 'discord.js';
import { REVIEW_STATUSES, STATUS_EMOJIS, STATUS_LABELS } from '../lib/reviews.js';

export const data = new SlashCommandBuilder()
  .setName('review')
  .setDescription('Mark a suggestion / bug-report post with a staff decision. Run inside the post.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .setDMPermission(false)
  .addStringOption((o) =>
    o.setName('status').setDescription('The decision').setRequired(true)
      .addChoices(...Object.entries(REVIEW_STATUSES).map(([value, d]) => ({ name: `${d.emoji} ${d.label}`, value }))))
  .addStringOption((o) => o.setName('note').setDescription('Optional note to the author').setRequired(false))
  .addBooleanOption((o) => o.setName('close').setDescription('Override whether to close the post').setRequired(false));

export async function execute(interaction) {
  const channel = interaction.channel;
  if (!channel?.isThread()) {
    return interaction.reply({ ephemeral: true, content: 'Run this **inside** a forum post or thread (e.g. in #suggestions or #bug-reports).' });
  }

  const key = interaction.options.getString('status');
  const decision = REVIEW_STATUSES[key];
  const note = interaction.options.getString('note');
  const close = interaction.options.getBoolean('close') ?? decision.close;

  const embed = new EmbedBuilder()
    .setTitle(`${decision.emoji} ${decision.label}`)
    .setColor(decision.color)
    .setDescription(note || `This was marked **${decision.label.toLowerCase()}** by the staff team.`)
    .setFooter({ text: `Reviewed by ${interaction.user.tag}` })
    .setTimestamp();

  await channel.send({ embeds: [embed] });

  // Apply the matching forum tag (preferred — shows in the post list), if the
  // post is in a forum that has the status tags from /setup.
  const parent = channel.parent;
  if (parent?.type === ChannelType.GuildForum) {
    const tag = parent.availableTags.find((t) => t.name === decision.label);
    if (tag) {
      const statusTagIds = new Set(parent.availableTags.filter((t) => STATUS_LABELS.includes(t.name)).map((t) => t.id));
      const kept = channel.appliedTags.filter((id) => !statusTagIds.has(id));
      await channel.setAppliedTags([...kept, tag.id].slice(0, 5)).catch(() => {});
    }
  }

  // Also prefix the thread title so the status reads at a glance (and covers
  // non-forum threads / forums without the tags).
  try {
    let base = channel.name;
    for (const e of STATUS_EMOJIS) {
      if (base.startsWith(e)) { base = base.slice(e.length).trim(); break; }
    }
    await channel.setName(`${decision.emoji} ${base}`.slice(0, 100));
  } catch { /* missing perms or rate limit — non-fatal */ }

  if (close) {
    await channel.setLocked(true).catch(() => {});
    await channel.setArchived(true).catch(() => {});
  }

  return interaction.reply({ ephemeral: true, content: `Marked this post **${decision.label}**${close ? ' and closed it' : ''}.` });
}
