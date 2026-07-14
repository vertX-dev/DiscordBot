import { EmbedBuilder } from 'discord.js';

export const MAX_TIMEOUT = 28 * 24 * 60 * 60 * 1000; // Discord cap: 28 days

// Parse durations like "10m", "1h", "2d", "1h30m", "30s" into milliseconds.
// Returns null if nothing parseable was found.
export function parseDuration(input) {
  if (!input) return null;
  const re = /(\d+)\s*(d|h|m|s)/gi;
  let ms = 0;
  let matched = false;
  let m;
  while ((m = re.exec(input)) !== null) {
    matched = true;
    const n = Number(m[1]);
    const unit = m[2].toLowerCase();
    ms += unit === 'd' ? n * 86400000 : unit === 'h' ? n * 3600000 : unit === 'm' ? n * 60000 : n * 1000;
  }
  return matched ? ms : null;
}

export function humanDuration(ms) {
  const units = [['d', 86400000], ['h', 3600000], ['m', 60000], ['s', 1000]];
  const parts = [];
  let rest = ms;
  for (const [label, size] of units) {
    const v = Math.floor(rest / size);
    if (v > 0) { parts.push(`${v}${label}`); rest -= v * size; }
  }
  return parts.join(' ') || '0s';
}

// Returns an error string if the action isn't allowed, or null if it's fine.
// Guards against acting on the owner, the bot, equal/higher roles, and the
// bot's own role being too low.
export function hierarchyError(interaction, target) {
  const me = interaction.guild.members.me;
  const executor = interaction.member;
  if (target.id === interaction.guild.ownerId) return "You can't moderate the server owner.";
  if (target.id === me.id) return "I can't moderate myself.";
  if (target.id === executor.id) return "You can't moderate yourself.";
  if (
    executor.id !== interaction.guild.ownerId &&
    executor.roles.highest.position <= target.roles.highest.position
  ) {
    return "You can't moderate someone with a role equal to or higher than yours.";
  }
  if (me.roles.highest.position <= target.roles.highest.position) {
    return 'My role is too low to act on that member — move my role higher in Server Settings → Roles.';
  }
  return null;
}

// Posts an audit embed to #mod-log if that channel exists. No-op otherwise.
export async function logMod(guild, { action, color = 0xe67e22, user, moderator, reason, fields = [] }) {
  const channel = guild.channels.cache.find((c) => c.name === 'mod-log' && c.isTextBased?.());
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setTitle(action)
    .setColor(color)
    .setTimestamp()
    .addFields(
      { name: 'User', value: user ? `${user} \`${user.id}\`` : '—', inline: true },
      { name: 'Moderator', value: `${moderator}`, inline: true },
    );
  if (reason) embed.addFields({ name: 'Reason', value: reason });
  if (fields.length) embed.addFields(...fields);

  await channel.send({ embeds: [embed] }).catch(() => {});
}
