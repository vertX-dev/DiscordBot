import { addXp, setXp, setLevel, getMemberTracks } from './db.js';
import {
  TRACK, REWARDS, voteCap, LEVEL_CHANNEL,
  MESSAGE_XP, MESSAGE_COOLDOWN_MS, BETA_CHANNEL_MULT,
} from '../config/levels.js';

// Multi-track leveling. Everyone is auto-tracked (no opt-in); XP comes from
// chat messages (the "chat" track) and from actions that call awardXp(). Config
// (tracks, rewards, cap, channel) lives in config/levels.js.

// XP curve (MEE6-style): XP to advance FROM `level` to the next.
export function xpToNext(level) {
  return 5 * level * level + 50 * level + 100;
}

// Total XP -> { level, into (xp into current level), need (xp for this level) }.
export function levelInfo(totalXp) {
  let level = 0;
  let acc = 0;
  let need = xpToNext(0);
  while (totalXp >= acc + need) {
    acc += need;
    level += 1;
    need = xpToNext(level);
  }
  return { level, into: totalXp - acc, need };
}

const cooldowns = new Map();
const key = (gid, uid) => `${gid}:${uid}`;

export function startLevels() {
  if (!process.env.DATABASE_URL) {
    console.warn('[levels] DATABASE_URL not set — leveling disabled.');
    return;
  }
  console.log('[levels] ready (auto-tracking all members).');
}

function announceLevelUp(guild, member, track, level) {
  const ch = guild.channels.cache.find((c) => c.name === LEVEL_CHANNEL && c.isTextBased?.());
  if (!ch) return;
  ch.send({ content: `🎉 ${member} reached **${track.name}** level **${level}**!`, allowedMentions: { users: [member.id] } }).catch(() => {});
}

async function grantRewardRoles(member, trackKey, level) {
  for (const r of REWARDS) {
    if (r.track !== trackKey || !r.role || level < r.level) continue;
    const role = member.guild.roles.cache.find((x) => x.name === r.role);
    if (role && !member.roles.cache.has(role.id)) {
      await member.roles.add(role, `${trackKey} level ${r.level}`).catch(() => {});
    }
  }
}

// Add XP to a member on a track. amount defaults to the track's configured `xp`.
// Handles level-up (reward roles + announcement in #levels). Returns
// { xp, level, leveledUp } or null.
export async function awardXp(guild, member, trackKey, { amount } = {}) {
  const track = TRACK[trackKey];
  if (!member || !track) return null;
  const gain = amount ?? track.xp ?? 0;
  if (gain <= 0) return null;

  const newXp = await addXp(guild.id, member.id, trackKey, gain);
  const before = levelInfo(newXp - gain).level;
  const after = levelInfo(newXp).level;
  if (after !== before) {
    await setLevel(guild.id, member.id, trackKey, after);
    if (after > before) {
      await grantRewardRoles(member, trackKey, after);
      announceLevelUp(guild, member, track, after);
    }
  }
  return { xp: newXp, level: after, leveledUp: after > before };
}

// Absolute set on a track — for /xp set and /xp take (no announce, no role removal).
export async function applyAbsoluteXp(guild, member, trackKey, xp) {
  const clamped = Math.max(0, Math.floor(xp));
  await setXp(guild.id, member.id, trackKey, clamped);
  const { level } = levelInfo(clamped);
  await setLevel(guild.id, member.id, trackKey, level);
  await grantRewardRoles(member, trackKey, level);
  return { xp: clamped, level };
}

// A member's voting weight: 1 + earned reward votes across all tracks, capped by
// server size. Used by weighted /poll and /addonpoll tallies.
export async function voteWeight(guild, userId) {
  const rows = await getMemberTracks(guild.id, userId);
  const levelByTrack = Object.fromEntries(rows.map((r) => [r.track, r.level]));
  let bonus = 0;
  for (const r of REWARDS) {
    if ((levelByTrack[r.track] ?? 0) >= r.level) bonus += r.votes ?? 0;
  }
  return 1 + Math.min(bonus, voteCap(guild.memberCount));
}

function chatMultiplier(channel) {
  const name = channel?.isThread?.() ? (channel.parent?.name ?? '') : (channel?.name ?? '');
  return name.startsWith('beta-') ? BETA_CHANNEL_MULT : 1;
}

// messageCreate handler — chat-track XP for everyone, cooldown-gated.
export async function handleMessage(message) {
  if (message.author?.bot || !message.guild || !message.member) return;
  const k = key(message.guild.id, message.author.id);
  const now = Date.now();
  if (now - (cooldowns.get(k) || 0) < MESSAGE_COOLDOWN_MS) return;
  cooldowns.set(k, now);

  try {
    await awardXp(message.guild, message.member, 'chat', { amount: MESSAGE_XP * chatMultiplier(message.channel) });
  } catch (e) {
    console.error('[levels] awardXp failed:', e.message);
  }
}
