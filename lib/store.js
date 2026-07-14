import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Tiny JSON-file persistence for warnings and polls. Low-volume, so we just
// read-modify-write the whole file per operation — simple and crash-safe enough.
// Shape: { "<guildId>": { warnings: {uid:[...]}, polls: {id:{...}}, addonPolls: {id:{...}} } }

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIR = join(__dirname, '..', 'data');
const FILE = join(DIR, 'store.json');

function load() {
  try {
    return JSON.parse(readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
}

function save(data) {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(data, null, 2));
}

function mutate(fn) {
  const data = load();
  const result = fn(data);
  save(data);
  return result;
}

function guild(data, id) {
  if (!data[id]) data[id] = {};
  return data[id];
}

// --- Warnings --------------------------------------------------------------
export function addWarning(gid, uid, warning) {
  return mutate((d) => {
    const g = guild(d, gid);
    if (!g.warnings) g.warnings = {};
    if (!g.warnings[uid]) g.warnings[uid] = [];
    g.warnings[uid].push(warning);
    return g.warnings[uid].length;
  });
}

export function getWarnings(gid, uid) {
  return load()[gid]?.warnings?.[uid] ?? [];
}

export function clearWarnings(gid, uid) {
  return mutate((d) => {
    const list = d[gid]?.warnings?.[uid] ?? [];
    const count = list.length;
    if (d[gid]?.warnings) delete d[gid].warnings[uid];
    return count;
  });
}

// --- Generic polls ---------------------------------------------------------
export function savePoll(gid, poll) {
  mutate((d) => {
    const g = guild(d, gid);
    if (!g.polls) g.polls = {};
    g.polls[poll.id] = poll;
  });
}

export function getPoll(gid, id) {
  return load()[gid]?.polls?.[id];
}

export function updatePoll(gid, id, fn) {
  return mutate((d) => {
    const p = d[gid]?.polls?.[id];
    if (p) fn(p);
    return p;
  });
}

// --- Addon prioritization polls -------------------------------------------
export function saveAddonPoll(gid, poll) {
  mutate((d) => {
    const g = guild(d, gid);
    if (!g.addonPolls) g.addonPolls = {};
    g.addonPolls[poll.id] = poll;
  });
}

export function getAddonPoll(gid, id) {
  return load()[gid]?.addonPolls?.[id];
}

export function updateAddonPoll(gid, id, fn) {
  return mutate((d) => {
    const p = d[gid]?.addonPolls?.[id];
    if (p) fn(p);
    return p;
  });
}

export function latestOpenAddonPoll(gid) {
  const map = load()[gid]?.addonPolls;
  if (!map) return null;
  const open = Object.values(map).filter((p) => p.open);
  if (!open.length) return null;
  return open.sort((a, b) => (a.id < b.id ? 1 : -1))[0];
}
