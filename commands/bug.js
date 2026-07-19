import {
  SlashCommandBuilder, EmbedBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder,
} from 'discord.js';
import {
  BUG_STATUSES, BUG_SEVERITIES, MAINTAINER_ROLE, isMaintainer,
  buildBugEmbed, resolveBugChannel,
} from '../lib/bugs.js';
import { insertBug, attachDiscordIds, updateBugStatus, listBugs, distinctProjects } from '../lib/db.js';
import { awardXp } from '../lib/levels.js';

export const data = new SlashCommandBuilder()
  .setName('bug')
  .setDescription('Report and manage bugs (synced with the pm tracker).')
  .setDMPermission(false)
  .addSubcommand((sc) => sc.setName('report').setDescription('Report a new bug.')
    .addStringOption((o) => o.setName('project').setDescription('Project name').setRequired(true).setAutocomplete(true))
    .addStringOption((o) => o.setName('severity').setDescription('Severity').setRequired(true)
      .addChoices(...Object.entries(BUG_SEVERITIES).map(([value, s]) => ({ name: s.label, value })))))
  .addSubcommand((sc) => sc.setName('status').setDescription(`Change a bug's status. (@${MAINTAINER_ROLE} only)`)
    .addIntegerOption((o) => o.setName('id').setDescription('Bug id').setRequired(true))
    .addStringOption((o) => o.setName('status').setDescription('New status').setRequired(true)
      .addChoices(...Object.entries(BUG_STATUSES).map(([value, s]) => ({ name: s.label, value })))))
  .addSubcommand((sc) => sc.setName('close').setDescription(`Close a bug. (@${MAINTAINER_ROLE} only)`)
    .addIntegerOption((o) => o.setName('id').setDescription('Bug id').setRequired(true))
    .addStringOption((o) => o.setName('resolution').setDescription('Resolution').setRequired(true)
      .addChoices({ name: 'Resolved', value: 'resolved' }, { name: 'Wontfix', value: 'wontfix' })))
  .addSubcommand((sc) => sc.setName('list').setDescription('List bugs.')
    .addStringOption((o) => o.setName('project').setDescription('Filter by project').setRequired(false).setAutocomplete(true))
    .addStringOption((o) => o.setName('status').setDescription('Filter by status').setRequired(false)
      .addChoices(...Object.entries(BUG_STATUSES).map(([value, s]) => ({ name: s.label, value })))));

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused().toLowerCase();
  const projects = await distinctProjects().catch(() => []);
  const filtered = projects.filter((p) => p.toLowerCase().includes(focused)).slice(0, 25);
  await interaction.respond(filtered.map((p) => ({ name: p, value: p })));
}

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'report') return report(interaction);
  if (sub === 'status') return statusCmd(interaction);
  if (sub === 'close') return closeCmd(interaction);
  if (sub === 'list') return list(interaction);
}

// --- /bug report: slash options collect project+severity, a modal collects
// title+body (v14 modals only take text inputs, so those two ride the command
// itself as autocomplete/choices instead). --------------------------------
function buildModalId(project, severity) {
  return `bugreport|${encodeURIComponent(project)}|${severity}`;
}

function parseModalId(customId) {
  const [, projectEnc, severity] = customId.split('|');
  return { project: decodeURIComponent(projectEnc), severity };
}

async function report(interaction) {
  const project = interaction.options.getString('project');
  const severity = interaction.options.getString('severity');

  const modal = new ModalBuilder()
    .setCustomId(buildModalId(project, severity))
    .setTitle(`Report a bug — ${project}`.slice(0, 45));

  const titleInput = new TextInputBuilder()
    .setCustomId('title').setLabel('Title').setStyle(TextInputStyle.Short)
    .setRequired(true).setMaxLength(100);
  const bodyInput = new TextInputBuilder()
    .setCustomId('body').setLabel('Description').setStyle(TextInputStyle.Paragraph)
    .setRequired(false).setMaxLength(1500);

  modal.addComponents(
    new ActionRowBuilder().addComponents(titleInput),
    new ActionRowBuilder().addComponents(bodyInput),
  );

  await interaction.showModal(modal);
}

