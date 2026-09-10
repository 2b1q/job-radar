// Cross-board dedup, on a throwaway database.
//
// Boards mint their own ids, so the same Greenhouse posting arrives as a bare
// number from AgileFluent and as `tm:...` from TalentMove. Deduplicating by id
// alone let it through twice - and the second copy came back as "new" while the
// first already carried `applied`, which is the failure mode this repo keeps
// finding: not an error, just a quietly wrong answer.
//
// No network. The store is imported after JOBS_DB_PATH is set, because it opens
// its database at import time.

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

const DB = join(mkdtempSync(join(tmpdir(), 'jobs-test-')), 'jobs.db');

// A store as it looked before the second source existed: no `source`, no
// `skills`, no `dup_key`, and rows carrying hand-set statuses. Importing the
// module has to migrate this in place without losing any of it.
{
  const db = new DatabaseSync(DB);
  db.exec(`CREATE TABLE jobs (
    id TEXT PRIMARY KEY, company TEXT, title TEXT, url TEXT, country TEXT,
    salary_label TEXT, first_seen TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new',
    note TEXT);
   CREATE TABLE runs (ts TEXT NOT NULL, preset TEXT, since TEXT, found INTEGER, fresh INTEGER);`);
  const ins = db.prepare(
    'INSERT INTO jobs (id, company, title, first_seen, status) VALUES (?, ?, ?, ?, ?)');
  ins.run('26043677', 'GammaCo', 'Lead/Senior Backend Developer, TypeScript/Node.js',
          '2026-09-03T00:00:00.000Z', 'applied');
  ins.run('25000001', 'ExampleCo', 'Backend Engineer', '2026-09-01T00:00:00.000Z', 'rejected');
  ins.run('25000002', 'OtherCo', 'Data Analyst', '2026-09-01T00:00:00.000Z', 'new');
  db.close();
}

process.env.JOBS_DB_PATH = DB;
const store = await import('../store.mjs');

const job = (over) => ({
  id: 'x', source: 'tm', company: 'C', title: 'T', url: 'https://example.invalid/1',
  country: null, salaryLabel: 'not stated', skills: [], ...over,
});

test('migration keeps every row and every status', () => {
  const st = store.stats();
  assert.equal(st.total, 3);
  const byStatus = Object.fromEntries(st.byStatus.map((r) => [r.status, r.n]));
  assert.equal(byStatus.applied, 1);
  assert.equal(byStatus.rejected, 1);
  assert.equal(byStatus.new, 1);
  // Rows written before there was a second source are AgileFluent by definition.
  // Compared field by field: node:sqlite hands back null-prototype rows, and a
  // deep-equal against an object literal fails on the prototype rather than on
  // anything that matters.
  assert.equal(st.bySource.length, 1);
  assert.equal(st.bySource[0].source, 'af');
  assert.equal(st.bySource[0].n, 3);
});

test('the same posting under the other board id is not fresh', () => {
  const fresh = store.filterFresh([job({
    id: 'tm:266351', company: 'GammaCo',
    title: 'Lead/Senior Backend Developer, TypeScript/Node.js',
  })]);
  assert.equal(fresh.length, 0, 'the tm copy of an af posting must not come back');
  assert.deepEqual(fresh.skipped.merged, [{ id: 'tm:266351', into: '26043677' }],
                   'and the answer says which row it merged into');
});

test('and the status somebody set by hand is left alone', () => {
  // The whole point: the first row may carry `applied`. Skipping must not touch
  // it, and must not replace it with a new row.
  const db = new DatabaseSync(DB);
  const row = db.prepare('SELECT status FROM jobs WHERE id = ?').get('26043677');
  const copies = db.prepare('SELECT COUNT(*) n FROM jobs WHERE id = ?').get('tm:266351');
  db.close();
  assert.equal(row.status, 'applied');
  assert.equal(copies.n, 0, 'the duplicate was not inserted either');
});

test('punctuation and case do not decide identity', () => {
  const fresh = store.filterFresh([job({
    id: 'tm:999001', company: '  gammaco ',
    title: 'Lead / Senior  Backend Developer,  TypeScript/Node.js',
  })]);
  assert.equal(fresh.length, 0, 'normalisation is what makes the two ids meet');
});

test('same title at different companies stays two vacancies', () => {
  const fresh = store.filterFresh([
    job({ id: 'tm:100', company: 'AlphaCo', title: 'Backend Engineer' }),
    job({ id: 'tm:101', company: 'BetaCo', title: 'Backend Engineer' }),
  ]);
  assert.equal(fresh.length, 2);
});

test('a title alone never merges anything', () => {
  // TalentMove leaves company null often. Keying on the title by itself would
  // collapse every "Backend Developer" on the board into one row - a false merge
  // hides a live vacancy in silence, which costs more than a duplicate row.
  const fresh = store.filterFresh([
    job({ id: 'tm:200', company: null, title: 'Backend Developer' }),
    job({ id: 'tm:201', company: null, title: 'Backend Developer' }),
    job({ id: 'tm:202', company: '', title: 'Backend Developer' }),
  ]);
  assert.equal(fresh.length, 3, 'no company, no key - id is the only guard');
});

test('an exact id repeat is still caught', () => {
  const again = store.filterFresh([job({ id: 'tm:100', company: 'AlphaCo',
                                         title: 'Backend Engineer' })]);
  assert.equal(again.length, 0);
  assert.equal(again.skipped.seen, 1, 'the same id again, not another board');
});

