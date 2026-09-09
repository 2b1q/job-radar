// The way in to the employer, kept in the row rather than in one call's answer.
//
// A merged copy used to be dropped whole - right for a title, wrong for the one
// field only some sources carry. The link now lands in the stored row, whichever
// copy arrives first, and nothing else about the row changes.
//
// No network. The store is imported after JOBS_DB_PATH is set: it opens its
// database at import time.

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

const DB = join(mkdtempSync(join(tmpdir(), 'jobs-apply-')), 'jobs.db');

// A store from before these columns, with a hand-set status to preserve.
{
  const db = new DatabaseSync(DB);
  db.exec(`CREATE TABLE jobs (
    id TEXT PRIMARY KEY, company TEXT, title TEXT, url TEXT, country TEXT,
    salary_label TEXT, first_seen TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new',
    note TEXT);
   CREATE TABLE runs (ts TEXT NOT NULL, preset TEXT, since TEXT, found INTEGER, fresh INTEGER);`);
  db.prepare('INSERT INTO jobs (id, company, title, url, first_seen, status) VALUES (?, ?, ?, ?, ?, ?)')
    .run('25000900', 'OldCo', 'Backend Engineer', 'https://board.invalid/jobs/25000900',
         '2026-09-01T00:00:00.000Z', 'applied');
  db.close();
}

process.env.JOBS_DB_PATH = DB;
const { filterFresh, stats } = await import('../store.mjs');

const rows = (sql, ...args) => {
  const db = new DatabaseSync(DB);
  const out = db.prepare(sql).all(...args);
  db.close();
  return out;
};
const row = (id) => rows('SELECT * FROM jobs WHERE id = ?', id)[0];

/** One posting, as a board publishes it: the link comes back to the board. */
const fromBoard = (n) => ({
  id: `w3:${n}`, source: 'w3', company: `TwinCo${n}`, title: 'Staff Backend Engineer',
  url: `https://board.invalid/jobs/${n}`, applyAtEmployer: false,
  country: 'Remote', salaryLabel: 'not stated', skills: ['Node.js'],
});

/** The same posting, as the employer's own system publishes it. */
const fromEmployer = (n) => ({
  id: `ats:gh:twinco:${n}`, source: 'ats', company: `TwinCo${n}`, title: 'Staff Backend Engineer',
  url: `https://job-boards.greenhouse.io/twinco/jobs/${n}`, applyAtEmployer: true,
  country: 'Remote', salaryLabel: 'not stated', skills: [], note: 'onsite: "This is a hybrid role"',
});

test('the board copy first: the employer link is added to the row it merges into', () => {
  const first = filterFresh([fromBoard(1)]);
  assert.equal(first.length, 1);
  assert.equal(row('w3:1').apply_url, null, 'a board link is not a way to the employer');

  const second = filterFresh([fromEmployer(1)]);
  assert.equal(second.length, 0, 'no duplicate: it is the same posting');
  const [merged] = second.skipped.merged;
  assert.equal(merged.into, 'w3:1');
  assert.equal(merged.stored, true, 'and the answer says the link was kept');

  const kept = row('w3:1');
  assert.match(kept.apply_url, /greenhouse\.io/, 'the way in is in the row now');
  assert.equal(kept.apply_from, 'ats:gh:twinco:1', 'and says which record brought it');
  // One field added, nothing else touched.
  assert.equal(kept.url, 'https://board.invalid/jobs/1', 'the board url is not substituted');
  assert.equal(kept.source, 'w3');
  assert.equal(kept.skills, 'Node.js');
  assert.equal(rows('SELECT id FROM jobs WHERE title = ?', 'Staff Backend Engineer').length, 1);
});

test('the employer copy first: the row has the way in from the start', () => {
  const first = filterFresh([fromEmployer(2)]);
  assert.equal(first.length, 1);
  const stored = row('ats:gh:twinco:2');
  assert.match(stored.apply_url, /greenhouse\.io/);
  assert.equal(stored.apply_from, null, 'null is "its own source stated it"');

  const second = filterFresh([fromBoard(2)]);
  assert.equal(second.length, 0, 'still one posting');
  assert.equal(second.skipped.merged[0].into, 'ats:gh:twinco:2');
  assert.equal('atEmployer' in second.skipped.merged[0], false,
               'the board copy has no employer link to offer');
  assert.match(row('ats:gh:twinco:2').apply_url, /greenhouse\.io/, 'and nothing was lost');
});

test('either order ends in one row with a way in to the employer', () => {
  // The property itself, against both histories above.
  for (const n of [1, 2]) {
    const found = rows("SELECT apply_url FROM jobs WHERE company = ?", `TwinCo${n}`);
    assert.equal(found.length, 1, `TwinCo${n} is stored once`);
    assert.match(found[0].apply_url, /greenhouse\.io/, `TwinCo${n} keeps the way in`);
  }
});

test('a merge never writes over a link the row already has', () => {
  // Two sources offering one is no reason to prefer the newer.
  filterFresh([fromEmployer(3)]);
  const before = row('ats:gh:twinco:3').apply_url;
  filterFresh([{ ...fromEmployer(3), id: 'ats:ashby:twinco:3', url: 'https://jobs.ashbyhq.com/twinco/3' }]);
  assert.equal(row('ats:gh:twinco:3').apply_url, before);
  assert.equal(row('ats:gh:twinco:3').apply_from, null, 'and the provenance is untouched');
});

test('a row stored before the columns existed keeps its status and its NULL', () => {
  // Not backfilled: whether a url reaches the employer is the adapter's
  // judgement. NULL reads as "not recorded", the way runs.requests does.
  const old = row('25000900');
  assert.equal(old.status, 'applied', 'the migration lost nothing');
  assert.equal(old.apply_url, null);
  assert.equal(old.apply_from, null);
});

test('the store can be asked the question, not just one run answer', () => {
  // The point of moving the link out of the answer and into the row.
  const counted = stats().withApplyAtEmployer;
  const w3 = counted.find((c) => c.source === 'w3');
  const ats = counted.find((c) => c.source === 'ats');
  assert.equal(w3.n, 1, 'a board row that a merge gave a way in to');
  assert.equal(ats.n, 2, 'and the rows whose own source carried one');
  assert.equal(counted.some((c) => c.source === 'af'), false, 'nothing is counted that has none');
});
