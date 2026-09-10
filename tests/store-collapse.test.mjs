// Collapsing duplicates that predate the dedup key.
//
// Rows written before `dup_key` existed were deduplicated by id alone, so one
// posting could sit in the store several times. The rows themselves are cheap;
// what is not is that a status set by hand sat on one of them while its twins
// still read `new`, so a shortlist showed a vacancy already applied to.
//
// The migration is destructive, so it is checked for what it keeps, not only
// for what it removes.

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

const DB = join(mkdtempSync(join(tmpdir(), 'jobs-collapse-')), 'jobs.db');

// A store as it looked before the key: three copies of one posting under three
// board ids, the mark on the last of them, and an unrelated row beside it.
{
  const db = new DatabaseSync(DB);
  db.exec(`CREATE TABLE jobs (
    id TEXT PRIMARY KEY, company TEXT, title TEXT, url TEXT, country TEXT,
    salary_label TEXT, first_seen TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new',
    note TEXT);
   CREATE TABLE runs (ts TEXT NOT NULL, preset TEXT, since TEXT, found INTEGER, fresh INTEGER);`);
  const ins = db.prepare(
    'INSERT INTO jobs (id, company, title, url, first_seen, status, note) VALUES (?, ?, ?, ?, ?, ?, ?)');
  ins.run('100', 'GammaCo', 'Staff Backend Engineer', 'https://board.invalid/1', '2026-09-01T00:00:00.000Z', 'new', null);
  ins.run('tm:200', 'GammaCo', 'Staff Backend Engineer', 'https://jobs.ashbyhq.com/gammaco/2', '2026-09-02T00:00:00.000Z', 'new', null);
  ins.run('w3:300', 'GammaCo', 'Staff Backend Engineer', 'https://board.invalid/3', '2026-09-03T00:00:00.000Z', 'applied', 'phone screen booked');
  ins.run('400', 'DeltaCo', 'Data Analyst', 'https://board.invalid/4', '2026-09-01T00:00:00.000Z', 'skip', null);
  db.close();
}

process.env.JOBS_DB_PATH = DB;
const store = await import('../store.mjs');

const rows = (sql, ...args) => {
  const db = new DatabaseSync(DB);
  const out = db.prepare(sql).all(...args);
  db.close();
  return out;
};

test('the group is one row, and it is the earliest', () => {
  const kept = rows("SELECT id, first_seen FROM jobs WHERE company = 'GammaCo'");
  assert.equal(kept.length, 1);
  assert.equal(kept[0].id, '100', 'the first one seen survives, so its id keeps meaning what it meant');
});

test('and it inherits the strongest status from any of its twins', () => {
  const [kept] = rows("SELECT status, note FROM jobs WHERE company = 'GammaCo'");
  assert.equal(kept.status, 'applied', 'the mark was on the third copy');
  assert.equal(kept.note, 'phone screen booked');
});

test('and the way in to the employer, which only one twin carried', () => {
  // Only the second copy pointed at an ATS. Its link was classified from the
  // host before the collapse, and the survivor inherits it.
  const [kept] = rows("SELECT apply_url, apply_from, url FROM jobs WHERE company = 'GammaCo'");
  assert.match(kept.apply_url, /ashbyhq\.com/);
  assert.equal(kept.apply_from, 'host', 'derived, and it says so');
  assert.equal(kept.url, 'https://board.invalid/1', 'its own link is not substituted');
});

test('a row with no twin is untouched', () => {
  const [other] = rows("SELECT id, status FROM jobs WHERE company = 'DeltaCo'");
  assert.equal(other.id, '400');
  assert.equal(other.status, 'skip');
});

test('the store it started from is kept beside it', () => {
  assert.ok(existsSync(`${DB}.pre-collapse.bak`), 'a destructive migration leaves a way back');
  const before = new DatabaseSync(`${DB}.pre-collapse.bak`, { readOnly: true });
  assert.equal(before.prepare('SELECT COUNT(*) n FROM jobs').get().n, 4);
  before.close();
});

test('running it again finds nothing to do', async () => {
  const before = rows('SELECT id FROM jobs').length;
  await import(`../store.mjs?again=${Date.now()}`);
  assert.equal(rows('SELECT id FROM jobs').length, before);
});
