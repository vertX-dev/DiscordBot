// recover.js — crash-recovery launcher for the bot.
//
// Picks HOW to bring the bot back based on the current time in Amsterdam:
//   • Peak hours (08:00–20:00 Europe/Amsterdam): start it LOCALLY from this
//     folder (`node index.js`) — recovery is instant, no waiting on Railway.
//   • Off-peak: trigger a Railway redeploy
//     (`railway redeploy --service <name> -y`).
//
// It first pings the live /health endpoint. If the bot answers (HTTP 200), it's
// already up, so the script does nothing — this is the guard against running a
// second copy. Only when /health is unreachable does it recover.
//
// Run:
//   npm run recover               check health, recover only if down
//   npm run recover -- --local    force a local start (skips the health check)
//   npm run recover -- --railway  force a Railway redeploy (skips the check)
//   npm run recover -- --force    recover even if /health says it's up
//
// Tunable via env: PEAK_START (8), PEAK_END (20), PEAK_TZ (Europe/Amsterdam),
// RAILWAY_SERVICE (DiscordBot), HEALTH_URL.
//
// ⚠ Only ONE instance may run at a time. The health check guards this, but a
//   forced local start while Railway is still up makes both copies double-reply.

import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PEAK_START = Number(process.env.PEAK_START ?? 8); // inclusive hour
const PEAK_END = Number(process.env.PEAK_END ?? 20); // exclusive hour
const PEAK_TZ = process.env.PEAK_TZ ?? 'Europe/Amsterdam';
const SERVICE = process.env.RAILWAY_SERVICE ?? 'DiscordBot';
const HEALTH_URL = process.env.HEALTH_URL ?? 'https://discordbot-production-31a3.up.railway.app/health';

// True only if /health answers 200. Any other status (incl. Railway's edge 404
// "Application not found" when nothing is deployed) or a network error = down.
async function isUp() {
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(8000) });
    return res.ok;
  } catch {
    return false;
  }
}

// Current hour (0–23) in the given IANA timezone, DST-correct via Intl.
function zonedHour(tz) {
  const h = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date())
    .find((p) => p.type === 'hour').value;
  return Number(h);
}

function isPeak() {
  const h = zonedHour(PEAK_TZ);
  return h >= PEAK_START && h < PEAK_END;
}

function startLocal() {
  console.log('⚠ Ensure the Railway instance is actually DOWN — two copies double-reply.');
  console.log(`Peak hours → starting the bot locally from ${__dirname}`);
  const child = spawn(process.execPath, ['index.js'], { cwd: __dirname, stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 0));
}

function redeployRailway() {
  console.log(`Off-peak → redeploying "${SERVICE}" on Railway...`);
  const child = spawn('railway', ['redeploy', '--service', SERVICE, '-y'], { stdio: 'inherit', shell: true });
  child.on('exit', (code) => {
    if (code !== 0) {
      console.error(`railway redeploy exited ${code} — is the CLI installed and this folder linked (\`railway link\`)?`);
    }
    process.exit(code ?? 0);
  });
}

const flags = process.argv.slice(2);
const forced = flags.includes('--local') || flags.includes('--railway') || flags.includes('--force');

// Health gate: unless a mode is forced, do nothing if the bot already answers.
if (!forced) {
  process.stdout.write(`Checking ${HEALTH_URL} ... `);
  if (await isUp()) {
    console.log('up — nothing to recover. (Use --force to launch anyway.)');
    process.exit(0);
  }
  console.log('down — recovering.');
}

const goLocal = flags.includes('--local') || (!flags.includes('--railway') && isPeak());

console.log(`Now ${String(zonedHour(PEAK_TZ)).padStart(2, '0')}:00 ${PEAK_TZ} — peak window ${PEAK_START}:00–${PEAK_END}:00.`);
if (goLocal) startLocal();
else redeployRailway();