test('dupKey is exact, not fuzzy', () => {
  const a = store.dupKey('GammaCo', 'Lead/Senior Backend Developer');
  assert.equal(a, store.dupKey(' GAMMACO ', 'Lead / Senior  Backend, Developer'));
  assert.notEqual(a, store.dupKey('GammaCo', 'Senior Backend Developer'),
                  'a different title is a different posting, not a near match');
  assert.notEqual(a, store.dupKey('GammaCo Labs', 'Lead/Senior Backend Developer'),
                  'a different company is a different posting');
});

test('dupKey refuses to key on half a pair', () => {
  assert.equal(store.dupKey(null, 'Backend Engineer'), null);
  assert.equal(store.dupKey('', 'Backend Engineer'), null);
  assert.equal(store.dupKey('AlphaCo', ''), null);
  assert.equal(store.dupKey('   ', 'Backend Engineer'), null);
});

test('running the migration again changes nothing', async () => {
  // Idempotence is what makes it safe to import the module on every start.
  const before = store.stats();
  const again = await import(`../store.mjs?reimport=${Date.now()}`);
  assert.deepEqual(again.stats().total, before.total);
});

test('an HTML entity does not split one posting into two', () => {
  // Found in a live store, not in review: one posting sat there twice because
  // one board left "&amp;" in the title and the other did not, so the keys read
  // "...backend blockchain" and "...backend amp blockchain".
  assert.equal(store.dupKey('ExampleCo', 'Backend & Blockchain'),
               store.dupKey('ExampleCo', 'Backend &amp; Blockchain'));
  assert.equal(store.dupKey('A&B Corp', 'Engineer'),
               store.dupKey('A&amp;B Corp', 'Engineer'));
});

test('an entity-bearing duplicate is caught at insert', () => {
  store.filterFresh([job({ id: 'tm:700', company: 'EntityCo', title: 'Backend & Data' })]);
  const again = store.filterFresh([
    job({ id: 'w3:700', company: 'EntityCo', title: 'Backend &amp; Data' }),
  ]);
  assert.equal(again.length, 0, 'the escaped copy is the same posting');
});

test('a leading space is not a different company', () => {
  // Measured rather than read off `normKey`: TalentMove hands the store
  // " DeltaCo" for what another board calls "DeltaCo" - the employer is rendered
  // as `@<a>DeltaCo</a>` and stripping the tag leaves a space behind the `@`. Whether
  // that splits one posting into two is decided here, in the key itself, and
  // nowhere else.
  assert.equal(store.dupKey(' DeltaCo', 'Backend Developer'),
               store.dupKey('DeltaCo', 'Backend Developer'));
  assert.equal(store.dupKey(' Sigma Labs', 'Backend Developer'),
               store.dupKey('Sigma Labs', 'Backend Developer'));
});

test('and the two copies meet at insert, not only in the key', () => {
  store.filterFresh([job({ id: 'tm:800', company: ' DeltaCo', title: 'Backend Developer' })]);
  assert.equal(store.filterFresh([
    job({ id: 'w3:800', company: 'DeltaCo', title: 'Backend Developer' }),
  ]).length, 0, 'the space never reached the comparison');
});

// One board writes a template tail into its titles that no other board uses.
test('a template tail does not keep one posting from meeting its twin', () => {
  const board = {
    id: 'w3:770001', source: 'w3', company: 'GammaCo', title: 'Senior Backend Engineer',
    url: 'https://web3.career/1', country: 'Remote', salaryLabel: 'not stated', skills: [],
  };
  assert.equal(store.filterFresh([board]).length, 1);

  const withTail = {
    ...board, id: 'tm:770002', source: 'tm',
    title: 'Senior Backend Engineer для Fintech', url: 'https://talent-move.ru/2',
  };
  const second = store.filterFresh([withTail]);
  assert.equal(second.length, 0, 'the tail is the only difference, and it is one board habit');
  assert.equal(second.skipped.merged[0].into, 'w3:770001');
});

test('but it never merges two postings from the same board', () => {
  // Measured before this was written: cutting the tail out of the key itself
  // bought zero cross-board matches and merged two postings from ONE board,
  // which is the trade this store refuses.
  const one = {
    id: '880001', source: 'af', company: 'DeltaCo', title: 'Senior Backend Developer',
    url: 'https://example.invalid/1', country: 'Remote', salaryLabel: 'not stated', skills: [],
  };
  const two = { ...one, id: '880002', title: 'Senior Backend Developer для Billing' };
  assert.equal(store.filterFresh([one]).length, 1);
  assert.equal(store.filterFresh([two]).length, 1, 'same board, so both stay');
});

test('and a tail that leaves too little is not cut at all', () => {
  const short = {
    id: 'tm:880003', source: 'tm', company: 'EpsilonCo', title: 'Разработчик для Fintech',
    url: 'https://talent-move.ru/3', country: 'Remote', salaryLabel: 'not stated', skills: [],
  };
  const other = { ...short, id: 'w3:880004', source: 'w3', title: 'Разработчик' };
  assert.equal(store.filterFresh([other]).length, 1);
  assert.equal(store.filterFresh([short]).length, 1,
               'cutting to two words would take every posting at that company with it');
});
