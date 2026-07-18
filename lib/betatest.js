import { EmbedBuilder } from 'discord.js';
import { getBetatest, updateBetatest } from './store.js';

// Shared beta-test helpers, used by the /betatest command (start/end) and the
// Apply button handler routed from lib/components.js. State lives in the JSON
// store (per-guild), not the Postgres bug DB.

export const BETA_CATEGORY = 'Beta Tests';

export function betaRoleName(project, id) {
  return `Beta ${project} #${id}`.slice(0, 100);
}

export function betaChannelName(project, id) {
  const slug = project.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'project';
  return `beta-${slug}-${id}`;
}

export function buildBetaEmbed(bt) {
  const spots = bt.limit ? `${bt.testers.length} / ${bt.limit}` : `${bt.testers.length} · unlimited`;
  return new EmbedBuilder()
    .setTitle(`🧪 Beta Test — ${bt.project}`)
    .setDescription(
      bt.open
        ? `Applications are **open**. Click **Apply** below to join.\nYou need the <@&${bt.projectRoleId}> role to apply.`
        : 'This beta test has **ended**.',
    )
    .addFields(
      { name: 'Testers', value: spots, inline: true },
      { name: 'Beta #', value: `${bt.id}`, inline: true },
    )
    .setColor(bt.open ? 0x9b59b6 : 0x95a5a6)
    .setFooter({ text: bt.open ? 'First come, first served' : 'Closed' });
}

// Apply button (customId "betatest:apply:<id>"). Self-enroll: needs the project
// role, respects the tester limit, grants the beta role (which unlocks the
// private channel), and refreshes the announcement's tester count.
export async function handleBetaApply(interaction) {
  const id = interaction.customId.split(':')[2];
  const gid = interaction.guild.id;
  const bt = getBetatest(gid, id);

  if (!bt || !bt.open) {
    return interaction.reply({ ephemeral: true, content: 'This beta test is closed.' });
  }
  if (!interaction.member.roles.cache.has(bt.projectRoleId)) {
    return interaction.reply({ ephemeral: true, content: `You need the <@&${bt.projectRoleId}> role to apply — grab it in #pick-roles.` });
  }
  if (bt.testers.includes(interaction.user.id) || interaction.member.roles.cache.has(bt.roleId)) {
    return interaction.reply({ ephemeral: true, content: "You're already in this beta test. ✅" });
  }
  if (bt.limit && bt.testers.length >= bt.limit) {
    return interaction.reply({ ephemeral: true, content: 'This beta test is **full** — the tester limit has been reached.' });
  }

  try {
    await interaction.member.roles.add(bt.roleId, `Beta test #${bt.id} (${bt.project})`);
  } catch {
    return interaction.reply({ ephemeral: true, content: "I couldn't assign the beta role — my role may be too low. Ask an admin to move my role higher." });
  }

  const updated = updateBetatest(gid, id, (b) => {
    if (!b.testers.includes(interaction.user.id)) b.testers.push(interaction.user.id);
  });

  await interaction.reply({ ephemeral: true, content: `You're in the **${bt.project}** beta! Head to <#${bt.channelId}>. 🧪` });
  // Best-effort live refresh of the tester count on the announcement.
  await interaction.message.edit({ embeds: [buildBetaEmbed(updated)] }).catch(() => {});
}
