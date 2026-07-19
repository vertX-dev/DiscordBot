import { pool } from './db.js';

// Postgres-backed persistence for warnings and polls. Previously this was
// data/store.json, but Railway's container filesystem is ephemeral (wiped on
// every redeploy), so durable state lives in the DB. Same function names as
// before — now async, so callers await them. Schema: docs/schema.sql.

// --- Warnings --------------------------------------------------------------
export async function addWarning(gid, uid, warning) {
  await pool.query(
    `INSERT INTO warnings (guild_id, user_id, reason, moderator, moderator_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [gid, uid, warning.reason, warning.moderator ?? null, warning.moderatorId ?? null],
  );
  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM warnings WHERE guild_id = $1 AND user_id = $2',
    [gid, uid],
  );
  return rows[0].n;
}

export async function getWarnings(gid, uid) {
  const { rows } = await pool.query(
    'SELECT reason, moderator, moderator_id, created_at FROM warnings WHERE guild_id = $1 AND user_id = $2 ORDER BY created_at',
    [gid, uid],
  );
  return rows.map((r) => ({
    reason: r.reason,
    moderator: r.moderator,
    moderatorId: r.moderator_id,
    timestamp: new Date(r.created_at).getTime(),
  }));
}

export async function clearWarnings(gid, uid) {
  const { rowCount } = await pool.query('DELETE FROM warnings WHERE guild_id = $1 AND user_id = $2', [gid, uid]);
  return rowCount;
}

// --- Polls (JSONB blobs) ---------------------------------------------------
// Read-modify-write on the whole poll object, matching the old JSON-file store
// (same low-concurrency trade-off; fine for a single small guild).
async function savePollKind(gid, kind, poll) {
  await pool.query(
    `INSERT INTO polls (guild_id, id, kind, data) VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (guild_id, id) DO UPDATE SET data = $4::jsonb, updated_at = now()`,
    [gid, poll.id, kind, JSON.stringify(poll)],
  );
}

async function getPollKind(gid, kind, id) {
  const { rows } = await pool.query('SELECT data FROM polls WHERE guild_id = $1 AND id = $2 AND kind = $3', [gid, id, kind]);
  return rows[0]?.data;
}

async function updatePollKind(gid, kind, id, fn) {
  const poll = await getPollKind(gid, kind, id);
  if (!poll) return undefined;
  fn(poll);
  await savePollKind(gid, kind, poll);
  return poll;
}

export const savePoll = (gid, poll) => savePollKind(gid, 'poll', poll);
export const getPoll = (gid, id) => getPollKind(gid, 'poll', id);
export const updatePoll = (gid, id, fn) => updatePollKind(gid, 'poll', id, fn);

export const saveAddonPoll = (gid, poll) => savePollKind(gid, 'addon', poll);
export const getAddonPoll = (gid, id) => getPollKind(gid, 'addon', id);
export const updateAddonPoll = (gid, id, fn) => updatePollKind(gid, 'addon', id, fn);

export async function latestOpenAddonPoll(gid) {
  const { rows } = await pool.query(
    `SELECT data FROM polls
     WHERE guild_id = $1 AND kind = 'addon' AND (data->>'open') = 'true'
     ORDER BY created_at DESC LIMIT 1`,
    [gid],
  );
  return rows[0]?.data;
}
