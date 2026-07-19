import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getMemberTracks, leaderboard } from '../lib/db.js';
import { levelInfo } from '../lib/levels.js';
import { TRACKS, TRACK } from '../config/levels.js';

const trackChoices = TRACKS.map((t) => ({ name: t.name, value: t.key }));

export const data = new SlashCommandBuilder()
  .setName('level')
  .setDescription('Your levels across tracks, and the leaderboards.')
  .setDMPermission(false)
  .addSubcommand((sc) => sc.setName('view').setDescription('Show levels for you or another member.')
    .addUserOption((o) => o.setName('user').setDescription('Whose levels to show').setRequired(false)))
  .addSubcommand((sc) => sc.setName('leaderboard').setDescription('Top members on a track.')
    .addStringOption((o) => o.setName('track').setDescription('Which track').setRequired(false).addChoices(...trackChoices)));

export async function execute(interaction) {
  if (interaction.options.getSubcommand() === 'leaderboard') return top(interaction);
  return view(interaction);
}

function bar(into, need) {
  const pct = need ? Math.round((into / need) * 100) : 0;
  const filled = Math.round(pct / 10);
  return `${'█'.repeat(filled)}${'░'.repeat(10 - filled)}  ${into}/${need}`;
}

async function view(interaction) {
  const target = interaction.options.getUser('user') ?? interaction.user;
  const rows = await getMemberTracks(interaction.guild.id, target.id);
  const byTrack = Object.fromEntries(rows.map((r) => [r.track, r]));

  const lines = TRACKS.map((t) => {
    const r = byTrack[t.key];
    if (!r) return `**${t.name}** — level 0 · 0 XP`;
    const info = levelInfo(r.xp);
    return `**${t.name}** — level **${info.level}** · ${r.xp} XP\n${bar(info.into, info.need)}`;
  });

  const embed = new EmbedBuilder()
    .setTitle(`📈 ${target.username}`)
    .setThumbnail(target.displayAvatarURL())
    .setColor(0x5865f2)
    .setDescription(lines.join('\n'));
  return interaction.reply({ embeds: [embed], ephemeral: target.id === interaction.user.id });
}

async function top(interaction) {
  const trackKey = interaction.options.getString('track') ?? 'chat';
  const track = TRACK[trackKey];
  const rows = await leaderboard(interaction.guild.id, trackKey, 10);
  if (!rows.length) return interaction.reply({ ephemeral: true, content: `No one has any **${track.name}** XP yet.` });

  const medals = ['🥇', '🥈', '🥉'];
  const lines = rows.map((r, i) => `${medals[i] ?? `\`${String(i + 1).padStart(2, ' ')}.\``} <@${r.userId}> — level **${r.level}** · ${r.xp} XP`);
  const embed = new EmbedBuilder()
    .setTitle(`🏆 ${track.name} Leaderboard`)
    .setDescription(lines.join('\n'))
    .setColor(0xf1c40f);
  return interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
}
