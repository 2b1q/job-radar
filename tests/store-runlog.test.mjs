// The run log, and the count that has to be in it.
//
// `runs.requests` is the only view of a budget the boards meter in silence - one
// of them starts answering 401 somewhere past thirty requests in an hour. Three
// TalentMove runs sat in the log with the column empty, and the budget they
// spent was reported as zero next to `unrecorded: 3`: technically honest,
// practically invisible, and on the board where a refusal costs a paid session.
//
// A run reaches the log only after a board answered it, so a missing count is
// the counter failing rather than a free run, and it is now refused.
//
// No network. The store is imported after JOBS_DB_PATH is set.

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { createHttp } from '../adapters/_shared/http.mjs';

const DB = join(mkdtempSync(join(tmpdir(), 'jobs-runlog-')), 'jobs.db');

// One run from before the column existed. It is genuinely unrecorded, and must
// stay distinguishable from a run that spent nothing.
{
  const db = new DatabaseSync(DB);
  db.exec(`CREATE TABLE jobs (
    id TEXT PRIMARY KEY, company TEXT, title TEXT, url TEXT, country TEXT,
    salary_label TEXT, first_seen TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new',
    note TEXT);
   CREATE TABLE runs (ts TEXT NOT NULL, preset TEXT, since TEXT, found INTEGER,
    fresh INTEGER);`);
  db.prepare('INSERT INTO runs (ts, preset, since, found, fresh) VALUES (?, ?, ?, ?, ?)')
    .run(new Date().toISOString(), 'remote', 'week', 80, 20);
  db.close();
}

process.env.JOBS_DB_PATH = DB;
const store = await import('../store.mjs');

const runs = () => {
  const db = new DatabaseSync(DB);
  const out = db.prepare('SELECT source, requests FROM runs').all();
  db.close();
  return out;
};

test('a run records what it cost', () => {
  store.logRun('w3', 'remote', 'week', 30, 30, 4);
  const [budget] = store.requestBudget(24).filter((b) => b.source === 'w3');
  assert.equal(budget.runs, 1);
  assert.equal(budget.requests, 4);
  assert.equal(budget.unrecorded, 0);
});

test('an adapter that never counted a request is an error, not a free run', () => {
  // Teeth: the counter itself, from the module every adapter builds on, with the
  // request never counted - which is what a board client that forgets
  // `countRequest()` looks like from here.
  const http = createHttp({ throttleMs: 0, jitterMs: 0 });
  const before = http.requestCount();
  // ... a page is fetched, and nothing counts it ...
  const spent = http.requestCount() - before;
  assert.equal(spent, 0);
  assert.throws(() => store.assertRequestsCounted('tm', spent),
                /finished without a request count/);
});

test('the missing count is refused before a row is written', () => {
  // Otherwise the log grows a row that says the run was free, which is the shape
  // the failure had in the first place.
  const before = runs().length;
  assert.throws(() => store.logRun('tm', 'remote', 'week', 80, 20, undefined),
                /without a request count/);
  assert.throws(() => store.logRun('tm', 'remote', 'week', 80, 20, null),
                /without a request count/);
  assert.equal(runs().length, before);
});

test('a run written before the column existed stays unrecorded, not zero', () => {
  // "Not counted" and "cost nothing" are different facts, and folding the first
  // into the second presents an incomplete total as a complete one.
  const [budget] = store.requestBudget(24).filter((b) => b.source === 'af');
  assert.equal(budget.runs, 1);
  assert.equal(budget.unrecorded, 1);
  assert.equal(budget.requests, 0);
});
