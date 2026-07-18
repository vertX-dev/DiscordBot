import {
  SlashCommandBuilder, PermissionFlagsBits, ChannelType,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
} from 'discord.js';
import {
  saveBetatest, getBetatest, updateBetatest, listBetatests, nextBetatestId,
} from '../lib/store.js';
import { buildBetaEmbed, betaRoleName, betaChannelName, BETA_CATEGORY } from '../lib/betatest.js';

const P = PermissionFlagsBits;

export const data = new SlashCommandBuilder()
  .setName('betatest')
  .setDescription('Run project beta tests: private channel + tester role, opt-in via an announcement.')
  .setDefaultMemberPermissions(P.ManageRoles)
  .setDMPermission(false)
  .addSubcommand((sc) => sc.setName('start').setDescription('Start a beta test for a project.')
    .addRoleOption((o) => o.setName('project').setDescription('Project role — also the role required to apply').setRequired(true))
    .addIntegerOption((o) => o.setName('limit').setDescription('Max testers (default: no limit)').setRequired(false).setMinValue(1)))
  .addSubcommand((sc) => sc.setName('end').setDescription('End a beta test: delete its role + channel, close applications.')
    .addStringOption((o) => o.setName('id').setDescription('Beta test id').setRequired(true).setAutocomplete(true)));

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused().toLowerCase();
  const choices = listBetatests(interaction.guild.id)
    .filter((b) => b.open)
    .filter((b) => String(b.id).includes(focused) || b.project.toLowerCase().includes(focused))
    .slice(0, 25)
    .map((b) => ({ name: `#${b.id} — ${b.project} (${b.testers.length}${b.limit ? `/${b.limit}` : ''})`, value: String(b.id) }));
  await interaction.respond(choices);
}

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'start') return start(interaction);
  if (sub === 'end') return end(interaction);
}

async function ensureBetaCategory(guild, botId) {
  const existing = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === BETA_CATEGORY);
  if (existing) return existing;
  const everyone = guild.roles.everyone.id;
  const adminRole = guild.roles.cache.find((r) => r.name === 'Admin');
  const ov = [
    { id: everyone, deny: [P.ViewChannel] },
    { id: botId, allow: [P.ViewChannel, P.SendMessages, P.ManageChannels] },
  ];
  if (adminRole) ov.push({ id: adminRole.id, allow: [P.ViewChannel] });
  return guild.channels.create({ name: BETA_CATEGORY, type: ChannelType.GuildCategory, permissionOverwrites: ov, reason: 'Beta tests' })
    .catch(() => null);
}

async function start(interaction) {
  const { guild } = interaction;
  const me = guild.members.me;
  if (!me.permissions.has(P.ManageRoles) || !me.permissions.has(P.ManageChannels)) {
    return interaction.reply({ ephemeral: true, content: 'I need **Manage Roles** and **Manage Channels** (or Administrator).' });
  }
  await interaction.deferReply({ ephemeral: true });

  const projectRole = interaction.options.getRole('project');
  const limit = interaction.options.getInteger('limit') ?? null;
  const id = String(nextBetatestId(guild.id));
  const project = projectRole.name;

  // 1) Tester role (fresh, lands below the bot so it can be assigned).
  const betaRole = await guild.roles.create({
    name: betaRoleName(project, id), mentionable: true, reason: `Beta test #${id} (${project})`,
  });

  // 2) Private channel under the Beta Tests category: beta role + Admin + bot.
  const category = await ensureBetaCategory(guild, me.id);
  const everyone = guild.roles.everyone.id;
  const adminRole = guild.roles.cache.find((r) => r.name === 'Admin');
  const overwrites = [
    { id: everyone, deny: [P.ViewChannel] },
    { id: betaRole.id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory] },
    { id: me.id, allow: [P.ViewChannel, P.SendMessages, P.ManageMessages, P.ManageChannels] },
  ];
  if (adminRole) overwrites.push({ id: adminRole.id, allow: [P.ViewChannel] });
  const channel = await guild.channels.create({
    name: betaChannelName(project, id), type: ChannelType.GuildText,
    parent: category?.id, permissionOverwrites: overwrites,
    topic: `Private beta test for ${project} (#${id}).`, reason: `Beta test #${id}`,
  });

  // 3) Announcement with the Apply button, pinging the project role.
  const announceChannel = guild.channels.cache.find((c) => c.name === 'announcements' && c.isTextBased?.()) ?? interaction.channel;
  const bt = {
    id, project, projectRoleId: projectRole.id, roleId: betaRole.id, channelId: channel.id,
    announceChannelId: announceChannel.id, limit, testers: [], open: true, createdBy: interaction.user.id,
  };
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`betatest:apply:${id}`).setLabel('Apply to test').setEmoji('🧪').setStyle(ButtonStyle.Success),
  );
  const msg = await announceChannel.send({
    content: `<@&${projectRole.id}>`,
    embeds: [buildBetaEmbed(bt)],
    components: [row],
    allowedMentions: { roles: [projectRole.id] },
  });
  bt.messageId = msg.id;
  saveBetatest(guild.id, bt);

  return interaction.editReply(
    `Started beta test **#${id}** for **${project}**.\n`
    + `• Role: <@&${betaRole.id}>\n`
    + `• Channel: <#${channel.id}>\n`
    + `• Announcement: ${announceChannel}\n`
    + `• ${limit ? `Limit: ${limit} tester(s)` : 'No tester limit'}`,
  );
}

async function end(interaction) {
  const { guild } = interaction;
  await interaction.deferReply({ ephemeral: true });

  const id = interaction.options.getString('id');
  const bt = getBetatest(guild.id, id);
  if (!bt) return interaction.editReply(`No beta test **#${id}** found.`);

  const notes = [];

  const role = guild.roles.cache.get(bt.roleId) ?? await guild.roles.fetch(bt.roleId).catch(() => null);
  if (role) await role.delete(`Beta test #${id} ended`).catch((e) => notes.push(`role: ${e.message}`));

  const channel = guild.channels.cache.get(bt.channelId) ?? await guild.channels.fetch(bt.channelId).catch(() => null);
  if (channel) await channel.delete(`Beta test #${id} ended`).catch((e) => notes.push(`channel: ${e.message}`));

  // Close the announcement (drop the Apply button, mark ended).
  const ann = await guild.channels.fetch(bt.announceChannelId).catch(() => null);
  if (ann && bt.messageId) {
    const msg = await ann.messages.fetch(bt.messageId).catch(() => null);
    if (msg) await msg.edit({ embeds: [buildBetaEmbed({ ...bt, open: false })], components: [] }).catch(() => {});
  }

  updateBetatest(guild.id, id, (b) => { b.open = false; });

  return interaction.editReply(
    `Ended beta test **#${id}** (${bt.project}) — removed the role, deleted the channel, closed applications.`
    + (notes.length ? `\n⚠ ${notes.join('; ')}` : ''),
  );
}
