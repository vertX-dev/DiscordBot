import { addXp, setXp, setLevel, allRegistered, registerMember } from './db.js';

// ---------------------------------------------------------------------------
// LEVELING CONFIG — tweak freely; everything below reads from here.
// ---------------------------------------------------------------------------
const MESSAGE_XP = 2; // base XP per eligible message
const MESSAGE_COOLDOWN_MS = 60_000; // per-user, anti-spam
const BETA_MULTIPLIER = 3; // any channel named beta-*
export const FEEDBACK_XP = 25; // bonus for a /betatest feedback submission
const LEVELUP_ANNOUNCE = true; // post a message on level-up

// XP multiplier by (parent) channel name — feedback channels pay more.
const CHANNEL_MULTIPLIERS = {
  'bug-reports': 3,
  suggestions: 2,
  help: 2,
};

// level -> role name granted on reaching it (roles must already exist).
const LEVEL_ROLES = [
  // { level: 10, role: 'Active' },
  // { level: 25, role: 'Veteran' },
];

// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Registered-member cache — avoids a DB read on every message. Loaded on ready,
// updated when someone registers.
const registeredCache = new Set();
const cooldowns = new Map();
const key = (gid, uid) => `${gid}:${uid}`;

export function markRegistered(gid, uid) {
  registeredCache.add(key(gid, uid));
}

export async function startLevels(client) {
  if (!process.env.DATABASE_URL) {
    console.warn('[levels] DATABASE_URL not set — leveling disabled.');
    return;
  }
  for (const [gid] of client.guilds.cache) {
    try {
      for (const uid of await allRegistered(gid)) registeredCache.add(key(gid, uid));
    } catch (e) {
      console.error('[levels] failed to load registered members:', e.message);
    }
  }
  console.log(`[levels] tracking ${registeredCache.size} registered member(s)`);
}

function channelMultiplier(channel) {
  const name = channel?.isThread?.() ? (channel.parent?.name ?? '') : (channel?.name ?? '');
  if (name.startsWith('beta-')) return BETA_MULTIPLIER;
  return CHANNEL_MULTIPLIERS[name] ?? 1;
}

async function grantLevelRoles(member, level) {
  for (const { level: lvl, role: roleName } of LEVEL_ROLES) {
    if (level < lvl) continue;
    const role = member.guild.roles.cache.find((r) => r.name === roleName);
    if (role && !member.roles.cache.has(role.id)) {
      await member.roles.add(role, `Reached level ${lvl}`).catch(() => {});
    }
  }
}

// Core: add `amount` XP to a registered member, handle level-up (role grants +
// announce). Returns { xp, level, leveledUp } or null if not registered.
export async function awardXp(guildId, member, amount, { channel } = {}) {
  if (!member || amount <= 0) return null;
  const newXp = await addXp(guildId, member.id, amount);
  if (newXp == null) return null; // not registered

  const before = levelInfo(newXp - amount).level;
  const after = levelInfo(newXp).level;
  if (after !== before) {
    await setLevel(guildId, member.id, after);
    await grantLevelRoles(member, after);
    if (channel && LEVELUP_ANNOUNCE) {
      channel.send({ content: `🎉 ${member} reached **level ${after}**!`, allowedMentions: { users: [member.id] } }).catch(() => {});
    }
  }
  return { xp: newXp, level: after, leveledUp: after > before };
}

// Absolute set (registers if needed, grants roles up to the new level, no
// announce, no role removal on decrease) — for /xp set and /xp take.
export async function applyAbsoluteXp(guildId, member, xp) {
  const clamped = Math.max(0, Math.floor(xp));
  await setXp(guildId, member.id, clamped);
  const { level } = levelInfo(clamped);
  await setLevel(guildId, member.id, level);
  await grantLevelRoles(member, level);
  markRegistered(guildId, member.id);
  return { xp: clamped, level };
}

// messageCreate handler — small XP with cooldown + channel multiplier, only for
// registered members.
export async function handleMessage(message) {
  if (message.author?.bot || !message.guild || !message.member) return;
  const k = key(message.guild.id, message.author.id);
  if (!registeredCache.has(k)) return;

  const now = Date.now();
  if (now - (cooldowns.get(k) || 0) < MESSAGE_COOLDOWN_MS) return;
  cooldowns.set(k, now);

  try {
    await awardXp(message.guild.id, message.member, MESSAGE_XP * channelMultiplier(message.channel), { channel: message.channel });
  } catch (e) {
    console.error('[levels] awardXp failed:', e.message);
  }
}

// Force-register + return the row (for /level register, /xp give on a new user).
export async function ensureRegistered(gid, uid) {
  const row = await registerMember(gid, uid);
  markRegistered(gid, uid);
  return row;
}
