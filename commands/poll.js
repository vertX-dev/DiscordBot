import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { newId, buildPollEmbed } from '../lib/polls.js';
import { savePoll } from '../lib/store.js';

const LABELS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];

const builder = new SlashCommandBuilder()
  .setName('poll')
  .setDescription('Creates a poll with up to 5 options and live vote counts.')
  .setDMPermission(false)
  .addStringOption((o) => o.setName('question').setDescription('The poll question').setRequired(true))
  .addStringOption((o) => o.setName('option1').setDescription('Option 1').setRequired(true))
  .addStringOption((o) => o.setName('option2').setDescription('Option 2').setRequired(true));
for (let i = 3; i <= 5; i++) {
  builder.addStringOption((o) => o.setName(`option${i}`).setDescription(`Option ${i}`).setRequired(false));
}
export const data = builder;

export async function execute(interaction) {
  const question = interaction.options.getString('question');
  const options = [];
  for (let i = 1; i <= 5; i++) {
    const label = interaction.options.getString(`option${i}`);
    if (label) options.push({ label, votes: [] });
  }

  const poll = { id: newId(), question, options, open: true, channelId: interaction.channelId };

  const voteRow = new ActionRowBuilder().addComponents(
    options.map((o, i) =>
      new ButtonBuilder().setCustomId(`poll:${poll.id}:${i}`).setLabel(`${i + 1}`).setEmoji(LABELS[i]).setStyle(ButtonStyle.Primary)),
  );
  const endRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pollend:${poll.id}`).setLabel('End poll').setStyle(ButtonStyle.Danger),
  );

  await interaction.reply({ embeds: [buildPollEmbed(poll)], components: [voteRow, endRow] });
  const message = await interaction.fetchReply();
  poll.messageId = message.id;
  await savePoll(interaction.guild.id, poll);
}
