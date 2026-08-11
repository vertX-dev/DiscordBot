import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } from 'discord.js';
import { VERIFIED_ROLE } from '../config/server-template.js';
import { upsertAddon } from '../lib/db.js';
import { syncRoleMenu } from '../lib/rolemenu.js';

const P = PermissionFlagsBits;

export const data = new SlashCommandBuilder()
  .setName('newaddon')
  .setDescription('Create an addon forum channel (registers it for #pick-roles + /addonpoll).')
  .setDefaultMemberPermissions(P.ManageChannels)
  .setDMPermission(false)
  .addStringOption((o) =>
    o.setName('name').setDescription('Addon name, e.g. "Better Potions"').setRequired(true))
  .addBooleanOption((o) =>
    o.setName('role').setDescription('Also create a self-assign role + add it to #pick-roles').setRequired(false))
  .addIntegerOption((o) =>
    o.setName('difficulty').setDescription('Maintenance difficulty for /addonpoll (default 3)').setRequired(false).setMinValue(1).setMaxValue(10));

export async function execute(interaction) {
  const { guild } = interaction;
  if (!guild.members.me.permissions.has(P.ManageChannels)) {
    return interaction.reply({ ephemeral: true, content: 'I need the **Manage Channels** permission.' });
  }
  await interaction.deferReply({ ephemeral: true });

  const raw = interaction.options.getString('name').trim();
  const slug = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90) || 'addon';
  const wantRole = interaction.options.getBoolean('role') ?? false;
  const difficulty = interaction.options.getInteger('difficulty') ?? 3;

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

  let role = null;
  let extra = '';
  if (wantRole) {
    role = guild.roles.cache.find((r) => r.name === raw)
      ?? await guild.roles.create({ name: raw, mentionable: true, reason: `Addon role: ${raw}` });
    extra = `\nCreated role **@${role.name}** and added it to #pick-roles.`;
  }

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
    await pinGeneralDiscussion(channel, raw, role).catch(() => { note += '\n⚠ Could not create/pin the General Discussion post — add it manually.'; });
  } catch {
    channel = await guild.channels.create({ ...base, type: ChannelType.GuildText });
    note += '\n⚠ Forums need a Community-enabled server — created a text channel instead.';
  }
  await channel.lockPermissions().catch(() => {}); // sync visibility to the Addons category

  // Register the addon in the DB — this is what /addonpoll and #pick-roles read.
  await upsertAddon(guild.id, {
    name: raw, slug, difficulty, roleId: role?.id ?? null, channelId: channel.id, selfAssign: wantRole,
  }).catch(() => { note += '\n⚠ Could not register the addon in the DB (poll/roles may not pick it up).'; });

  if (wantRole) await syncRoleMenu(guild).catch(() => {});

  return interaction.editReply(`Created <#${channel.id}>. Registered for #addonpoll (difficulty ${difficulty}).${extra}${note}`);
}

async function pinGeneralDiscussion(forum, addonName, role) {
  const embed = new EmbedBuilder()
    .setTitle(`💬 Welcome to ${addonName}`)
    .setColor(0x5865f2)
    .setDescription(
      [
        `This is the home base for **${addonName}** — teasers, screenshots, questions,`,
        'and anything that doesn\'t need its own post. Chat away right here.',
        '',
        '**Everything else gets its own post** — new posts in this forum for:',
        '📦 Releases',
        '🧪 Experimental features',
        '🧩 Mini-addons',
        '⚙️ Configs',
        '',
        '**Found a bug?** `/bug report` — pick this project and it\'ll sync with the tracker.',
        '**Have an idea?** `/suggest` — opens a post in #suggestions.',
        role ? `**Want update pings?** Grab <@&${role.id}> in #pick-roles.` : null,
        '',
        'Glad you\'re here — go build something. 🎉',
      ].filter((line) => line !== null).join('\n'),
    );
  const thread = await forum.threads.create({ name: 'General Discussion', message: { embeds: [embed] } });
  await thread.pin('Pinned General Discussion');
}
