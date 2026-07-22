import {
  SlashCommandBuilder, PermissionFlagsBits, ChannelType,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
} from 'discord.js';
import {
  insertBetatest, attachBetatestDiscord, getBetatest, endBetatest,
  listOpenBetatests, getOpenBetatestByChannel, isTester, insertFeedback, feedbackStats,
} from '../lib/db.js';
import { buildBetaEmbed, betaRoleName, betaChannelName, betaLabel, BETA_CATEGORY } from '../lib/betatest.js';
import { awardXp } from '../lib/levels.js';

const P = PermissionFlagsBits;

export const data = new SlashCommandBuilder()
  .setName('betatest')
  .setDescription('Run project beta tests: private channel + tester role, opt-in via an announcement.')
  .setDefaultMemberPermissions(P.ManageRoles)
  .setDMPermission(false)
  .addSubcommand((sc) => sc.setName('start').setDescription('Start a beta test for a project.')
    .addRoleOption((o) => o.setName('project').setDescription('Project role — also the role required to apply').setRequired(true))
    .addIntegerOption((o) => o.setName('limit').setDescription('Max testers (default: no limit)').setRequired(false).setMinValue(1))
    .addStringOption((o) => o.setName('name').setDescription('Custom name (defaults to the project role name)').setRequired(false).setMaxLength(80))
    .addRoleOption((o) => o.setName('require_role').setDescription('Extra role members must also have to apply (e.g. Trusted)').setRequired(false)))
  .addSubcommand((sc) => sc.setName('end').setDescription('End a beta test: delete its role + channel, close applications.')
    .addStringOption((o) => o.setName('id').setDescription('Beta test id').setRequired(true).setAutocomplete(true)))
  .addSubcommand((sc) => sc.setName('feedback').setDescription('Submit feedback — run inside your beta test channel.')
    .addStringOption((o) => o.setName('text').setDescription('Your feedback').setRequired(true)));

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused().toLowerCase();
  const rows = await listOpenBetatests(interaction.guild.id).catch(() => []);
  const choices = rows
    .filter((b) => String(b.id).includes(focused) || b.project.toLowerCase().includes(focused))
    .slice(0, 25)
    .map((b) => ({ name: `#${b.id} — ${b.project}`, value: String(b.id) }));
  await interaction.respond(choices);
}

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'start') return start(interaction);
  if (sub === 'end') return end(interaction);
  if (sub === 'feedback') return feedback(interaction);
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
  const project = projectRole.name;
  const customName = interaction.options.getString('name')?.trim() || null;
  const extraRole = interaction.options.getRole('require_role');

  // Insert first to get the id (the embed shows it); fill in Discord ids after.
  const bt = await insertBetatest({
    guildId: guild.id, project, name: customName, projectRoleId: projectRole.id,
    extraRoleId: extraRole?.id ?? null, limit, createdBy: interaction.user.id,
  });
  const id = String(bt.id);
  const label = betaLabel(bt);

  const betaRole = await guild.roles.create({
    name: betaRoleName(label, id), mentionable: true, reason: `Beta test #${id} (${label})`,
  });

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
    name: betaChannelName(label, id), type: ChannelType.GuildText,
    parent: category?.id, permissionOverwrites: overwrites,
    topic: `Private beta test for ${label} (#${id}). Use /betatest feedback here.`, reason: `Beta test #${id}`,
  });

  const announceChannel = guild.channels.cache.find((c) => c.name === 'announcements' && c.isTextBased?.()) ?? interaction.channel;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`betatest:apply:${id}`).setLabel('Apply to test').setEmoji('🧪').setStyle(ButtonStyle.Success),
  );
  const msg = await announceChannel.send({
    content: `<@&${projectRole.id}>`,
    embeds: [buildBetaEmbed(bt, 0)],
    components: [row],
    allowedMentions: { roles: [projectRole.id] },
  });

  await attachBetatestDiscord(id, { roleId: betaRole.id, channelId: channel.id, announceChannelId: announceChannel.id, messageId: msg.id });

  return interaction.editReply(
    `Started beta test **#${id}** — **${label}**.\n`
    + `• Role: <@&${betaRole.id}>\n`
    + `• Channel: <#${channel.id}>\n`
    + `• Announcement: ${announceChannel}\n`
    + `• Apply requires: <@&${projectRole.id}>${extraRole ? ` + <@&${extraRole.id}>` : ''}\n`
    + `• ${limit ? `Limit: ${limit} tester(s)` : 'No tester limit'}`,
  );
}

async function end(interaction) {
  const { guild } = interaction;
  await interaction.deferReply({ ephemeral: true });

  const id = interaction.options.getString('id');
  const bt = await getBetatest(id);
  if (!bt || bt.guild_id !== guild.id) return interaction.editReply(`No beta test **#${id}** found.`);

  const notes = [];
  if (bt.role_id) {
    const role = guild.roles.cache.get(bt.role_id) ?? await guild.roles.fetch(bt.role_id).catch(() => null);
    if (role) await role.delete(`Beta test #${id} ended`).catch((e) => notes.push(`role: ${e.message}`));
  }
  if (bt.channel_id) {
    const channel = guild.channels.cache.get(bt.channel_id) ?? await guild.channels.fetch(bt.channel_id).catch(() => null);
    if (channel) await channel.delete(`Beta test #${id} ended`).catch((e) => notes.push(`channel: ${e.message}`));
  }
  if (bt.announce_channel_id && bt.message_id) {
    const ann = await guild.channels.fetch(bt.announce_channel_id).catch(() => null);
    const msg = ann ? await ann.messages.fetch(bt.message_id).catch(() => null) : null;
    if (msg) await msg.edit({ embeds: [buildBetaEmbed({ ...bt, status: 'ended' }, 0)], components: [] }).catch(() => {});
  }

  await endBetatest(id);

  // Feedback stats survive in the DB for later rewards; surface the top testers now.
  const stats = await feedbackStats(id).catch(() => []);
  const top = stats.slice(0, 5).map((s, i) => `${i + 1}. <@${s.userId}> — ${s.count} feedback`).join('\n');

  return interaction.editReply(
    `Ended beta test **#${id}** (${bt.project}) — removed the role, deleted the channel, closed applications.`
    + (stats.length ? `\n\n**Top feedback contributors:**\n${top}` : '\n\nNo feedback was submitted.')
    + (notes.length ? `\n⚠ ${notes.join('; ')}` : ''),
  );
}

async function feedback(interaction) {
  const bt = await getOpenBetatestByChannel(interaction.channelId);
  if (!bt) {
    return interaction.reply({ ephemeral: true, content: 'Run this **inside** your beta test channel (an open one).' });
  }
  if (!(await isTester(bt.id, interaction.user.id))) {
    return interaction.reply({ ephemeral: true, content: 'Only enrolled testers can submit feedback for this beta.' });
  }
  const text = interaction.options.getString('text');

  await insertFeedback(bt.id, interaction.user.id, text);

  // Bonus XP on the beta track for contributing (best-effort).
  await awardXp(interaction.guild, interaction.member, 'beta').catch(() => {});

  // Post it so devs/admins can read it, and confirm to the tester.
  const embed = new EmbedBuilder()
    .setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() })
    .setDescription(text)
    .setColor(0x9b59b6)
    .setFooter({ text: `${bt.project} beta #${bt.id} · feedback` })
    .setTimestamp();
  await interaction.channel.send({ embeds: [embed] }).catch(() => {});

  return interaction.reply({ ephemeral: true, content: 'Thanks — feedback recorded, and you earned Beta Tester XP. 📝' });
}
