// Recovering an employer name from another source, on a throwaway database.
//
// One board republishes another's postings and names the employer the original
// leaves blank: AgileFluent `26043677` names a company and links to
// `talent-move.ru/jobs/...-266351/`, while TalentMove's `tm:266351` has no
// company at all. The republished link carries the original id at its tail, so
// the two rows can be joined without asking either board anything.
//
// The name is derived, so it is labelled: `company_from` says which row it came
// from. A board known for never naming an employer suddenly naming one, with no
// way to see why, is the kind of quiet answer this repo keeps finding.
//
// No network. The store is imported after JOBS_DB_PATH is set, because it opens
// its database at import time.

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

const DB = join(mkdtempSync(join(tmpdir(), 'jobs-company-')), 'jobs.db');

const TM_URL = 'https://talent-move.ru/jobs/lead-senior-backend-developer-remote-020926-266351/';

// A store as it stands before this change: rows from two sources, one of them
// carrying the employer and the link, the other carrying neither. Importing the
// module has to add the column and join the two without being asked.
{
  const db = new DatabaseSync(DB);
  db.exec(`CREATE TABLE jobs (
    id TEXT PRIMARY KEY, company TEXT, title TEXT, url TEXT, country TEXT,
    salary_label TEXT, first_seen TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new',
    note TEXT, source TEXT NOT NULL DEFAULT 'af', skills TEXT, dup_key TEXT);
   CREATE TABLE runs (ts TEXT NOT NULL, preset TEXT, since TEXT, found INTEGER,
    fresh INTEGER, source TEXT NOT NULL DEFAULT 'af', requests INTEGER);`);
  const ins = db.prepare(
    'INSERT INTO jobs (id, source, company, title, url, first_seen) VALUES (?, ?, ?, ?, ?, ?)');
  ins.run('26043677', 'af', 'GammaCo', 'Lead/Senior Backend Developer, TypeScript/Node.js',
          TM_URL, '2026-09-02T00:00:00.000Z');
  ins.run('tm:266351', 'tm', null, 'Lead/Senior Backend Developer по TypeScript/Node.js',
          TM_URL, '2026-09-04T00:00:00.000Z');
  // The same board writes the literal "unknown" where it has no employer, and
  // links to a TalentMove posting all the same.
  ins.run('25830919', 'af', 'unknown', 'Backend Developer',
          'https://talent-move.ru/jobs/backend-developer-270826-262441/',
          '2026-09-02T00:00:00.000Z');
  ins.run('tm:262441', 'tm', null, 'Backend Developer, remote',
          'https://talent-move.ru/jobs/backend-developer-270826-262441/',
          '2026-09-04T00:00:00.000Z');
  db.close();
}

process.env.JOBS_DB_PATH = DB;
const store = await import('../store.mjs');

const read = (id) => {
  const db = new DatabaseSync(DB);
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  db.close();
  return row;
};

const job = (over) => ({
  id: 'x', source: 'tm', company: null, title: 'T', url: 'https://example.invalid/1',
  country: null, salaryLabel: 'not stated', skills: [], ...over,
});

test('a name missing on one board is taken from the board that republished it', () => {
  const row = read('tm:266351');
  assert.equal(row.company, 'GammaCo');
  assert.equal(row.company_from, '26043677', 'and it says where it came from');
});

test('the recovered name gives the row the dedup key it could not have', () => {
  // The point of recovering it. No company, no key - so an unnamed posting was
  // invisible to cross-board dedup precisely where a second board had named it.
  const row = read('tm:266351');
  assert.equal(row.dup_key, store.dupKey('GammaCo', row.title));
});

test('a row the board did name is left alone', () => {
  const row = read('26043677');
  assert.equal(row.company, 'GammaCo');
  assert.equal(row.company_from, null, 'nothing derived, nothing to declare');
});

test('"unknown" is not a name and is not copied across', () => {
  // Copying it would build a key of `unknown|backend developer`, and the next
  // unnamed Backend Developer would merge into it. A false merge hides a live
  // vacancy and says nothing; an empty company costs a row somebody reads.
  const row = read('tm:262441');
  assert.equal(row.company, null);
  assert.equal(row.company_from, null);
  assert.equal(row.dup_key, null);
});

