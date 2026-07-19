import pg from 'pg';

const { Pool, Client } = pg;

// Railway (and most managed Postgres) requires SSL on external connections;
// local/dev Postgres usually doesn't have a cert at all.
function sslConfig(connectionString) {
  if (!connectionString) return undefined;
  if (connectionString.includes('localhost') || connectionString.includes('127.0.0.1')) return undefined;
  return { rejectUnauthorized: false };
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  ssl: sslConfig(process.env.DATABASE_URL),
});

// --- Queries -----------------------------------------------------------------
export async function insertBug({ project, title, body, severity, reporter }) {
  const { rows } = await pool.query(
    `INSERT INTO bug_reports (project, title, body, severity, reporter)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [project, title, body, severity, reporter],
  );
  return rows[0];
}

export async function attachDiscordIds(id, { channelId, messageId, threadId }) {
  await pool.query(
    `UPDATE bug_reports
     SET discord_channel_id = $2, discord_message_id = $3, discord_thread_id = $4
     WHERE id = $1`,
    [id, channelId, messageId, threadId],
  );
}

export async function getBug(id) {
  const { rows } = await pool.query('SELECT * FROM bug_reports WHERE id = $1', [id]);
  return rows[0];
}

export async function updateBugStatus(id, status) {
  const { rows } = await pool.query(
    'UPDATE bug_reports SET status = $2 WHERE id = $1 RETURNING *',
    [id, status],
  );
  return rows[0];
}

export async function listBugs({ project, status } = {}) {
  const clauses = [];
  const params = [];
  if (project) { params.push(project); clauses.push(`project = $${params.length}`); }
  if (status) { params.push(status); clauses.push(`status = $${params.length}`); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT * FROM bug_reports ${where} ORDER BY created_at DESC LIMIT 25`,
    params,
  );
  return rows;
}

export async function distinctProjects() {
  const { rows } = await pool.query('SELECT DISTINCT project FROM bug_reports ORDER BY project LIMIT 25');
  return rows.map((r) => r.project);
}

export async function bugsUpdatedSince(date) {
  const { rows } = await pool.query('SELECT * FROM bug_reports WHERE updated_at >= $1', [date]);
  return rows;
}

// --- Leveling / XP -----------------------------------------------------------
// BIGINT comes back from pg as a string; callers Number() it (xp stays well
// within safe-integer range for any real server).
export async function getMember(gid, uid) {
  const { rows } = await pool.query('SELECT * FROM member_levels WHERE guild_id = $1 AND user_id = $2', [gid, uid]);
  return rows[0];
}

export async function registerMember(gid, uid) {
  const { rows } = await pool.query(
    `INSERT INTO member_levels (guild_id, user_id, registered) VALUES ($1, $2, TRUE)
     ON CONFLICT (guild_id, user_id) DO UPDATE SET registered = TRUE, updated_at = now()
     RETURNING *`,
    [gid, uid],
  );
  return rows[0];
}

// Adds XP only to a registered member. Returns the new xp, or null if the member
// isn't registered (no row updated).
export async function addXp(gid, uid, amount) {
  const { rows } = await pool.query(
    `UPDATE member_levels SET xp = xp + $3, updated_at = now()
     WHERE guild_id = $1 AND user_id = $2 AND registered = TRUE
     RETURNING xp`,
    [gid, uid, amount],
  );
  return rows[0] ? Number(rows[0].xp) : null;
}

// Absolute set (upserts + marks registered) — for /xp set and /xp take.
export async function setXp(gid, uid, xp) {
  const { rows } = await pool.query(
    `INSERT INTO member_levels (guild_id, user_id, xp, registered) VALUES ($1, $2, $3, TRUE)
     ON CONFLICT (guild_id, user_id) DO UPDATE SET xp = $3, updated_at = now()
     RETURNING xp`,
    [gid, uid, xp],
  );
  return Number(rows[0].xp);
}

export async function setLevel(gid, uid, level) {
  await pool.query('UPDATE member_levels SET level = $3, updated_at = now() WHERE guild_id = $1 AND user_id = $2', [gid, uid, level]);
}

export async function leaderboard(gid, limit = 10) {
  const { rows } = await pool.query(
    'SELECT user_id, xp, level FROM member_levels WHERE guild_id = $1 AND registered = TRUE ORDER BY xp DESC LIMIT $2',
    [gid, limit],
  );
  return rows.map((r) => ({ userId: r.user_id, xp: Number(r.xp), level: r.level }));
}

export async function allRegistered(gid) {
  const { rows } = await pool.query('SELECT user_id FROM member_levels WHERE guild_id = $1 AND registered = TRUE', [gid]);
  return rows.map((r) => r.user_id);
}

