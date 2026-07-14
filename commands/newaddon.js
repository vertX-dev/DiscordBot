import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { VERIFIED_ROLE } from '../config/server-template.js';

const P = PermissionFlagsBits;

export const data = new SlashCommandBuilder()
  .setName('newaddon')
  .setDescription('Creates a channel for a new addon under the Addons category. Admin only.')
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

  const channel = await guild.channels.create({
    name: slug, type: ChannelType.GuildText, parent: category.id,
    topic: `Discussion for the ${raw} addon.`, reason: `New addon: ${raw}`,
  });
  await channel.lockPermissions().catch(() => {}); // sync visibility to the Addons category

  let extra = '';
  if (wantRole) {
    let role = guild.roles.cache.find((r) => r.name === raw);
    if (!role) role = await guild.roles.create({ name: raw, mentionable: true, reason: `Addon role: ${raw}` });
    extra = `\nCreated role **@${role.name}** — add it to the #pick-roles menu via \`config/server-template.js\` (set \`selfAssign: true\`) and re-run \`/setup\`.`;
  }

  await interaction.editReply(`Created <#${channel.id}>.${extra}`);
}
