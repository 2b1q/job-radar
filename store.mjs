// store.mjs - SQLite state (SRP: persistence only).
// Uses the built-in node:sqlite (Node 22.5+, run with --experimental-sqlite).
// Keeps the set of already-seen job ids so a vacancy is never returned twice,
// plus per-job status marks and a run log. One store for every source: two
// boards republish the same postings, and separate stores would surface a
// vacancy twice, which is the thing this table exists to prevent.

import { DatabaseSync } from 'node:sqlite';

import { normKey } from './adapters/_shared/text.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DB_PATH = process.env.JOBS_DB_PATH || process.env.AF_DB_PATH ||
  join(dirname(fileURLToPath(import.meta.url)), 'jobs.db');

const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id            TEXT PRIMARY KEY,
    company       TEXT,
    title         TEXT,
    url           TEXT,
    country       TEXT,
    salary_label  TEXT,
    first_seen    TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'new',
    note          TEXT
  );
  CREATE TABLE IF NOT EXISTS runs (
    ts        TEXT NOT NULL,
    preset    TEXT,
    since     TEXT,
    found     INTEGER,
    fresh     INTEGER
  );
`);

// Migration, idempotent. Rows written before there was a second source are
// AgileFluent by definition, so the default backfills them correctly.
const columns = new Set(db.prepare('PRAGMA table_info(jobs)').all().map((c) => c.name));
if (!columns.has('source')) db.exec("ALTER TABLE jobs ADD COLUMN source TEXT NOT NULL DEFAULT 'af'");
if (!columns.has('skills')) db.exec('ALTER TABLE jobs ADD COLUMN skills TEXT');
if (!columns.has('dup_key')) db.exec('ALTER TABLE jobs ADD COLUMN dup_key TEXT');
const runCols = new Set(db.prepare('PRAGMA table_info(runs)').all().map((c) => c.name));
if (!runCols.has('source')) db.exec("ALTER TABLE runs ADD COLUMN source TEXT NOT NULL DEFAULT 'af'");
// How many HTTP requests a run cost. Throttling bounds the rate; nothing bounded
// the total, and a board meters the total. Older rows keep NULL rather than a
// zero, because "not recorded" and "made none" are different facts.
if (!runCols.has('requests')) db.exec('ALTER TABLE runs ADD COLUMN requests INTEGER');

// The second key. Boards mint their own ids, so one Greenhouse posting arrives
// as `26043677` from AgileFluent and `tm:266351` from TalentMove and the id
// index sees two vacancies. Company and title are what both boards copy from the
// same source, so that pair is what identifies the posting rather than the row.
//
// Exact match on normalised strings, never fuzzy. The two mistakes are not
// equally priced: a false merge hides a live vacancy and says nothing, while a
// duplicate costs one row that a human sees and dismisses.
// One normaliser for the whole repo, imported rather than re-implemented. It
// lived here in a third variant that replaced separators with a space while the
// adapters removed them - a divergence that would have stopped dedup matching
// without a word.
export function dupKey(company, title) {
  const c = normKey(company);
  const t = normKey(title);
  // No company, no key. TalentMove leaves it null often enough that a title-only
  // key would merge "Backend Developer" at two different companies into one.
  if (!c || !t) return null;
  return `${c}|${t}`;
}

// Backfill, idempotent: only rows that have no key yet, computed from what was
// already stored. Rows whose company was never captured keep a null key and stay
// deduplicated by id alone, which is what they had before.
{
  const pending = db.prepare(
    'SELECT id, company, title FROM jobs WHERE dup_key IS NULL AND company IS NOT NULL'
  ).all();
  if (pending.length) {
    const setKey = db.prepare('UPDATE jobs SET dup_key = ? WHERE id = ?');
    for (const row of pending) {
      const key = dupKey(row.company, row.title);
      if (key) setKey.run(key, row.id);
    }
  }
}

// The key is derived, so it is recomputed when the derivation changes rather
// than left as whatever an older version produced. Found the hard way: an
// undecoded "&amp;" put a stray "amp" in one board's key, and the identical
// posting from another board never met it.
{
  const stale = db.prepare('SELECT id, company, title, dup_key FROM jobs WHERE dup_key IS NOT NULL').all()
    .filter((r) => dupKey(r.company, r.title) !== r.dup_key);
  if (stale.length) {
    const setKey = db.prepare('UPDATE jobs SET dup_key = ? WHERE id = ?');
    for (const row of stale) setKey.run(dupKey(row.company, row.title), row.id);
    console.error(`store: recomputed ${stale.length} dedup keys after a change to how they are built`);
  }
}

db.exec('CREATE INDEX IF NOT EXISTS jobs_dup_key ON jobs (dup_key)');

const today = () => new Date().toISOString();

const hasSeen = db.prepare('SELECT 1 FROM jobs WHERE id = ?');
const hasKey = db.prepare('SELECT id FROM jobs WHERE dup_key = ?');
const insertJob = db.prepare(
  `INSERT OR IGNORE INTO jobs (id, source, company, title, url, country, salary_label, skills, dup_key, first_seen)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const setStatus = db.prepare('UPDATE jobs SET status = ?, note = COALESCE(?, note) WHERE id = ?');
const insertRun = db.prepare(
  `INSERT INTO runs (ts, source, preset, since, found, fresh, requests)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);

// Return only the jobs not seen before; record the fresh ones as seen ('new').
export function filterFresh(jobs) {
  const fresh = [];
  for (const job of jobs) {
    if (hasSeen.get(job.id)) continue;
    // The same posting under the other board's id. Skipped without touching the
    // row that is already there: it may carry a status somebody set by hand.
    const key = dupKey(job.company, job.title);
    if (key && hasKey.get(key)) continue;
    fresh.push(job);
    insertJob.run(
      job.id, job.source || 'af', job.company, job.title, job.url, job.country,
      job.salaryLabel, (job.skills || []).join(', ') || null, key, today()
    );
  }
  return fresh;
}

export function logRun(source, preset, since, found, fresh, requests = null) {
  insertRun.run(today(), source, preset, since, found, fresh, requests);
}

// Requests per source over a window, so the budget can be looked at rather than
// guessed at after a refusal.
export function requestBudget(hours = 24) {
  const since = new Date(Date.now() - hours * 3600e3).toISOString();
  // `unrecorded` travels with the sum on purpose. Runs written before the column
  // existed hold NULL, and folding those into zero makes an incomplete total look
  // like a complete one - the reader would take 2 for the whole budget when five
  // runs simply were not counted.
  return db.prepare(
    `SELECT source,
            COUNT(*) AS runs,
            SUM(COALESCE(requests, 0)) AS requests,
            SUM(CASE WHEN requests IS NULL THEN 1 ELSE 0 END) AS unrecorded
     FROM runs WHERE ts >= ? GROUP BY source`
  ).all(since);
}

// Mark a job's status: applied | rejected | interview | skip | new.
export function markStatus(id, status, note) {
  const before = db.prepare('SELECT status FROM jobs WHERE id = ?').get(id);
  if (!before) return false;
  setStatus.run(status, note ?? null, id);
  return true;
}

export function stats() {
  const total = db.prepare('SELECT COUNT(*) AS n FROM jobs').get().n;
  const byStatus = db.prepare('SELECT status, COUNT(*) AS n FROM jobs GROUP BY status').all();
  const bySource = db.prepare('SELECT source, COUNT(*) AS n FROM jobs GROUP BY source').all();
  const lastRun = db.prepare('SELECT * FROM runs ORDER BY ts DESC LIMIT 1').get() || null;
  return { total, byStatus, bySource, lastRun, requestsLast24h: requestBudget(24) };
}