// --- Beta tests --------------------------------------------------------------
export async function insertBetatest({ guildId, project, projectRoleId, limit, createdBy }) {
  const { rows } = await pool.query(
    `INSERT INTO beta_tests (guild_id, project, project_role_id, limit_testers, created_by, status)
     VALUES ($1, $2, $3, $4, $5, 'open') RETURNING *`,
    [guildId, project, projectRoleId, limit, createdBy],
  );
  return rows[0];
}

export async function attachBetatestDiscord(id, { roleId, channelId, announceChannelId, messageId }) {
  await pool.query(
    `UPDATE beta_tests SET role_id = $2, channel_id = $3, announce_channel_id = $4, message_id = $5 WHERE id = $1`,
    [id, roleId, channelId, announceChannelId, messageId],
  );
}

export async function getBetatest(id) {
  const { rows } = await pool.query('SELECT * FROM beta_tests WHERE id = $1', [id]);
  return rows[0];
}

export async function getOpenBetatestByChannel(channelId) {
  const { rows } = await pool.query("SELECT * FROM beta_tests WHERE channel_id = $1 AND status = 'open'", [channelId]);
  return rows[0];
}

export async function endBetatest(id) {
  const { rows } = await pool.query("UPDATE beta_tests SET status = 'ended', ended_at = now() WHERE id = $1 RETURNING *", [id]);
  return rows[0];
}

export async function listOpenBetatests(gid) {
  const { rows } = await pool.query("SELECT * FROM beta_tests WHERE guild_id = $1 AND status = 'open' ORDER BY id", [gid]);
  return rows;
}

// Returns true if the tester was newly added (false if already in).
export async function addTester(betatestId, userId) {
  const { rowCount } = await pool.query(
    'INSERT INTO beta_testers (betatest_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [betatestId, userId],
  );
  return rowCount > 0;
}

export async function countTesters(betatestId) {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM beta_testers WHERE betatest_id = $1', [betatestId]);
  return rows[0].n;
}

export async function isTester(betatestId, userId) {
  const { rows } = await pool.query('SELECT 1 FROM beta_testers WHERE betatest_id = $1 AND user_id = $2', [betatestId, userId]);
  return rows.length > 0;
}

export async function insertFeedback(betatestId, userId, body) {
  const { rows } = await pool.query(
    'INSERT INTO beta_feedback (betatest_id, user_id, body) VALUES ($1, $2, $3) RETURNING *',
    [betatestId, userId, body],
  );
  return rows[0];
}

// Per-tester feedback counts, most active first — the reward stat.
export async function feedbackStats(betatestId) {
  const { rows } = await pool.query(
    'SELECT user_id, count(*)::int AS count FROM beta_feedback WHERE betatest_id = $1 GROUP BY user_id ORDER BY count DESC',
    [betatestId],
  );
  return rows.map((r) => ({ userId: r.user_id, count: r.count }));
}

// --- Persistent LISTEN client --------------------------------------------------
// A pooled connection can't hold a LISTEN, so this runs on its own dedicated
// Client. On any disconnect it reconnects, re-LISTENs, and reconciles rows
// updated while it was down (covers notifies missed during the gap).
export function startBugListener(onChange) {
  let lastSeenAt = new Date();
  let reconnectTimer = null;

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, 5000);
  }

  async function reconcile() {
    try {
      const since = lastSeenAt;
      lastSeenAt = new Date();
      const rows = await bugsUpdatedSince(since);
      for (const row of rows) {
        onChange({
          id: row.id,
          status: row.status,
          project: row.project,
          discord_channel_id: row.discord_channel_id,
          discord_message_id: row.discord_message_id,
          discord_thread_id: row.discord_thread_id,
        });
      }
    } catch (e) {
      console.error('[bug-listener] reconcile failed:', e.message);
    }
  }

  async function connect() {
    const client = new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: sslConfig(process.env.DATABASE_URL),
    });

    client.on('notification', (msg) => {
      if (msg.channel !== 'bug_status_changed') return;
      lastSeenAt = new Date();
      try {
        onChange(JSON.parse(msg.payload));
      } catch (e) {
        console.error('[bug-listener] bad notify payload:', e.message);
      }
    });

    client.on('error', (err) => {
      console.error('[bug-listener] connection error, reconnecting:', err.message);
      scheduleReconnect();
    });

    client.on('end', () => {
      console.warn('[bug-listener] connection ended, reconnecting...');
      scheduleReconnect();
    });

    try {
      await client.connect();
      await client.query('LISTEN bug_status_changed');
      console.log('[bug-listener] listening for bug_status_changed');
      await reconcile();
    } catch (e) {
      console.error('[bug-listener] failed to connect, retrying in 5s:', e.message);
      client.removeAllListeners();
      scheduleReconnect();
    }
  }

  connect();
}
