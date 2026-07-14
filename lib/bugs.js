import { ChannelType, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { getBug, startBugListener } from './db.js';

// Shared bug-status/severity definitions, used by /bug (embeds + tags), the
// notify-driven sync handler below, and /setup (to create matching forum
// tags on #bug-reports).

export const BUG_STATUSES = {
  open: { label: 'Open', emoji: '🟢', color: 0x2ecc71 },
  in_progress: { label: 'In Progress', emoji: '🔧', color: 0xf1c40f },
  resolved: { label: 'Resolved', emoji: '✅', color: 0x3498db },
  wontfix: { label: 'Wontfix', emoji: '🚫', color: 0x95a5a6 },
};

export const BUG_SEVERITIES = {
  low: { label: 'Low', emoji: '🔵', color: 0x3498db },
  normal: { label: 'Normal', emoji: '⚪', color: 0x95a5a6 },
  high: { label: 'High', emoji: '🟠', color: 0xe67e22 },
  critical: { label: 'Critical', emoji: '🔴', color: 0xe74c3c },
};

const STATUS_LABELS = Object.values(BUG_STATUSES).map((s) => s.label);
const CLOSED_STATUSES = new Set(['resolved', 'wontfix']);

export const BUG_CHANNEL_NAME = 'bug-reports';
export const MAINTAINER_ROLE = 'Maintainer';

export function isMaintainer(member) {
  return member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.roles.cache.some((r) => r.name === MAINTAINER_ROLE);
}

// Forum tags for #bug-reports. Kept separate from lib/reviews.js's
// REVIEW_STATUSES (Approved/Considering/...) which apply to all Support forums.
export function bugForumTags() {
  return [
    ...Object.values(BUG_STATUSES).map((s) => ({ name: s.label, moderated: true, emoji: { id: null, name: s.emoji } })),
    ...Object.values(BUG_SEVERITIES).map((s) => ({ name: s.label, moderated: true, emoji: { id: null, name: s.emoji } })),
  ];
}

export function buildBugEmbed(bug) {
  const status = BUG_STATUSES[bug.status];
  const severity = BUG_SEVERITIES[bug.severity];
  return new EmbedBuilder()
    .setTitle(`${severity.emoji} ${bug.title}`)
    .setDescription(bug.body || '*No description provided.*')
    .setColor(status.color)
    .addFields(
      { name: 'Project', value: bug.project, inline: true },
      { name: 'Status', value: `${status.emoji} ${status.label}`, inline: true },
      { name: 'Severity', value: `${severity.emoji} ${severity.label}`, inline: true },
    )
    .setFooter({ text: `Bug #${bug.id} • reported by ${bug.reporter ?? 'unknown'}` })
    .setTimestamp(bug.created_at ? new Date(bug.created_at) : new Date());
}

export async function resolveBugChannel(guild) {
  const id = process.env.BUG_CHANNEL_ID;
  if (id) {
    const ch = await guild.channels.fetch(id).catch(() => null);
    if (ch) return ch;
  }
  return guild.channels.cache.find((c) => c.type === ChannelType.GuildForum && c.name === BUG_CHANNEL_NAME) ?? null;
}

// --- Notify-driven sync: one handler for both /bug status and the pm TUI's
// UPDATE, since both go through the same pg_notify trigger. --------------------
export function startBugSync(client) {
  if (!process.env.DATABASE_URL) {
    console.warn('[bugs] DATABASE_URL not set — bug tracking sync disabled.');
    return;
  }
  startBugListener((payload) => syncBugToDiscord(client, payload).catch((e) => {
    console.error('[bugs] sync failed for bug', payload.id, e.message);
  }));
}

async function syncBugToDiscord(client, payload) {
  const { discord_channel_id, discord_thread_id } = payload;
  if (!discord_channel_id || !discord_thread_id) return; // not posted to Discord yet

  const thread = await client.channels.fetch(discord_thread_id).catch(() => null);
  if (!thread) return;

  const bug = await getBug(payload.id);
  if (!bug) return;

  if (thread.archived) await thread.setArchived(false).catch(() => {});

  if (bug.discord_message_id) {
    const starter = await thread.messages.fetch(bug.discord_message_id).catch(() => null);
    if (starter) await starter.edit({ embeds: [buildBugEmbed(bug)] }).catch(() => {});
  }

  const parent = thread.parent;
  if (parent?.type === ChannelType.GuildForum) {
    const newTag = parent.availableTags.find((t) => t.name === BUG_STATUSES[bug.status].label);
    if (newTag) {
      const statusTagIds = new Set(parent.availableTags.filter((t) => STATUS_LABELS.includes(t.name)).map((t) => t.id));
      const kept = thread.appliedTags.filter((tid) => !statusTagIds.has(tid));
      await thread.setAppliedTags([...kept, newTag.id].slice(0, 5)).catch(() => {});
    }
  }

  const s = BUG_STATUSES[bug.status];
  await thread.send(`${s.emoji} Status changed to **${s.label}**.`).catch(() => {});

  if (CLOSED_STATUSES.has(bug.status)) {
    await thread.setArchived(true).catch(() => {});
  }
}
