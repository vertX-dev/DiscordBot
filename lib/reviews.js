// Shared review-status definitions, used by /review (to apply decisions) and
// /setup (to create matching forum tags on the Support forums).

export const REVIEW_STATUSES = {
  approved: { emoji: '✅', label: 'Approved', color: 0x2ecc71, close: false },
  considering: { emoji: '🤔', label: 'Considering', color: 0xf1c40f, close: false },
  denied: { emoji: '❌', label: 'Denied', color: 0xe74c3c, close: true },
  duplicate: { emoji: '🔁', label: 'Duplicate', color: 0x95a5a6, close: true },
  implemented: { emoji: '🎉', label: 'Implemented', color: 0x2ecc71, close: true },
  fixed: { emoji: '🛠️', label: 'Fixed', color: 0x2ecc71, close: true },
};

export const STATUS_LABELS = Object.values(REVIEW_STATUSES).map((s) => s.label);
export const STATUS_EMOJIS = Object.values(REVIEW_STATUSES).map((s) => s.emoji);

// Forum tag definitions derived from the statuses. moderated = only staff (and
// those with Manage Threads) can apply them, which is what we want for statuses.
export function reviewForumTags() {
  return Object.values(REVIEW_STATUSES).map((s) => ({
    name: s.label,
    moderated: true,
    emoji: { id: null, name: s.emoji },
  }));
}
