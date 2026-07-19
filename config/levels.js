// ---------------------------------------------------------------------------
// LEVELING CONFIG — add a track or reward by editing these arrays; no migration
// needed (tracks are just a `track` string in the member_levels table).
// ---------------------------------------------------------------------------

// Where level-up announcements go (a channel by this name; created by /setup).
export const LEVEL_CHANNEL = 'levels';

// Chat track (per-message XP).
export const MESSAGE_XP = 2;
export const MESSAGE_COOLDOWN_MS = 60_000; // per-user anti-spam
export const BETA_CHANNEL_MULT = 3; // chat XP multiplier in beta-* channels

// Tracks. `xp` is the default award for an action on that track (chat has none —
// it uses MESSAGE_XP). Add a track = add a line here + call awardXp(.., key).
export const TRACKS = [
  { key: 'chat', name: 'Chatter' },
  { key: 'bug', name: 'Bug Hunter', xp: 40 },
  { key: 'beta', name: 'Beta Tester', xp: 25 },
  { key: 'suggestion', name: 'Ideator', xp: 30 },
  { key: 'help', name: 'Helper', xp: 20 },
];
export const TRACK = Object.fromEntries(TRACKS.map((t) => [t.key, t]));

// Reaching `level` in `track` grants `votes` of extra voting weight (stacks
// across tracks, capped by voteCap) and optionally a `role` (by name).
export const REWARDS = [
  { track: 'bug', level: 5, votes: 1 },
  { track: 'beta', level: 5, votes: 1 },
  { track: 'suggestion', level: 5, votes: 1 },
  { track: 'help', level: 5, votes: 1 },
  { track: 'chat', level: 10, votes: 1 },
  // { track: 'bug', level: 15, votes: 1, role: 'Bug Veteran' },
];

// Cap on bonus voting weight, scaled by server size so a few power users can't
// dominate a small community. Tweak freely.
export function voteCap(memberCount) {
  return Math.max(1, Math.floor((memberCount || 0) / 25));
}
