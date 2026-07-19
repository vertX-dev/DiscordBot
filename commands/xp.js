import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { getMember } from '../lib/db.js';
import { awardXp, applyAbsoluteXp, ensureRegistered, levelInfo } from '../lib/levels.js';

const P = PermissionFlagsBits;

export const data = new SlashCommandBuilder()
  .setName('xp')
  .setDescription('Manually adjust a member\'s XP. (staff)')
  .setDefaultMemberPermissions(P.ManageGuild)
  .setDMPermission(false)
  .addSubcommand((sc) => sc.setName('give').setDescription('Add XP to a member.')
    .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
    .addIntegerOption((o) => o.setName('amount').setDescription('XP to add').setRequired(true).setMinValue(1)))
  .addSubcommand((sc) => sc.setName('take').setDescription('Remove XP from a member.')
    .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
    .addIntegerOption((o) => o.setName('amount').setDescription('XP to remove').setRequired(true).setMinValue(1)))
  .addSubcommand((sc) => sc.setName('set').setDescription('Set a member\'s total XP.')
    .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
    .addIntegerOption((o) => o.setName('amount').setDescription('New total XP').setRequired(true).setMinValue(0)));

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const member = interaction.options.getMember('user');
  const user = interaction.options.getUser('user');
  const amount = interaction.options.getInteger('amount');

  if (!member) {
    return interaction.reply({ ephemeral: true, content: `**${user?.username ?? 'That user'}** isn\'t in this server.` });
  }

  await interaction.deferReply({ ephemeral: true });
  await ensureRegistered(interaction.guild.id, member.id);

  if (sub === 'give') {
    const res = await awardXp(interaction.guild.id, member, amount, { channel: interaction.channel });
    return interaction.editReply(`Gave **${amount}** XP to ${member} — now level **${res.level}** (${res.xp} XP).`);
  }

  // take / set both resolve to an absolute target.
  const row = await getMember(interaction.guild.id, member.id);
  const current = row ? Number(row.xp) : 0;
  const target = sub === 'take' ? current - amount : amount;
  const res = await applyAbsoluteXp(interaction.guild.id, member, target);
  const verb = sub === 'take' ? 'Removed' : 'Set';
  const detail = sub === 'take' ? `${amount} XP from` : `XP of`;
  return interaction.editReply(`${verb} ${detail} ${member} — now level **${res.level}** (${res.xp} XP).`);
}
