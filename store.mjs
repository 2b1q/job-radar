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
// Where a company came from when the board did not name it - see
// `resolveCompany`. A derived name is worth having and worth labelling: without
// this column, a vacancy from a board that never names an employer would simply
// have one, and nobody would be able to tell how.
if (!columns.has('company_from')) db.exec('ALTER TABLE jobs ADD COLUMN company_from TEXT');
// The way in to the employer's own application, and where it was found - the
// same pair as `company`/`company_from`, for the same reason. A posting reaches
// this store from whichever source saw it first, and only some sources carry a
// link that leaves the board; keeping that link in the ROW rather than in one
// call's answer is what lets it be asked for tomorrow. `apply_from` is null when
// the row's own source stated it and names the other record when a merge
// recovered it.
//
// Rows written before these columns existed keep NULL, which reads as "not
// recorded" rather than as "does not reach the employer" - the same distinction
// `runs.requests` makes. Nothing is derived for them: whether a url reaches the
// employer is the adapter's judgement, and the store does not hold one.
if (!columns.has('apply_url')) db.exec('ALTER TABLE jobs ADD COLUMN apply_url TEXT');
if (!columns.has('apply_from')) db.exec('ALTER TABLE jobs ADD COLUMN apply_from TEXT');
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

// Cross-board employer resolution.
//
// One board republishes another's postings and names the employer that the
// original leaves blank: AgileFluent `26043677` names a company and links to
// `talent-move.ru/jobs/...-020926-266351/`, while TalentMove's own `tm:266351`
// has no company at all. The link is the join - a republishing board puts the
// original posting's id at the tail of the url - so the name is already in the
// store and costs no request to find.
//
// The recovered name is written with its provenance in `company_from`, never
// silently: a vacancy from a board known for never naming an employer suddenly
// having one is the kind of fact that has to say where it came from.
const TRAILING_ID = /-(\d{4,})\/?$/;

/** The originating board's id at the tail of a republished link, if there is one. */
export const trailingId = (url) => (String(url ?? '').match(TRAILING_ID) || [])[1] || null;

/** `tm:266351` -> `266351`. AgileFluent ids are bare and pass through unchanged. */
const boardId = (id) => String(id ?? '').replace(/^[a-z0-9]+:/, '');

// A board that writes "unknown" into the company field has not named anybody:
// AgileFluent does it for 20 of 284 rows. Copying that across would be worse
// than leaving the field empty - it would build a dup_key of
// `unknown|backend developer`, and the next unnamed Backend Developer would
// merge into it, which is the false merge that hides a live vacancy.
//
// One entry, because one is what has been observed. A second placeholder is a
// measurement away, not a guess away.
const NOT_A_NAME = new Set(['unknown'].map(normKey));

const donorRows = db.prepare(
  `SELECT id, company, url FROM jobs
    WHERE source <> ? AND company IS NOT NULL AND url IS NOT NULL AND url LIKE ?
    ORDER BY first_seen`
);

/**
 * The employer another source names for this posting, or null.
 * Reads the store only: the link between the two records is already stored, and
 * asking a board again would spend a request to learn what is on disk.
 */
export function resolveCompany(job) {
  const bare = boardId(job.id);
  if (!/^\d{4,}$/.test(bare)) return null;
  for (const row of donorRows.all(job.source || 'af', `%-${bare}%`)) {
    // LIKE narrows; the tail match decides. `%-266351%` also matches a url with
    // `-266351-` in the middle, which is a different posting.
    if (trailingId(row.url) !== bare) continue;
    const name = normKey(row.company);
    if (!name || NOT_A_NAME.has(name)) continue;
    return { company: row.company, from: row.id };
  }
  return null;
}

/** The job as stored: its own company, or one derived from another source. */
function withCompany(job) {
  if (job.company) return job;
  const found = resolveCompany(job);
  if (!found) return job;
  return { ...job, company: found.company, companyFrom: found.from };
}

// Backfill, idempotent: rows stored before this existed, and rows whose donor
// arrived later. The dedup key is written in the same step - it is the point of
// recovering the name, and a company without a key would leave the two copies
// of one posting still unable to meet.
{
  const unnamed = db.prepare(
    "SELECT id, source, title FROM jobs WHERE (company IS NULL OR company = '')"
  ).all();
  const resolved = [];
  const setCompany = db.prepare(
    'UPDATE jobs SET company = ?, company_from = ?, dup_key = ? WHERE id = ?'
  );
  for (const row of unnamed) {
    const found = resolveCompany(row);
    if (!found) continue;
    setCompany.run(found.company, found.from, dupKey(found.company, row.title), row.id);
    resolved.push(`${row.id} <- ${found.from} (${found.company})`);
  }
  if (resolved.length) {
    console.error(`store: employer names recovered from another source: ${resolved.join(', ')}`);
  }
}

db.exec('CREATE INDEX IF NOT EXISTS jobs_dup_key ON jobs (dup_key)');

const today = () => new Date().toISOString();