export async function handleBugReportModal(interaction) {
  const { project, severity } = parseModalId(interaction.customId);
  const title = interaction.fields.getTextInputValue('title');
  const body = interaction.fields.getTextInputValue('body') || '';

  await interaction.deferReply({ ephemeral: true });

  const bugChannel = await resolveBugChannel(interaction.guild);
  if (!bugChannel) {
    return interaction.editReply('The **#bug-reports** forum is missing — ask an admin to run `/setup`.');
  }

  const bug = await insertBug({ project, title, body, severity, reporter: interaction.user.tag });

  const tagNames = [BUG_STATUSES[bug.status].label, BUG_SEVERITIES[bug.severity].label];
  const tagIds = tagNames.map((name) => bugChannel.availableTags.find((t) => t.name === name)?.id).filter(Boolean);

  const thread = await bugChannel.threads.create({
    name: `[${project}] ${title}`.slice(0, 100),
    message: { embeds: [buildBugEmbed(bug)] },
    appliedTags: tagIds,
  });

  const starter = await thread.fetchStarterMessage();
  await attachDiscordIds(bug.id, { channelId: bugChannel.id, messageId: starter.id, threadId: thread.id });

  await awardXp(interaction.guild, interaction.member, 'bug').catch(() => {});
  return interaction.editReply(`Reported bug **#${bug.id}** in ${thread}.`);
}

// --- /bug status, /bug close: plain UPDATEs. The BEFORE UPDATE trigger fires
// pg_notify, and the persistent LISTEN handler (lib/bugs.js) does the Discord
// edit — same path the pm TUI's own UPDATE takes. -----------------------------
async function statusCmd(interaction) {
  if (!isMaintainer(interaction.member)) {
    return interaction.reply({ ephemeral: true, content: `Only **@${MAINTAINER_ROLE}** can change bug status.` });
  }
  const id = interaction.options.getInteger('id');
  const status = interaction.options.getString('status');
  const bug = await updateBugStatus(id, status);
  if (!bug) return interaction.reply({ ephemeral: true, content: `No bug **#${id}** found.` });
  return interaction.reply({ ephemeral: true, content: `Bug **#${id}** set to **${BUG_STATUSES[status].label}**.` });
}

async function closeCmd(interaction) {
  if (!isMaintainer(interaction.member)) {
    return interaction.reply({ ephemeral: true, content: `Only **@${MAINTAINER_ROLE}** can close bugs.` });
  }
  const id = interaction.options.getInteger('id');
  const resolution = interaction.options.getString('resolution');
  const bug = await updateBugStatus(id, resolution);
  if (!bug) return interaction.reply({ ephemeral: true, content: `No bug **#${id}** found.` });
  return interaction.reply({ ephemeral: true, content: `Bug **#${id}** closed as **${BUG_STATUSES[resolution].label}**.` });
}

async function list(interaction) {
  const project = interaction.options.getString('project');
  const status = interaction.options.getString('status');
  const bugs = await listBugs({ project, status });

  if (!bugs.length) return interaction.reply({ ephemeral: true, content: 'No bugs found.' });

  const lines = bugs.map((b) => {
    const s = BUG_STATUSES[b.status];
    const ref = b.discord_thread_id
      ? `[#${b.id}](https://discord.com/channels/${interaction.guild.id}/${b.discord_thread_id})`
      : `#${b.id}`;
    return `${s.emoji} ${ref} **${b.title}** (${b.project}) — ${s.label}`;
  });

  const embed = new EmbedBuilder()
    .setTitle('🐛 Bugs')
    .setColor(0x5865f2)
    .setDescription(lines.join('\n'))
    .setFooter({ text: `${bugs.length} shown (max 25)` });

  return interaction.reply({ embeds: [embed], ephemeral: true });
}
