import { PermissionFlagsBits } from 'discord.js';
import { IDS, VERIFIED_ROLE, WELCOME } from '../config/server-template.js';
import { buildPollEmbed, recordVote, buildAddonEmbed } from './polls.js';
import { getPoll, updatePoll, getAddonPoll, updateAddonPoll } from './store.js';
import { handleBetaApply } from './betatest.js';

// Routes button / select-menu interactions. Called from index.js for any
// interaction that isn't a slash command. customIds with a "prefix:rest" shape
// are dispatched by their prefix.
export async function handleComponent(interaction) {
  const id = interaction.customId;

  if (interaction.isButton()) {
    if (id === IDS.verifyButton) return verifyMember(interaction);
    if (id.startsWith('poll:')) return pollVote(interaction);
    if (id.startsWith('pollend:')) return pollEnd(interaction);
    if (id.startsWith('betatest:apply:')) return handleBetaApply(interaction);
    return;
  }

  if (interaction.isStringSelectMenu()) {
    if (id === IDS.roleMenu) return toggleProjectRoles(interaction);
    if (id.startsWith('addonpoll:')) return addonVote(interaction);
  }
}

// --- Rules gate ------------------------------------------------------------
async function verifyMember(interaction) {
  const role = interaction.guild.roles.cache.find((r) => r.name === VERIFIED_ROLE);
  if (!role) return interaction.reply({ ephemeral: true, content: 'The member role is missing — ask an admin to run `/setup`.' });
  if (interaction.member.roles.cache.has(role.id)) {
    return interaction.reply({ ephemeral: true, content: 'You already have access. 🎉' });
  }
  try {
    await interaction.member.roles.add(role, 'Accepted the rules');
  } catch {
    return interaction.reply({ ephemeral: true, content: "I couldn't assign the role — my role may be below it. Ask an admin to move my role higher." });
  }
  await postWelcome(interaction);
  return interaction.reply({ ephemeral: true, content: 'Welcome! You now have access to the server. 🎉' });
}

// Greets the member in the configured welcome channel. Best-effort.
async function postWelcome(interaction) {
  if (!WELCOME.enabled) return;
  const channel = interaction.guild.channels.cache.find((c) => c.name === WELCOME.channel && c.isTextBased?.());
  if (!channel) return;
  const text = WELCOME.message
    .split('{user}').join(`<@${interaction.member.id}>`)
    .split('{server}').join(interaction.guild.name)
    .split('{count}').join(String(interaction.guild.memberCount));
  await channel.send({ content: text, allowedMentions: { users: [interaction.member.id] } }).catch(() => {});
}

// --- Self-assign project roles --------------------------------------------
async function toggleProjectRoles(interaction) {
  const selected = new Set(interaction.values);
  const optionIds = interaction.component.options.map((o) => o.value);
  const added = [];
  const removed = [];
  for (const roleId of optionIds) {
    const has = interaction.member.roles.cache.has(roleId);
    if (selected.has(roleId) && !has) { await interaction.member.roles.add(roleId).catch(() => {}); added.push(roleId); }
    else if (!selected.has(roleId) && has) { await interaction.member.roles.remove(roleId).catch(() => {}); removed.push(roleId); }
  }
  const parts = [];
  if (added.length) parts.push(`Added: ${added.map((r) => `<@&${r}>`).join(', ')}`);
  if (removed.length) parts.push(`Removed: ${removed.map((r) => `<@&${r}>`).join(', ')}`);
  return interaction.reply({ ephemeral: true, content: parts.length ? parts.join('\n') : 'No changes.' });
}

// --- Generic poll voting ---------------------------------------------------
async function pollVote(interaction) {
  const [, pollId, idxStr] = interaction.customId.split(':');
  const poll = getPoll(interaction.guild.id, pollId);
  if (!poll || !poll.open) {
    return interaction.reply({ ephemeral: true, content: 'This poll is closed.' });
  }
  updatePoll(interaction.guild.id, pollId, (p) => recordVote(p, Number(idxStr), interaction.user.id));
  const updated = getPoll(interaction.guild.id, pollId);
  return interaction.update({ embeds: [buildPollEmbed(updated)] });
}

async function pollEnd(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
    return interaction.reply({ ephemeral: true, content: 'Only staff (Manage Messages) can end a poll.' });
  }
  const [, pollId] = interaction.customId.split(':');
  const poll = getPoll(interaction.guild.id, pollId);
  if (!poll) return interaction.reply({ ephemeral: true, content: 'Poll not found.' });
  updatePoll(interaction.guild.id, pollId, (p) => { p.open = false; });
  const closed = getPoll(interaction.guild.id, pollId);
  return interaction.update({ embeds: [buildPollEmbed(closed)], components: [] });
}

// --- Addon prioritization voting ------------------------------------------
async function addonVote(interaction) {
  const [, pollId] = interaction.customId.split(':');
  const poll = getAddonPoll(interaction.guild.id, pollId);
  if (!poll || !poll.open) {
    return interaction.reply({ ephemeral: true, content: 'This poll is closed.' });
  }
  const picks = interaction.values;
  updateAddonPoll(interaction.guild.id, pollId, (p) => { p.votes[interaction.user.id] = picks; });
  const updated = getAddonPoll(interaction.guild.id, pollId);
  await interaction.update({ embeds: [buildAddonEmbed(updated)] });
  return interaction.followUp({ ephemeral: true, content: `Recorded your vote: ${picks.join(', ')}` });
}
