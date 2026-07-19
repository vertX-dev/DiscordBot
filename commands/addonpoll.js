import {
  SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, StringSelectMenuBuilder,
} from 'discord.js';
import { addons, WEEKLY_SLOT_BUDGET, MAX_VOTES } from '../config/addons.js';
import { newId, buildAddonEmbed } from '../lib/polls.js';
import { saveAddonPoll, getAddonPoll, latestOpenAddonPoll, updateAddonPoll } from '../lib/store.js';

export const data = new SlashCommandBuilder()
  .setName('addonpoll')
  .setDescription('Monthly addon-priority poll & ranking (difficulty-points / slot budget).')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false)
  .addSubcommand((s) =>
    s.setName('start').setDescription('Start a new monthly addon-priority poll')
      .addStringOption((o) => o.setName('month').setDescription('Label, e.g. "July 2026"').setRequired(false))
      .addBooleanOption((o) => o.setName('weighted').setDescription('Count votes by member level/activity (default: off)').setRequired(false)))
  .addSubcommand((s) => s.setName('results').setDescription('Show the current ranking'))
  .addSubcommand((s) => s.setName('end').setDescription('Close the active poll and post the final ranking'));

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const gid = interaction.guild.id;

  if (sub === 'start') {
    const poll = {
      id: newId(),
      addons: addons.map((a) => a.name),
      difficulty: Object.fromEntries(addons.map((a) => [a.name, a.difficulty])),
      budget: WEEKLY_SLOT_BUDGET,
      maxVotes: MAX_VOTES,
      month: interaction.options.getString('month') ?? null,
      votes: {},
      open: true,
      channelId: interaction.channelId,
      weighted: interaction.options.getBoolean('weighted') ?? false,
      weights: {},
    };

    const menu = new StringSelectMenuBuilder()
      .setCustomId(`addonpoll:${poll.id}`)
      .setPlaceholder(`Pick up to ${MAX_VOTES} addons you want prioritized`)
      .setMinValues(1)
      .setMaxValues(Math.min(MAX_VOTES, poll.addons.length))
      .addOptions(addons.map((a) => ({ label: a.name, description: `difficulty ${a.difficulty}`, value: a.name })));

    await interaction.reply({ embeds: [buildAddonEmbed(poll)], components: [new ActionRowBuilder().addComponents(menu)] });
    const message = await interaction.fetchReply();
    poll.messageId = message.id;
    await saveAddonPoll(gid, poll);
    return;
  }

  if (sub === 'results') {
    const poll = await latestOpenAddonPoll(gid);
    if (!poll) return interaction.reply({ ephemeral: true, content: 'There is no active addon poll. Start one with `/addonpoll start`.' });
    return interaction.reply({ embeds: [buildAddonEmbed(poll)] });
  }

  // end
  const poll = await latestOpenAddonPoll(gid);
  if (!poll) return interaction.reply({ ephemeral: true, content: 'There is no active addon poll to end.' });

  await updateAddonPoll(gid, poll.id, (p) => { p.open = false; });
  const closed = await getAddonPoll(gid, poll.id);

  // Refresh the original poll message (disable the menu) if we can find it.
  try {
    const channel = await interaction.client.channels.fetch(poll.channelId);
    const message = await channel.messages.fetch(poll.messageId);
    await message.edit({ embeds: [buildAddonEmbed(closed)], components: [] });
  } catch { /* original message gone — ignore */ }

  return interaction.reply({ embeds: [buildAddonEmbed(closed)], content: '🏁 **Poll closed — final ranking:**' });
}