const hasSeen = db.prepare('SELECT 1 FROM jobs WHERE id = ?');
const hasKey = db.prepare('SELECT id FROM jobs WHERE dup_key = ?');
const insertJob = db.prepare(
  `INSERT OR IGNORE INTO jobs (id, source, company, title, url, country, salary_label, skills, dup_key, company_from, note, apply_url, first_seen)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
// The one thing a merge writes to the row it is merging into, and only where
// there was nothing there before.
const setApplyUrl = db.prepare(
  'UPDATE jobs SET apply_url = ?, apply_from = ? WHERE id = ? AND apply_url IS NULL'
);
const setStatus = db.prepare('UPDATE jobs SET status = ?, note = COALESCE(?, note) WHERE id = ?');
const insertRun = db.prepare(
  `INSERT INTO runs (ts, source, preset, since, found, fresh, requests)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);

/**
 * The record's own way in to the employer, or null.
 *
 * Only where the adapter said so. `applyAtEmployer` is `false` on the boards
 * that keep the employer behind their own form and `null` on the one where
 * nobody has classified the links, and neither of those is a link to store.
 */
const employerUrl = (job) => (job.applyAtEmployer === true && job.url ? job.url : null);

// Return only the jobs not seen before; record the fresh ones as seen ('new').
//
// What was skipped travels with the answer, on the array, the way an adapter
// hangs its caveats on what it returns. A cross-board merge was the one thing
// here that happened in complete silence: the whole point of one store is that
// the second board's copy of a posting does not come back, and nothing said it
// had ever happened. `seen` is this board offering the same id again, `merged`
// is another board's copy of a posting already stored, and the two say very
// different things about a run.
export function filterFresh(jobs) {
  const fresh = [];
  const skipped = { seen: 0, merged: [] };
  for (const incoming of jobs) {
    if (hasSeen.get(incoming.id)) { skipped.seen += 1; continue; }
    // An unnamed employer is looked up in the store before the key is built:
    // company + title is the key, so a name recovered here is what lets the two
    // boards' copies of one posting meet at all.
    const job = withCompany(incoming);
    // The same posting under the other board's id. Skipped without touching the
    // row that is already there: it may carry a status somebody set by hand.
    const key = dupKey(job.company, job.title);
    const already = key && hasKey.get(key);
    if (already) {
      // The row that is already there wins - it may carry a status somebody set
      // by hand - and none of its fields is rewritten. One thing is ADDED to it:
      // a way in to the employer's own application, where the copy being merged
      // has one and the stored row does not.
      //
      // Without this the link lived in one call's answer and left with it, and
      // the store kept a row pointing back at a board. That is the whole reason
      // a source of employer-side links was added, so it belongs in the row.
      // Written into an empty column only, never over an existing one: two
      // sources offering a link is not a reason to prefer the newer.
      // `AND apply_url IS NULL` in the statement is the whole condition, and
      // `changes` is the answer: the row either had no way in and now has one,
      // or it already had one and keeps it. Asking first and then writing would
      // be the same test written twice.
      const link = employerUrl(job);
      const recovered = link ? setApplyUrl.run(link, job.id, already.id).changes > 0 : false;
      skipped.merged.push({
        id: job.id, into: already.id,
        ...(link ? { atEmployer: link, stored: recovered } : {}),
      });
      continue;
    }
    fresh.push(job);
    insertJob.run(
      job.id, job.source || 'af', job.company, job.title, job.url, job.country,
      job.salaryLabel, (job.skills || []).join(', ') || null, key,
      job.companyFrom ?? null, job.note ?? null, employerUrl(job), today()
    );
  }
  fresh.skipped = skipped;
  return fresh;
}

/**
 * How many HTTP requests a finished run cost. Never optional: the count is the
 * only view anybody has of a budget the board meters in silence, and a run that
 * did not record one used to land as NULL - indistinguishable from the rows
 * written before the column existed, and invisible inside a sum. Three
 * TalentMove runs sat in the log that way while the board was the one whose
 * refusal costs a paid session.
 *
 * A run reaches this line only after a board answered it, so the floor is one:
 * zero means the counter, not the board.
 */
export function assertRequestsCounted(source, requests) {
  if (Number.isInteger(requests) && requests > 0) return;
  throw new Error(`store: the run on ${source} finished without a request count `
    + `(${requests}). Every run costs at least one request, so this is the `
    + 'counter failing, not a free run - and an uncounted run makes the budget '
    + 'in jobs_stats read lower than what was actually spent');
}

export function logRun(source, preset, since, found, fresh, requests) {
  assertRequestsCounted(source, requests);
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
  // How many stored postings have a way in to the employer's own application,
  // whichever source turned out to carry it. This is the question a shortlist
  // asks the day after a run, and until the link was stored it could not be
  // asked at all. Rows written before the column keep NULL and are not counted:
  // "not recorded" and "does not reach the employer" are different facts.
  const withApplyAtEmployer = db.prepare(
    'SELECT source, COUNT(*) AS n FROM jobs WHERE apply_url IS NOT NULL GROUP BY source'
  ).all();
  const lastRun = db.prepare('SELECT * FROM runs ORDER BY ts DESC LIMIT 1').get() || null;
  return { total, byStatus, bySource, withApplyAtEmployer, lastRun, requestsLast24h: requestBudget(24) };
}
