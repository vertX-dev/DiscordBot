import { EmbedBuilder } from 'discord.js';

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function bar(pct) {
  const filled = Math.round(pct / 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

// --- Generic poll (single choice, button voting) ---------------------------
export function buildPollEmbed(poll) {
  const total = poll.options.reduce((a, o) => a + o.votes.length, 0);
  const lines = poll.options.map((o, i) => {
    const count = o.votes.length;
    const pct = total ? Math.round((count / total) * 100) : 0;
    return `**${i + 1}. ${o.label}**\n${bar(pct)}  ${count} · ${pct}%`;
  });
  return new EmbedBuilder()
    .setTitle(`📊 ${poll.question}`)
    .setDescription(lines.join('\n\n'))
    .setColor(poll.open ? 0x5865f2 : 0x95a5a6)
    .setFooter({ text: poll.open ? `${total} vote(s) · one vote each` : `Closed · ${total} vote(s)` });
}

// Record a single-choice vote: remove the user from every option, then add
// them to the chosen one. Returns 'added' or 'switched'.
export function recordVote(poll, optionIndex, userId) {
  let had = false;
  for (const o of poll.options) {
    const idx = o.votes.indexOf(userId);
    if (idx !== -1) { o.votes.splice(idx, 1); had = true; }
  }
  poll.options[optionIndex].votes.push(userId);
  return had ? 'switched' : 'added';
}

// --- Addon prioritization poll (multi-pick, ranked, slot budget) -----------
// Greedily fills the weekly-slot budget by difficulty in rank order; everything
// that fits is "weekly" priority, the rest is "monthly".
export function tallyAddons(poll) {
  const counts = Object.fromEntries(poll.addons.map((a) => [a, 0]));
  for (const picks of Object.values(poll.votes)) {
    for (const a of picks) if (a in counts) counts[a] += 1;
  }
  const ranked = poll.addons
    .map((name) => ({ name, votes: counts[name], difficulty: poll.difficulty[name] ?? 1 }))
    .sort((x, y) => y.votes - x.votes || x.difficulty - y.difficulty);

  let used = 0;
  for (const r of ranked) {
    if (r.votes > 0 && used + r.difficulty <= poll.budget) {
      r.priority = true;
      used += r.difficulty;
    } else {
      r.priority = false;
    }
  }
  return { ranked, used, budget: poll.budget };
}

export function buildAddonEmbed(poll) {
  const { ranked, used, budget } = tallyAddons(poll);
  const voters = Object.keys(poll.votes).length;
  const lines = ranked.map((r, i) => {
    const place = ['🥇', '🥈', '🥉'][i] ?? `\`${String(i + 1).padStart(2, ' ')}.\``;
    const tag = r.priority ? '🟢 weekly' : '⚪ monthly';
    return `${place} **${r.name}** — ${r.votes} vote(s) · diff ${r.difficulty} · ${tag}`;
  });
  return new EmbedBuilder()
    .setTitle(`🗳️ Monthly Addon Priority${poll.month ? ` — ${poll.month}` : ''}`)
    .setDescription(lines.join('\n'))
    .addFields({ name: 'Weekly slot budget', value: `${used} / ${budget} points used by priority addons` })
    .setColor(poll.open ? 0x2ecc71 : 0x95a5a6)
    .setFooter({
      text: poll.open
        ? `${voters} voter(s) · pick up to ${poll.maxVotes} · open`
        : `${voters} voter(s) · closed`,
    });
}
