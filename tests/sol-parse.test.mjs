// jobs.solana.com: the record, and the one field the source exists for.
//
// This board is here because its `url` is the employer's own application - Ashby,
// Greenhouse, Lever, Gem - rather than a link back to itself. That is not true of
// every record: for some the board hosts the form on its own domain, and an
// application through it still reaches the employer. The two are different
// things, so `applyAtEmployer` has to tell them apart, and a caller must never
// have to click to find out.
//
// Money is the second care. The field is called salaryMinUsd, so a figure
// enters it only when the board says USD a year; euros and an undefined period
// stay in the label, where their conditions travel with them.
//
// No network: the fixture is the API's own shape, and `search` is driven with a
// stubbed fetch.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { leadsToEmployer, money, normalize, search } from '../adapters/solana.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const envelope = JSON.parse(readFileSync(join(HERE, 'fixtures/sol-search.json'), 'utf8'));
const raw = envelope.results.jobs;
const jobs = raw.map(normalize);
const byId = (id) => jobs.find((j) => j.id === id);

test('ids are namespaced to the board', () => {
  for (const j of jobs) assert.match(j.id, /^sol:\d+$/);
  assert.equal(new Set(jobs.map((j) => j.id)).size, jobs.length);
});

test('the shape matches the other adapters exactly', () => {
  const shape = ['id', 'source', 'company', 'title', 'url', 'country', 'format',
                 'salaryLabel', 'salaryMinUsd', 'skills', 'hasRussianRoots', 'visa', 'date'];
  for (const key of shape) assert.ok(key in jobs[0], `missing ${key}`);
  assert.equal(jobs[0].source, 'sol');
});

test('a link to the employer own system is marked as one', () => {
  assert.equal(byId('sol:90000001').applyAtEmployer, true, 'an ATS link leaves the board');
  assert.equal(byId('sol:90000003').applyAtEmployer, true);
  assert.equal(byId('sol:90000004').applyAtEmployer, true);
});

test('a link back to the board is marked as one, and still kept', () => {
  // The board hosts the form itself for some postings. That application does
  // reach the employer, so the url is worth having - it is simply not the
  // employer's own system, and substituting the board's page for the missing
  // outbound link without saying so is what this field exists to prevent.
  const boardHosted = byId('sol:90000002');
  assert.equal(boardHosted.applyAtEmployer, false);
  assert.match(boardHosted.url, /^https:\/\/jobs\.solana\.com\//);
});

test('the flag is decided by the url, not by anything correlated with it', () => {
  // In one 60-record sample every board-hosted link also had source
  // "admin_portal". One sample is not a rule here - it has failed three times -
  // so the host is what decides, and swapping the source field changes nothing.
  const disguised = normalize({ ...raw[1], source: 'career_page' });
  assert.equal(disguised.applyAtEmployer, false);
  const other = normalize({ ...raw[0], source: 'admin_portal' });
  assert.equal(other.applyAtEmployer, true);
});

test('a url that cannot be read is not a claim about the employer', () => {
  assert.equal(leadsToEmployer('not a url'), false);
  assert.equal(leadsToEmployer(null), false);
  assert.equal(leadsToEmployer(''), false);
  assert.equal(normalize({ ...raw[0], url: null }).applyAtEmployer, false);
});

test('the board host is matched exactly, not by substring', () => {
  // `jobs.solana.com.example.invalid` is somebody else's domain, and reading it
  // as the board would hide a real outbound link behind the wrong flag.
  assert.equal(leadsToEmployer('https://jobs.solana.com.example.invalid/x'), true);
  assert.equal(leadsToEmployer('https://jobs.solana.com/companies/a/jobs/1'), false);
});

test('USD a year is the only thing the USD field holds', () => {
  assert.equal(byId('sol:90000001').salaryMinUsd, 200000, 'cents become dollars');
  assert.match(byId('sol:90000001').salaryLabel, /^200K-250K USD\/year$/);
});

test('euros stay in the label and out of the field', () => {
  const eur = byId('sol:90000002');
  assert.equal(eur.salaryMinUsd, null);
  assert.match(eur.salaryLabel, /90K-120K EUR\/year/);
});

test('a figure with no period is not comparable and does not enter the field', () => {
  // The field is read against annual figures from two other boards. A number
  // whose period the board did not state is the "number without its conditions"
  // this repository refuses to store - and the label says so out loud.
  const undefinedPeriod = byId('sol:90000004');
  assert.equal(undefinedPeriod.salaryMinUsd, null);
  assert.match(undefinedPeriod.salaryLabel, /180K-180K USD\/period not stated/);
});

test('no compensation says so rather than inventing one', () => {
  assert.equal(byId('sol:90000003').salaryLabel, 'not stated');
  assert.equal(byId('sol:90000003').salaryMinUsd, null);
});

test('money is read out of the fields, not out of the label', () => {
  assert.deepEqual(money({ compensation_amount_min_cents: 12345600, compensation_currency: 'USD',
                           compensation_period: 'year' }),
                   { label: '123K-123K USD/year', usd: 123456 });
  assert.deepEqual(money({}), { label: 'not stated', usd: null });
});

test('what the board says about place is copied and marked unverified', () => {
  // Measured three times on other boards: `remote` that was an office five days
  // a week, `Remote` that was a hybrid abroad, a country code against a posting
  // whose own text said "over 25 countries". The board's claim is stored; the
  // claim that it is true is not.
  assert.equal(byId('sol:90000001').country, 'New York, NY, USA');
  assert.equal(byId('sol:90000001').format, 'remote');
  for (const j of jobs) assert.equal(j.locationVerified, false);
});

test('an empty location is null, not an empty string', () => {
  assert.equal(byId('sol:90000003').country, null);
  assert.equal(byId('sol:90000003').format, null, 'no work mode is not a work mode');
});

test('the posting date comes off the epoch the board sends', () => {
  assert.equal(byId('sol:90000001').date, '2026-09-06', 'epoch 1788695145 in UTC');
  assert.equal(normalize({ ...raw[0], created_at: null }).date, null);
});

test('skills come through, and an empty list stays a list', () => {
  assert.deepEqual(byId('sol:90000001').skills, ['Rust', 'Distributed Systems']);
  assert.deepEqual(byId('sol:90000003').skills, []);
});

// --- the page loop, with the network stubbed ------------------------------

/** One response per call, in the API's envelope. */
function stub(pages, { count = null } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const jobsOnPage = pages[body.page] ?? [];
    return {
      ok: true,
      status: 200,
      json: async () => ({ results: { count: count ?? pages.flat().length, jobs: jobsOnPage } }),
    };
  };
  return calls;
}

