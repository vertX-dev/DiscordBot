import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getMember, leaderboard } from '../lib/db.js';
import { levelInfo, ensureRegistered } from '../lib/levels.js';

export const data = new SlashCommandBuilder()
  .setName('level')
  .setDescription('Your XP and level, the leaderboard, and opt-in tracking.')
  .setDMPermission(false)
  .addSubcommand((sc) => sc.setName('view').setDescription('Show your (or someone\'s) level.')
    .addUserOption((o) => o.setName('user').setDescription('Whose level to show').setRequired(false)))
  .addSubcommand((sc) => sc.setName('register').setDescription('Opt in to XP tracking (and the reviewer pool).'))
  .addSubcommand((sc) => sc.setName('leaderboard').setDescription('Top members by XP.'));

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'register') return register(interaction);
  if (sub === 'leaderboard') return top(interaction);
  return view(interaction);
}

function bar(into, need) {
  const pct = need ? Math.round((into / need) * 100) : 0;
  const filled = Math.round(pct / 10);
  return `${'█'.repeat(filled)}${'░'.repeat(10 - filled)}  ${into}/${need} (${pct}%)`;
}

async function register(interaction) {
  await ensureRegistered(interaction.guild.id, interaction.user.id);
  return interaction.reply({ ephemeral: true, content: 'You\'re now tracked — start chatting and helping to earn XP. 📈' });
}

async function view(interaction) {
  const target = interaction.options.getUser('user') ?? interaction.user;
  const row = await getMember(interaction.guild.id, target.id);
  const isSelf = target.id === interaction.user.id;

  if (!row || !row.registered) {
    return interaction.reply({
      ephemeral: true,
      content: isSelf
        ? 'You\'re not tracked yet — run `/level register` to start earning XP.'
        : `**${target.username}** isn\'t tracked yet.`,
    });
  }

  const xp = Number(row.xp);
  const info = levelInfo(xp);
  const embed = new EmbedBuilder()
    .setTitle(`📈 ${target.username}`)
    .setThumbnail(target.displayAvatarURL())
    .setColor(0x5865f2)
    .addFields(
      { name: 'Level', value: `${info.level}`, inline: true },
      { name: 'Total XP', value: `${xp}`, inline: true },
      { name: 'Progress', value: bar(info.into, info.need) },
    );
  return interaction.reply({ embeds: [embed], ephemeral: isSelf });
}

async function top(interaction) {
  const rows = await leaderboard(interaction.guild.id, 10);
  if (!rows.length) return interaction.reply({ ephemeral: true, content: 'No one is tracked yet — be the first with `/level register`.' });

  const medals = ['🥇', '🥈', '🥉'];
  const lines = rows.map((r, i) => `${medals[i] ?? `\`${String(i + 1).padStart(2, ' ')}.\``} <@${r.userId}> — level **${r.level}** · ${r.xp} XP`);
  const embed = new EmbedBuilder()
    .setTitle('🏆 XP Leaderboard')
    .setDescription(lines.join('\n'))
    .setColor(0xf1c40f);
  return interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
}
