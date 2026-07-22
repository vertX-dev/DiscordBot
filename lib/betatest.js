import { EmbedBuilder } from 'discord.js';
import { getBetatest, isTester, countTesters, addTester } from './db.js';

// Shared beta-test helpers, used by the /betatest command and the Apply button
// routed from lib/components.js. State is durable in Postgres (beta_tests /
// beta_testers / beta_feedback), so redeploys don't orphan active tests.

export const BETA_CATEGORY = 'Beta Tests';

// Display name: custom name if given, else the project role's name.
export function betaLabel(bt) {
  return bt.name || bt.project;
}

export function betaRoleName(label, id) {
  return `Beta ${label} #${id}`.slice(0, 100);
}

export function betaChannelName(label, id) {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'project';
  return `beta-${slug}-${id}`;
}

// bt is a beta_tests row (snake_case); count is the current tester total.
export function buildBetaEmbed(bt, count) {
  const spots = bt.limit_testers ? `${count} / ${bt.limit_testers}` : `${count} · unlimited`;
  const open = bt.status === 'open';
  const req = bt.extra_role_id
    ? `You need both the <@&${bt.project_role_id}> and <@&${bt.extra_role_id}> roles to apply.`
    : `You need the <@&${bt.project_role_id}> role to apply.`;
  return new EmbedBuilder()
    .setTitle(`🧪 Beta Test — ${betaLabel(bt)}`)
    .setDescription(
      open
        ? `Applications are **open**. Click **Apply** below to join.\n`
          + `${req}\n`
          + `Once in, share findings with \`/betatest feedback\` in the beta channel.`
        : 'This beta test has **ended**.',
    )
    .addFields(
      { name: 'Testers', value: spots, inline: true },
      { name: 'Beta #', value: `${bt.id}`, inline: true },
    )
    .setColor(open ? 0x9b59b6 : 0x95a5a6)
    .setFooter({ text: open ? 'First come, first served' : 'Closed' });
}

// Apply button ("betatest:apply:<id>"). Self-enroll: needs the project role,
// respects the limit, grants the beta role (unlocks the channel), refreshes the
// announcement count.
export async function handleBetaApply(interaction) {
  const id = interaction.customId.split(':')[2];
  const bt = await getBetatest(id);

  if (!bt || bt.status !== 'open') {
    return interaction.reply({ ephemeral: true, content: 'This beta test is closed.' });
  }
  if (!interaction.member.roles.cache.has(bt.project_role_id)) {
    return interaction.reply({ ephemeral: true, content: `You need the <@&${bt.project_role_id}> role to apply — grab it in #pick-roles.` });
  }
  if (bt.extra_role_id && !interaction.member.roles.cache.has(bt.extra_role_id)) {
    return interaction.reply({ ephemeral: true, content: `This beta is limited to members with the <@&${bt.extra_role_id}> role.` });
  }
  if (interaction.member.roles.cache.has(bt.role_id) || await isTester(bt.id, interaction.user.id)) {
    return interaction.reply({ ephemeral: true, content: "You're already in this beta test. ✅" });
  }
  if (bt.limit_testers && (await countTesters(bt.id)) >= bt.limit_testers) {
    return interaction.reply({ ephemeral: true, content: 'This beta test is **full** — the tester limit has been reached.' });
  }

  try {
    await interaction.member.roles.add(bt.role_id, `Beta test #${bt.id} (${bt.project})`);
  } catch {
    return interaction.reply({ ephemeral: true, content: "I couldn't assign the beta role — my role may be too low. Ask an admin to move my role higher." });
  }

  await addTester(bt.id, interaction.user.id);
  await interaction.reply({ ephemeral: true, content: `You're in the **${bt.project}** beta! Head to <#${bt.channel_id}> and use \`/betatest feedback\` to report findings. 🧪` });

  const count = await countTesters(bt.id);
  await interaction.message.edit({ embeds: [buildBetaEmbed(bt, count)] }).catch(() => {});
}
