import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { getMemberTracks } from '../lib/db.js';
import { awardXp, applyAbsoluteXp } from '../lib/levels.js';
import { TRACKS, TRACK } from '../config/levels.js';

const P = PermissionFlagsBits;
const trackChoices = TRACKS.map((t) => ({ name: t.name, value: t.key }));

function sub(name, desc, amountDesc) {
  return (sc) => sc.setName(name).setDescription(desc)
    .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
    .addStringOption((o) => o.setName('track').setDescription('Which track').setRequired(true).addChoices(...trackChoices))
    .addIntegerOption((o) => o.setName('amount').setDescription(amountDesc).setRequired(true).setMinValue(name === 'set' ? 0 : 1));
}

export const data = new SlashCommandBuilder()
  .setName('xp')
  .setDescription('Manually adjust a member\'s XP on a track. (staff)')
  .setDefaultMemberPermissions(P.ManageGuild)
  .setDMPermission(false)
  .addSubcommand(sub('give', 'Add XP to a member on a track.', 'XP to add'))
  .addSubcommand(sub('take', 'Remove XP from a member on a track.', 'XP to remove'))
  .addSubcommand(sub('set', 'Set a member\'s total XP on a track.', 'New total XP'));

export async function execute(interaction) {
  const action = interaction.options.getSubcommand();
  const member = interaction.options.getMember('user');
  const user = interaction.options.getUser('user');
  const trackKey = interaction.options.getString('track');
  const amount = interaction.options.getInteger('amount');
  const track = TRACK[trackKey];

  if (!member) return interaction.reply({ ephemeral: true, content: `**${user?.username ?? 'That user'}** isn\'t in this server.` });

  await interaction.deferReply({ ephemeral: true });

  if (action === 'give') {
    const res = await awardXp(interaction.guild, member, trackKey, { amount });
    return interaction.editReply(`Gave **${amount}** ${track.name} XP to ${member} — now level **${res.level}** (${res.xp} XP).`);
  }

  const rows = await getMemberTracks(interaction.guild.id, member.id);
  const current = rows.find((r) => r.track === trackKey)?.xp ?? 0;
  const target = action === 'take' ? current - amount : amount;
  const res = await applyAbsoluteXp(interaction.guild, member, trackKey, target);
  const verb = action === 'take' ? `Removed ${amount} ${track.name} XP from` : `Set ${track.name} XP of`;
  return interaction.editReply(`${verb} ${member} — now level **${res.level}** (${res.xp} XP).`);
}
