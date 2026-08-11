import { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } from 'discord.js';
import { roles as roleDefs, IDS } from '../config/server-template.js';
import { listAddons } from './db.js';

// The self-assign roles for the #pick-roles menu = template project roles
// (Unified, PVP Bot) + addon roles registered in the DB via /newaddon.
export async function collectSelfAssignRoles(guild) {
  const out = [];
  for (const def of roleDefs.filter((d) => d.selfAssign)) {
    const r = guild.roles.cache.find((x) => x.name === def.name);
    if (r) out.push(r);
  }
  for (const a of await listAddons(guild.id)) {
    if (a.self_assign && a.role_id) {
      const r = guild.roles.cache.get(a.role_id);
      if (r && !out.some((x) => x.id === r.id)) out.push(r);
    }
  }
  return out.slice(0, 25); // Discord select-menu cap
}

async function findRoleMenuMessage(channel) {
  const msgs = await channel.messages.fetch({ limit: 25 }).catch(() => null);
  if (!msgs) return null;
  const meId = channel.client.user.id;
  return msgs.find((m) =>
    m.author.id === meId
    && m.components?.some((row) => row.components?.some((c) => c.customId === IDS.roleMenu))) ?? null;
}

// Build (or update in place) the #pick-roles select menu with the current set of
// self-assign roles. Called by /setup and after /newaddon adds an addon role.
export async function syncRoleMenu(guild) {
  const channel = guild.channels.cache.find((c) => c.name === 'pick-roles' && c.isTextBased?.());
  if (!channel) return;
  const roles = await collectSelfAssignRoles(guild);
  if (!roles.length) return;

  const menu = new StringSelectMenuBuilder()
    .setCustomId(IDS.roleMenu)
    .setPlaceholder('Select the projects & addons you want update pings for')
    .setMinValues(0)
    .setMaxValues(roles.length)
    .addOptions(roles.map((r) => ({ label: r.name.slice(0, 100), value: r.id })));
  const embed = new EmbedBuilder()
    .setTitle('🔔 Project & Addon Roles')
    .setDescription('Pick the projects and addons you want to be pinged about. Selecting again removes the role.')
    .setColor(0x5865f2);
  const payload = { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };

  const existing = await findRoleMenuMessage(channel);
  if (existing) await existing.edit(payload).catch(() => {});
  else await channel.send(payload).catch(() => {});
}
