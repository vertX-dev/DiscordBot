import { PermissionFlagsBits } from 'discord.js';

// ---------------------------------------------------------------------------
// SERVER TEMPLATE
// Edit this file to change your server's layout, then re-run /setup.
// /setup is idempotent: anything that already exists (matched by name) is
// reused, so re-running only adds what's missing.
// ---------------------------------------------------------------------------

// customIds for the interactive components /setup posts. The component handler
// in lib/components.js matches on these, so they must stay in sync.
export const IDS = {
    verifyButton: 'verify-accept',
    roleMenu: 'project-role-menu',
};

// The role every member receives after accepting the rules (the access gate).
export const VERIFIED_ROLE = 'Member';

// --- Roles (created high-to-low; staff first) ------------------------------
// permissions = server-wide powers. Channel visibility is handled separately
// by the category `access` rules below, NOT here.
export const roles = [
    {
        key: 'admin',
        name: 'Admin',
        color: 0xe74c3c,
        hoist: true,
        mentionable: false,
        permissions: [PermissionFlagsBits.Administrator],
    },
    {
        key: 'mod',
        name: 'Moderator',
        color: 0x3498db,
        hoist: true,
        mentionable: false,
        permissions: [
            PermissionFlagsBits.KickMembers,
            PermissionFlagsBits.BanMembers,
            PermissionFlagsBits.ModerateMembers,
            PermissionFlagsBits.ManageMessages,
            PermissionFlagsBits.ManageThreads,
            PermissionFlagsBits.MuteMembers,
            PermissionFlagsBits.MoveMembers,
            PermissionFlagsBits.ViewAuditLog,
        ],
    },
    {
        key: 'dev',
        name: 'Developer',
        color: 0x2ecc71,
        hoist: true,
        mentionable: true,
        permissions: [],
    },
    {
        key: 'supporter',
        name: 'Supporter',
        color: 0xf1c40f,
        hoist: true,
        mentionable: false,
        permissions: [],
    },
    {
        // Gates /bug status and /bug close (see lib/bugs.js MAINTAINER_ROLE).
        key: 'maintainer',
        name: 'Maintainer',
        color: 0x1abc9c,
        hoist: true,
        mentionable: true,
        permissions: [],
    },
    {
        key: 'verified',
        name: VERIFIED_ROLE,
        color: 0x95a5a6,
        hoist: false,
        mentionable: false,
        permissions: [],
    },

    // --- Self-assignable project roles (shown in the #pick-roles menu) --------
    {
        key: 'role-unified',
        name: 'Unified',
        color: 0x5865f2,
        hoist: false,
        mentionable: true,
        selfAssign: true,
        permissions: [],
    },
    {
        key: 'role-pvpbot',
        name: 'PVP Bot',
        color: 0x9b59b6,
        hoist: false,
        mentionable: true,
        selfAssign: true,
        permissions: [],
    },
];

// --- Categories + channels -------------------------------------------------
// access controls who can SEE the category (and its channels):
//   'info'           @everyone can read (read-only), staff can post  -> rules live here
//   'members'        only the gate role (Member) can see              -> the bulk
//   'staff'          only Admin + Moderator
//   'role:<Name>'    only that role (+ Admin) can see                 -> hidden category
//
// channel type: 'text' | 'voice' | 'forum'
export const categories = [
    {
        name: 'Information',
        access: 'info',
        channels: [
            { name: 'welcome', type: 'text', topic: 'Welcome! Start here.' },
            { name: 'rules', type: 'text', topic: 'Read and accept the rules to unlock the server.', postRules: true },
            { name: 'announcements', type: 'text', topic: 'Server & project announcements.' },
        ],
    },
    {
        name: 'Community',
        access: 'members',
        channels: [
            { name: 'general', type: 'text' },
            { name: 'off-topic', type: 'text' },
            { name: 'media', type: 'text', topic: 'Screenshots, clips, and creations.' },
            { name: 'bot-commands', type: 'text', topic: 'Use bot slash commands here.' },
            { name: 'levels', type: 'text', topic: 'Level-up announcements. Earn XP by chatting and contributing.' },
            { name: 'pick-roles', type: 'text', topic: 'Opt into update pings for the projects you care about.', postRoleMenu: true },
        ],
    },
    {
        name: 'Addons',
        access: 'members',
        channels: [{ name: 'addons-general', type: 'text', topic: 'General addon chat. Add per-addon channels with /newaddon.' }],
    },
    {
        // Hidden category — only the Developer role (and Admin) can see it.
        name: 'Tools',
        access: 'role:Developer',
        channels: [
            { name: 'addon-disguiser', type: 'text' },
            { name: 'image-editor', type: 'text' },
            { name: 'unified-cli', type: 'text' },
            { name: 'vtm-vscode-extension', type: 'text' },
            { name: 'vertion', type: 'text' },
        ],
    },
    {
        // Forum channels — one post per question/bug/idea, easy to track.
        name: 'Support',
        access: 'members',
        channels: [
            { name: 'help', type: 'forum', topic: 'Ask for help — open a post per question.' },
            { name: 'bug-reports', type: 'forum', topic: 'Report bugs — one post per bug.' },
            { name: 'suggestions', type: 'forum', topic: 'Suggest features — one post per idea.' },
        ],
    },
    {
        name: 'Voice',
        access: 'members',
        channels: [
            { name: 'General', type: 'voice' },
            { name: 'Dev', type: 'voice' },
            { name: 'AFK', type: 'voice' },
        ],
    },
    {
        name: 'Staff',
        access: 'staff',
        channels: [
            { name: 'staff-chat', type: 'text' },
            { name: 'mod-log', type: 'text', topic: 'Moderation log.' },
        ],
    },
];

// --- Rules message (posted in #rules with an Accept button) ----------------
export const RULES = {
    title: '📜 Server Rules',
    description: [
        'Welcome! Please follow these rules:',
        '',
        '**1.** Be respectful — no harassment, hate speech, or NSFW content.',
        '**2.** No spam, advertising, or self-promotion without permission.',
        '**3.** Keep discussion in the appropriate channels.',
        '**4.** Use English in the main channels where possible.',
        '**5.** Listen to staff — their decisions are final.',
        '',
        'Click **Accept Rules** below to unlock the rest of the server.',
    ].join('\n'),
};

// --- Welcome message -------------------------------------------------------
// Posted when a member accepts the rules and gains access (the gate). No
// privileged intent needed — it hooks the Accept button, not a join event.
// Placeholders: {user} -> mention, {server} -> server name, {count} -> member #.
export const WELCOME = {
    enabled: true,
    channel: 'welcome', // channel name to greet in (e.g. 'welcome' or 'general')
    message: 'Welcome to **{server}**, {user}! 🎉 You\'re member **#{count}** — check out the channels and say hi.',
};
