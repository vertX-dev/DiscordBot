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
