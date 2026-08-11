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

// --- Leveling / XP (per track) -----------------------------------------------
// BIGINT comes back from pg as a string; callers Number() it (xp stays within
// safe-integer range for any real server). Everyone is auto-tracked: the first
// XP on a track upserts the row.
export async function addXp(gid, uid, track, amount) {
  const { rows } = await pool.query(
    `INSERT INTO member_levels (guild_id, user_id, track, xp) VALUES ($1, $2, $3, $4)
     ON CONFLICT (guild_id, user_id, track)
       DO UPDATE SET xp = member_levels.xp + $4, updated_at = now()
     RETURNING xp`,
    [gid, uid, track, amount],
  );
  return Number(rows[0].xp);
}

// Absolute set (upsert) — for /xp set and /xp take.
export async function setXp(gid, uid, track, xp) {
  const { rows } = await pool.query(
    `INSERT INTO member_levels (guild_id, user_id, track, xp) VALUES ($1, $2, $3, $4)
     ON CONFLICT (guild_id, user_id, track) DO UPDATE SET xp = $4, updated_at = now()
     RETURNING xp`,
    [gid, uid, track, xp],
  );
  return Number(rows[0].xp);
}

export async function setLevel(gid, uid, track, level) {
  await pool.query(
    'UPDATE member_levels SET level = $4, updated_at = now() WHERE guild_id = $1 AND user_id = $2 AND track = $3',
    [gid, uid, track, level],
  );
}

// All of a member's tracks (for /level view and vote-weight calculation).
export async function getMemberTracks(gid, uid) {
  const { rows } = await pool.query('SELECT track, xp, level FROM member_levels WHERE guild_id = $1 AND user_id = $2', [gid, uid]);
  return rows.map((r) => ({ track: r.track, xp: Number(r.xp), level: r.level }));
}

export async function leaderboard(gid, track, limit = 10) {
  const { rows } = await pool.query(
    'SELECT user_id, xp, level FROM member_levels WHERE guild_id = $1 AND track = $2 ORDER BY xp DESC LIMIT $3',
    [gid, track, limit],
  );
  return rows.map((r) => ({ userId: r.user_id, xp: Number(r.xp), level: r.level }));
}

// --- Beta tests --------------------------------------------------------------
export async function insertBetatest({ guildId, project, name, projectRoleId, extraRoleId, limit, createdBy }) {
  const { rows } = await pool.query(
    `INSERT INTO beta_tests (guild_id, project, name, project_role_id, extra_role_id, limit_testers, created_by, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'open') RETURNING *`,
    [guildId, project, name ?? null, projectRoleId, extraRoleId ?? null, limit, createdBy],
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

// --- Addons ------------------------------------------------------------------
function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90) || 'addon';
}

// Create/update an addon (from /newaddon). COALESCE keeps an existing role/channel
// if this call doesn't supply one.
export async function upsertAddon(gid, { name, slug, difficulty, roleId, channelId, selfAssign }) {
  const { rows } = await pool.query(
    `INSERT INTO addons (guild_id, name, slug, difficulty, role_id, channel_id, self_assign)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (guild_id, name) DO UPDATE SET
       slug = EXCLUDED.slug,
       difficulty = EXCLUDED.difficulty,
       role_id = COALESCE(EXCLUDED.role_id, addons.role_id),
       channel_id = COALESCE(EXCLUDED.channel_id, addons.channel_id),
       self_assign = EXCLUDED.self_assign
     RETURNING *`,
    [gid, name, slug ?? slugify(name), difficulty ?? 3, roleId ?? null, channelId ?? null, selfAssign ?? false],
  );
  return rows[0];
}

// Seed a built-in addon (from config) without clobbering edits.
export async function seedAddon(gid, name, difficulty) {
  await pool.query(
    `INSERT INTO addons (guild_id, name, slug, difficulty) VALUES ($1, $2, $3, $4)
     ON CONFLICT (guild_id, name) DO NOTHING`,
    [gid, name, slugify(name), difficulty ?? 3],
  );
}

export async function listAddons(gid) {
  const { rows } = await pool.query('SELECT * FROM addons WHERE guild_id = $1 ORDER BY name', [gid]);
  return rows;
}

// --- Rarity & Stats registrations --------------------------------------------
// Suggest: insert as pending only if the key is free (returns row, or null on conflict).
export async function rrsSuggest(gid, { kind, key, data, userId }) {
  const { rows } = await pool.query(
    `INSERT INTO rrs_registrations (guild_id, kind, reg_key, data, approved, suggested_by)
     VALUES ($1, $2, $3, $4, FALSE, $5)
     ON CONFLICT (guild_id, kind, reg_key) DO NOTHING
     RETURNING *`,
    [gid, kind, key, JSON.stringify(data), userId],
  );
  return rows[0] ?? null;
}

// Register (maintainer): upsert as approved.
export async function rrsRegister(gid, { kind, key, data, userId }) {
  const { rows } = await pool.query(
    `INSERT INTO rrs_registrations (guild_id, kind, reg_key, data, approved, suggested_by, approved_by)
     VALUES ($1, $2, $3, $4, TRUE, $5, $5)
     ON CONFLICT (guild_id, kind, reg_key)
       DO UPDATE SET data = $4, approved = TRUE, approved_by = $5
     RETURNING *`,
    [gid, kind, key, JSON.stringify(data), userId],
  );
  return rows[0];
}

export async function rrsApprove(gid, id, userId) {
  const { rows } = await pool.query(
    'UPDATE rrs_registrations SET approved = TRUE, approved_by = $3 WHERE guild_id = $1 AND id = $2 RETURNING *',
    [gid, id, userId],
  );
  return rows[0];
}

export async function rrsRemove(gid, id) {
  const { rows } = await pool.query('DELETE FROM rrs_registrations WHERE guild_id = $1 AND id = $2 RETURNING *', [gid, id]);
  return rows[0];
}

export async function rrsList(gid, { kind, approved } = {}) {
  const clauses = ['guild_id = $1'];
  const params = [gid];
  if (kind) { params.push(kind); clauses.push(`kind = $${params.length}`); }
  if (approved !== undefined) { params.push(approved); clauses.push(`approved = $${params.length}`); }
  const { rows } = await pool.query(
    `SELECT * FROM rrs_registrations WHERE ${clauses.join(' AND ')} ORDER BY kind, reg_key`,
    params,
  );
  return rows;
}

// Bump the patch version and return the full [maj, min, patch] using config base.
export async function rrsBumpVersion(gid, [maj, min]) {
  const { rows } = await pool.query(
    `INSERT INTO rrs_meta (guild_id, version_patch) VALUES ($1, 1)
     ON CONFLICT (guild_id) DO UPDATE SET version_patch = rrs_meta.version_patch + 1
     RETURNING version_patch`,
    [gid],
  );
  return [maj, min, rows[0].version_patch];
}

export async function rrsGetMeta(gid) {
  const { rows } = await pool.query('SELECT * FROM rrs_meta WHERE guild_id = $1', [gid]);
  return rows[0];
}

export async function rrsSetForumThread(gid, threadId) {
  await pool.query(
    `INSERT INTO rrs_meta (guild_id, forum_thread_id) VALUES ($1, $2)
     ON CONFLICT (guild_id) DO UPDATE SET forum_thread_id = $2`,
    [gid, threadId],
  );
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