test('running the backfill again changes nothing', async () => {
  const before = read('tm:266351');
  const again = await import(`../store.mjs?reimport=${Date.now()}`);
  assert.equal(again.stats().total, store.stats().total);
  assert.deepEqual({ ...read('tm:266351') }, { ...before });
});

test('a fresh posting is resolved as it is stored, not only in a backfill', () => {
  const donor = { ...job({ id: '26100178', source: 'af', company: 'DeltaCo',
                           title: 'Senior Software Engineer, Crypto',
                           url: 'https://talent-move.ru/jobs/senior-swe-crypto-030926-266713/' }) };
  assert.equal(store.filterFresh([donor]).length, 1);

  const [stored] = store.filterFresh([job({
    id: 'tm:266713', title: 'Senior Software Engineer для крипто-платформы',
    url: 'https://talent-move.ru/jobs/senior-swe-crypto-030926-266713/',
  })]);
  assert.equal(stored.company, 'DeltaCo');
  assert.equal(stored.companyFrom, '26100178');
  assert.equal(read('tm:266713').company_from, '26100178');
});

test('and the caller keeps the job it passed in, underived', () => {
  // The verdict comes from the store, so it belongs on a copy: the same job
  // object may be handed to another slice that has not stored the donor.
  const incoming = job({ id: 'tm:266714',
                         url: 'https://talent-move.ru/jobs/senior-swe-crypto-030926-266713/' });
  store.filterFresh([incoming]);
  assert.equal(incoming.company, null);
});

test('with the name recovered, the cross-board duplicate is finally caught', () => {
  // Half the value of a second adapter: without the name there is no key, and
  // without a key the same posting is stored twice under two board ids.
  const url = 'https://talent-move.ru/jobs/staff-backend-260826-264076/';
  store.filterFresh([job({ id: '25887355', source: 'af', company: 'SigmaCo',
                           title: 'Staff Software Engineer, Backend', url })]);
  const fresh = store.filterFresh([job({ id: 'tm:264076', url,
                                         title: 'Staff Software Engineer, Backend' })]);
  assert.equal(fresh.length, 0, 'the TalentMove copy is the AgileFluent posting');
  assert.deepEqual(fresh.skipped.merged, [{ id: 'tm:264076', into: '25887355' }],
                   'the merge is reported, not silent');
});

test('the id has to sit at the tail of the url, not merely inside it', () => {
  // `%-266351%` in SQL also matches a url with the id in the middle, which is a
  // different posting. A false donor is a false employer on a live vacancy.
  store.filterFresh([job({ id: '25000900', source: 'af', company: 'WrongCo',
                           title: 'Backend Engineer',
                           url: 'https://talent-move.ru/jobs/backend-999111-and-more-777222/' })]);
  assert.equal(store.resolveCompany({ id: 'tm:999111', source: 'tm' }), null);
});

test('a board that does not publish the other board id resolves to nothing', () => {
  assert.equal(store.resolveCompany({ id: 'tm:123456789', source: 'tm' }), null);
  // Too short to be an id: a url ending in `-2` would otherwise donate a name.
  assert.equal(store.resolveCompany({ id: 'w3:12', source: 'w3' }), null);
});

test('only another source lends a name', () => {
  // A board does not republish itself, so a same-board url ending in another
  // row's id is a coincidence of the slug rather than the same posting.
  store.filterFresh([job({ id: 'tm:500100', company: 'SameBoardCo',
                           title: 'Backend Engineer',
                           url: 'https://talent-move.ru/jobs/backend-engineer-010926-500200/' })]);
  assert.equal(store.resolveCompany({ id: 'tm:500200', source: 'tm' }), null);
  assert.deepEqual(store.resolveCompany({ id: 'w3:500200', source: 'w3' }),
                   { company: 'SameBoardCo', from: 'tm:500100' },
                   'the same row does lend to a different board');
});

test('the tail id is read the same way the board writes it', () => {
  assert.equal(store.trailingId(TM_URL), '266351');
  assert.equal(store.trailingId(TM_URL.replace(/\/$/, '')), '266351');
  assert.equal(store.trailingId('https://example.invalid/job/Backend_JR14836-2'), null);
  assert.equal(store.trailingId(null), null);
});