const record = (id) => ({ ...raw[0], id, slug: `${id}-x`, title: `Title ${id}` });

test('pages accumulate, and the page number is what changes', async () => {
  const calls = stub([[record(1), record(2)], [record(3)]]);
  const jobs = await search({}, 2);
  assert.deepEqual(jobs.map((j) => j.id), ['sol:1', 'sol:2', 'sol:3']);
  assert.equal(calls[0].page, 0, 'the board counts pages from zero');
  assert.equal(calls[1].page, 1);
});

test('the walk stops at the total the board reports', async () => {
  // The count is what says the walk finished, so a third request is waste.
  const calls = stub([[record(1), record(2)], [record(3)]], { count: 3 });
  const jobs = await search({}, 5);
  assert.equal(jobs.length, 3);
  assert.equal(calls.length, 2);
  assert.equal(jobs.complete, true);
});

test('a page past the end is an ordinary end of results', async () => {
  const jobs = await stub([[record(1)], []], { count: 1 }) && await search({}, 3);
  assert.equal(jobs.length, 1);
});

test('a short answer says it is short', async () => {
  // Stopping at the page budget is not "that is all there is", and `found`
  // against `collected` is the only thing that tells them apart.
  stub([[record(1)], [record(2)]], { count: 99 });
  const jobs = await search({}, 2);
  assert.equal(jobs.found, 99);
  assert.equal(jobs.complete, false);
});

test('a repeated page is an error, not a quiet duplicate', async () => {
  // Teeth: the board answers, but paging is ignored and page 1 is page 0 again.
  const same = [record(1), record(2)];
  stub([same, same], { count: 99 });
  await assert.rejects(() => search({}, 2), /repeats a page already fetched/);
});

test('results promised and none parsed is an error, not an empty board', async () => {
  stub([[]], { count: 411 });
  await assert.rejects(() => search({}, 1), /nothing parsed/);
});

test('a genuinely empty search is empty, not an error', async () => {
  stub([[]], { count: 0 });
  assert.deepEqual([...await search({ query: 'nothing matches this' }, 1)], []);
});

test('a renamed envelope is an error, not zero jobs', async () => {
  // The whole answer is the API's contract; if `results.jobs` moves, every run
  // reads as a quiet day. Broken here the way a rename would break it.
  globalThis.fetch = async () => ({ ok: true, status: 200,
                                    json: async () => ({ results: { count: 411, items: [] } }) });
  await assert.rejects(() => search({}, 1), /no results\.jobs array/);
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) });
  await assert.rejects(() => search({}, 1), /no results\.jobs array/);
});

test('a refused filter value carries the board own sentence', async () => {
  // The API names what it would have accepted. Ours would be a worse guess.
  globalThis.fetch = async () => ({
    ok: false, status: 422,
    text: async () => '{"error":["filters: [:work_mode, ["Only on_site and remote are allowed as work mode options"]]"]}',
  });
  await assert.rejects(() => search({ workMode: 'telepathic' }, 1),
                       /Only on_site and remote are allowed/);
});

test('a request that forgot to ask for JSON is named, not counted as a failure', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 406, text: async () => '' });
  await assert.rejects(() => search({}, 1), /406.*asks for JSON/s);
});

test('the work mode filter is sent the way the board spells it', async () => {
  const calls = stub([[record(1)]], { count: 1 });
  await search({ workMode: 'remote', query: 'rust' }, 1);
  assert.deepEqual(calls[0].filters, { work_mode: ['remote'] });
  assert.equal(calls[0].query, 'rust');
  const plain = stub([[record(1)]], { count: 1 });
  await search({}, 1);
  assert.deepEqual(plain[0].filters, {}, 'no work mode is no filter, not an empty one');
});
