import {
  SlashCommandBuilder, PermissionFlagsBits, ChannelType,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
} from 'discord.js';
import {
  roles as roleDefs, categories as categoryDefs, RULES, IDS,
} from '../config/server-template.js';
import { reviewForumTags } from '../lib/reviews.js';
import { bugForumTags, BUG_CHANNEL_NAME } from '../lib/bugs.js';

const P = PermissionFlagsBits;

export const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Builds the server (roles, categories, channels) from the template. Admin only.')
  .setDefaultMemberPermissions(P.Administrator)
  .setDMPermission(false);

export async function execute(interaction) {
  const { guild } = interaction;
  const me = guild.members.me;

  if (!me.permissions.has(P.ManageRoles) || !me.permissions.has(P.ManageChannels)) {
    return interaction.reply({
      ephemeral: true,
      content: 'I need **Manage Roles** and **Manage Channels** (or Administrator). Grant them and run again.',
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const sum = { rolesNew: 0, rolesOld: 0, catsNew: 0, catsOld: 0, chsNew: 0, chsOld: 0, warnings: [] };
  const roleMap = {}; // def.key -> Role

  // 1) Roles --------------------------------------------------------------
  for (const def of roleDefs) {
    let role = guild.roles.cache.find((r) => r.name === def.name);
    if (role) {
      sum.rolesOld++;
    } else {
      role = await guild.roles.create({
        name: def.name, color: def.color, hoist: !!def.hoist,
        mentionable: !!def.mentionable, permissions: def.permissions ?? [],
        reason: 'Server setup',
      });
      sum.rolesNew++;
    }
    roleMap[def.key] = role;
  }

  // Best-effort hierarchy: staff highest, gate role lowest, all below the bot.
  try {
    const order = ['admin', 'mod', 'maintainer', 'dev', 'supporter', 'role-unified', 'role-pvpbot', 'verified']
      .map((k) => roleMap[k]).filter(Boolean);
    const botTop = me.roles.highest.position;
    await guild.roles.setPositions(order.map((r, i) => ({ role: r.id, position: Math.max(1, botTop - 1 - i) })));
  } catch {
    sum.warnings.push('Could not auto-order roles — drag staff roles above Member manually.');
  }

  // 2) Categories + channels ---------------------------------------------
  for (const cat of categoryDefs) {
    const overwrites = overwritesFor(cat.access, guild, roleMap, me.id);

    let category = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildCategory && c.name === cat.name,
    );
    if (category) {
      sum.catsOld++;
      await category.permissionOverwrites.set(overwrites).catch(() => {});
    } else {
      category = await guild.channels.create({
        name: cat.name, type: ChannelType.GuildCategory,
        permissionOverwrites: overwrites, reason: 'Server setup',
      });
      sum.catsNew++;
    }

    for (const ch of cat.channels) {
      const existing = findChannel(guild, ch, category);
      if (existing) {
        sum.chsOld++;
        await ensureForumTags(existing, sum);
        await maybePost(existing, ch, roleMap, sum);
        continue;
      }
      const created = await createChannel(guild, ch, category, overwrites, sum);
      if (created) {
        sum.chsNew++;
        await maybePost(created, ch, roleMap, sum);
      }
    }
  }

  // 3) Report -------------------------------------------------------------
  const lines = [
    '**✅ Server setup complete.**',
    `Roles — ${sum.rolesNew} created, ${sum.rolesOld} already existed.`,
    `Categories — ${sum.catsNew} created, ${sum.catsOld} already existed.`,
    `Channels — ${sum.chsNew} created, ${sum.chsOld} already existed.`,
  ];
  if (sum.warnings.length) lines.push('', ...sum.warnings.map((w) => `⚠️ ${w}`));
  lines.push('', 'Safe to re-run any time — existing items are reused, never duplicated.');
  await interaction.editReply(lines.join('\n'));
}

// --- Permission model ------------------------------------------------------
function overwritesFor(access, guild, roleMap, botId) {
  const everyone = guild.roles.everyone.id;
  // The bot always keeps full access so it can post/manage in any category.
  const botAllow = { id: botId, allow: [P.ViewChannel, P.SendMessages, P.ManageMessages] };

  if (access === 'info') {
    return [
      { id: everyone, allow: [P.ViewChannel, P.ReadMessageHistory], deny: [P.SendMessages, P.CreatePublicThreads, P.SendMessagesInThreads] },
      ...(roleMap.admin ? [{ id: roleMap.admin.id, allow: [P.SendMessages, P.ManageMessages] }] : []),
      ...(roleMap.mod ? [{ id: roleMap.mod.id, allow: [P.SendMessages, P.ManageMessages] }] : []),
      botAllow,
    ];
  }
  if (access === 'members') {
    return [
      { id: everyone, deny: [P.ViewChannel] },
      ...(roleMap.verified ? [{ id: roleMap.verified.id, allow: [P.ViewChannel] }] : []),
      botAllow,
    ];
  }
  if (access === 'staff') {
    return [
      { id: everyone, deny: [P.ViewChannel] },
      ...(roleMap.admin ? [{ id: roleMap.admin.id, allow: [P.ViewChannel] }] : []),
      ...(roleMap.mod ? [{ id: roleMap.mod.id, allow: [P.ViewChannel] }] : []),
      botAllow,
    ];
  }
  if (access.startsWith('role:')) {
    const role = guild.roles.cache.find((r) => r.name === access.slice(5));
    return [
      { id: everyone, deny: [P.ViewChannel] },
      ...(role ? [{ id: role.id, allow: [P.ViewChannel] }] : []),
      ...(roleMap.admin ? [{ id: roleMap.admin.id, allow: [P.ViewChannel] }] : []),
      botAllow,
    ];
  }
  return [botAllow];
}

// --- Channel helpers -------------------------------------------------------
function channelType(t) {
  if (t === 'voice') return ChannelType.GuildVoice;
  if (t === 'forum') return ChannelType.GuildForum;
  return ChannelType.GuildText;
}

function findChannel(guild, ch, category) {
  const name = ch.name.toLowerCase();
  return guild.channels.cache.find((c) => {
    if (c.parentId !== category.id) return false;
    if (c.name.toLowerCase() !== name) return false;
    // Treat forum and text as interchangeable so a forum->text fallback still matches.
    if (ch.type === 'forum' || ch.type === 'text') {
      return c.type === ChannelType.GuildForum || c.type === ChannelType.GuildText;
    }
    return c.type === channelType(ch.type);
  });
}

async function createChannel(guild, ch, category, overwrites, sum) {
  const base = {
    name: ch.name, parent: category.id, permissionOverwrites: overwrites,
    reason: 'Server setup', ...(ch.topic ? { topic: ch.topic } : {}),
  };
  const options = { ...base, type: channelType(ch.type) };
  if (ch.type === 'forum') {
    // /review status tags on every Support forum; #bug-reports also gets the
    // DB-status/severity tags used by /bug (see lib/bugs.js).
    options.availableTags = ch.name === BUG_CHANNEL_NAME
      ? [...reviewForumTags(), ...bugForumTags()]
      : reviewForumTags();
  }
  try {
    return await guild.channels.create(options);
  } catch (e) {
    if (ch.type === 'forum') {
      sum.warnings.push(`Forum '${ch.name}' isn't available here — created it as a text channel instead.`);
      return guild.channels.create({ ...base, type: ChannelType.GuildText }).catch((e2) => {
        sum.warnings.push(`Failed to create '${ch.name}': ${e2.message}`);
        return null;
      });
    }
    sum.warnings.push(`Failed to create '${ch.name}': ${e.message}`);
    return null;
  }
}

// Backfills the /review (and, on #bug-reports, /bug) status tags onto an
// existing forum channel.
async function ensureForumTags(channel, sum) {
  if (channel.type !== ChannelType.GuildForum) return;
  const wanted = channel.name === BUG_CHANNEL_NAME
    ? [...reviewForumTags(), ...bugForumTags()]
    : reviewForumTags();
  const have = new Set(channel.availableTags.map((t) => t.name));
  const missing = wanted.filter((t) => !have.has(t.name));
  if (!missing.length) return;
  const current = channel.availableTags.map((t) => ({
    name: t.name, moderated: t.moderated, ...(t.emoji ? { emoji: t.emoji } : {}),
  }));
  await channel.setAvailableTags([...current, ...missing].slice(0, 20))
    .catch((e) => sum.warnings.push(`Couldn't set tags on #${channel.name}: ${e.message}`));
}

// --- Interactive messages (rules button + role picker) ---------------------
async function maybePost(channel, ch, roleMap, sum) {
  try {
    if (ch.postRules && !(await hasComponent(channel, IDS.verifyButton))) {
      const embed = new EmbedBuilder().setTitle(RULES.title).setDescription(RULES.description).setColor(0x5865f2);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(IDS.verifyButton).setLabel('Accept Rules').setEmoji('✅').setStyle(ButtonStyle.Success),
      );
      await channel.send({ embeds: [embed], components: [row] });
    }

    if (ch.postRoleMenu && !(await hasComponent(channel, IDS.roleMenu))) {
      const selfRoles = roleDefs.filter((d) => d.selfAssign).map((d) => roleMap[d.key]).filter(Boolean);
      if (selfRoles.length) {
        const menu = new StringSelectMenuBuilder()
          .setCustomId(IDS.roleMenu)
          .setPlaceholder('Select the projects you want update pings for')
          .setMinValues(0)
          .setMaxValues(selfRoles.length)
          .addOptions(selfRoles.map((r) => ({ label: r.name, value: r.id })));
        const embed = new EmbedBuilder()
          .setTitle('🔔 Project Roles')
          .setDescription('Pick the projects you want to be pinged about. Selecting again removes the role.')
          .setColor(0x5865f2);
        await channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] });
      }
    }
  } catch (e) {
    sum.warnings.push(`Could not post in #${channel.name}: ${e.message}`);
  }
}

async function hasComponent(channel, customId) {
  const msgs = await channel.messages.fetch({ limit: 25 }).catch(() => null);
  if (!msgs) return false;
  const meId = channel.client.user.id;
  return msgs.some((m) =>
    m.author.id === meId &&
    m.components?.some((row) => row.components?.some((c) => c.customId === customId)));
}
