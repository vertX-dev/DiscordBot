// Rarity & Stats support-pack generator config.

export const PACK_NAME = 'Rarity & Stats — Support Pack';
export const PACK_DESCRIPTION = 'Registers extra materials & item types with Rarity & Stats. Load alongside R&S.';
export const PACK_AUTHOR = 'vertX';

// Role that may register/approve/remove/generate (checked at runtime, or Administrator).
export const MAINTAINER_ROLE = 'Addon Maintainer';

// The forum channel the generated pack is posted to. Set RRS_FORUM_CHANNEL_ID in
// env, else the bot looks up a forum channel whose name contains "rarity".
export const FORUM_NAME_HINT = 'rarity';
export const PINNED_POST_TITLE = 'Rarity & Stats — Support Pack';

// Base rarity tiers (for gentle validation — custom/namespaced tiers are allowed).
export const BASE_TIERS = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ascended'];

// --- Manifest (SWAP these UUIDs for your own stable ids before publishing) ----
export const HEADER_UUID = 'a7f3c2e1-9b4d-4c6a-8e2f-1d5b3a9c7e04';
export const MODULE_UUID = 'b8e4d3f2-0c5e-4d7b-9f30-2e6c4bad8f15';
export const MIN_ENGINE_VERSION = [1, 21, 100];
export const VERSION_MAJOR_MINOR = [1, 0]; // patch auto-bumps per generation (stored in rrs_meta)
export const DEPENDENCIES = [
  { module_name: '@minecraft/server', version: '2.8.0' },
  { module_name: '@minecraft/server-ui', version: '2.1.0' },
];
