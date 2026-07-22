import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } from 'discord.js';
import { VERIFIED_ROLE } from '../config/server-template.js';

const P = PermissionFlagsBits;

export const data = new SlashCommandBuilder()
  .setName('newaddon')
  .setDescription('Creates a forum channel for a new addon under the Addons category. Admin only.')
  .setDefaultMemberPermissions(P.ManageChannels)
  .setDMPermission(false)
  .addStringOption((o) =>
    o.setName('name').setDescription('Addon name, e.g. "Better Potions"').setRequired(true))
  .addBooleanOption((o) =>
    o.setName('role').setDescription('Also create a mentionable role for this addon').setRequired(false));

export async function execute(interaction) {
  const { guild } = interaction;
  if (!guild.members.me.permissions.has(P.ManageChannels)) {
    return interaction.reply({ ephemeral: true, content: 'I need the **Manage Channels** permission.' });
  }
  await interaction.deferReply({ ephemeral: true });

  const raw = interaction.options.getString('name').trim();
  const slug = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90) || 'addon';
  const wantRole = interaction.options.getBoolean('role') ?? false;

  // Find or create the Addons category (members-only visibility).
  let category = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && c.name === 'Addons',
  );
  if (!category) {
    const everyone = guild.roles.everyone.id;
    const verified = guild.roles.cache.find((r) => r.name === VERIFIED_ROLE);
    const ov = [{ id: everyone, deny: [P.ViewChannel] }];
    if (verified) ov.push({ id: verified.id, allow: [P.ViewChannel] });
    category = await guild.channels.create({
      name: 'Addons', type: ChannelType.GuildCategory, permissionOverwrites: ov, reason: 'New addon',
    });
  }

  const existing = guild.channels.cache.find((c) => c.parentId === category.id && c.name === slug);
  if (existing) return interaction.editReply(`A channel already exists for that addon: <#${existing.id}>`);

  // Forum channel: one pinned General Discussion post + a post per release /
  // experimental feature / mini-addon / config. Fall back to text if the guild
  // isn't a Community server (forums require it).
  const base = {
    name: slug, parent: category.id, reason: `New addon: ${raw}`,
    topic: `${raw} — releases, experimental features, mini-addons, configs. One post per topic.`,
  };
  let channel;
  let note = '';
  try {
    channel = await guild.channels.create({ ...base, type: ChannelType.GuildForum });
    await pinGeneralDiscussion(channel, raw).catch(() => { note += '\n⚠ Could not create/pin the General Discussion post — add it manually.'; });
  } catch {
    channel = await guild.channels.create({ ...base, type: ChannelType.GuildText });
    note += '\n⚠ Forums need a Community-enabled server — created a text channel instead.';
  }
  await channel.lockPermissions().catch(() => {}); // sync visibility to the Addons category

  let extra = '';
  if (wantRole) {
    let role = guild.roles.cache.find((r) => r.name === raw);
    if (!role) role = await guild.roles.create({ name: raw, mentionable: true, reason: `Addon role: ${raw}` });
    extra = `\nCreated role **@${role.name}** — add it to the #pick-roles menu via \`config/server-template.js\` (set \`selfAssign: true\`) and re-run \`/setup\`.`;
  }

  return interaction.editReply(`Created <#${channel.id}>.${extra}${note}`);
}

async function pinGeneralDiscussion(forum, addonName) {
  const embed = new EmbedBuilder()
    .setTitle('💬 General Discussion')
    .setColor(0x5865f2)
    .setDescription(
      `Post teasers, questions, and cross-topic chat about **${addonName}** here.\n\n`
      + 'Use separate posts for releases, experimental features, mini-addons, and configs.',
    );
  const thread = await forum.threads.create({ name: 'General Discussion', message: { embeds: [embed] } });
  await thread.pin('Pinned General Discussion');
}
