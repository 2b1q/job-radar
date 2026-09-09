// career.habr.com: the record, and the two fields it is honest about -
// `applyAtEmployer: false` (the card links to the board, never to the employer)
// and a salary with no period, which keeps it out of `salaryMinUsd`.
//
// No network. The fixture is the API's own shape with invented companies and ids.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { QUALIFICATIONS, normalize, search } from '../adapters/habrcareer.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const envelope = JSON.parse(readFileSync(join(HERE, 'fixtures/hc-vacancies.json'), 'utf8'));
const jobs = envelope.list.map(normalize);
const byId = (id) => jobs.find((j) => j.id === id);

test('ids are namespaced to the board', () => {
  for (const j of jobs) assert.match(j.id, /^hc:\d+$/);
  assert.equal(new Set(jobs.map((j) => j.id)).size, jobs.length);
});

test('the shape matches the other adapters exactly', () => {
  const shape = ['id', 'source', 'company', 'title', 'url', 'applyAtEmployer', 'country',
                 'locationVerified', 'format', 'salaryLabel', 'salaryMinUsd', 'skills',
                 'hasRussianRoots', 'visa', 'date'];
  for (const key of shape) assert.ok(key in jobs[0], `missing ${key}`);
  assert.equal(jobs[0].source, 'hc');
});

test('no record here reaches the employer, and every record says so', () => {
  // The criterion this source is judged on, and it fails it. Saying so is the point.
  for (const j of jobs) {
    assert.equal(j.applyAtEmployer, false);
    assert.match(j.url, /^https:\/\/career\.habr\.com\/vacancies\/\d+$/);
  }
});

test('skills come out filled, which is why this board is worth parsing', () => {
  assert.deepEqual(byId('hc:1000000001').skills, ['Node.js', 'PostgreSQL']);
  assert.deepEqual(byId('hc:1000000002').skills, [], 'and an empty list stays empty');
});

test('a salary with no period stays in the label and out of the USD field', () => {
  const paid = byId('hc:1000000001');
  assert.equal(paid.salaryLabel, '250 000 – 350 000 ₽');
  assert.equal(paid.salaryMinUsd, null, 'the record states an amount and no period');
  assert.equal(byId('hc:1000000002').salaryLabel, 'not stated');
});

test('the place is the board word for it, and nobody checked it', () => {
  assert.equal(byId('hc:1000000001').country, 'Москва', 'from the list the card shows');
  assert.equal(byId('hc:1000000002').country, 'Рига', 'and from the single older field');
  for (const j of jobs) assert.equal(j.locationVerified, false);
});

test('the one boolean the board states about the arrangement is copied, not read into', () => {
  assert.equal(byId('hc:1000000001').format, 'remote');
  assert.equal(byId('hc:1000000002').format, 'not remote');
});

test('the qualification ids are the board own, gap included', () => {
  // From the board's own filter schema. The missing 2 is the board's, not a typo.
  assert.deepEqual(QUALIFICATIONS, { intern: 1, junior: 3, middle: 4, senior: 5, lead: 6 });
});

// The page loop: `found` against `collected` is what tells a narrowed query
// from an empty market, and it only exists in `search`.
const stub = (pages, { totalResults = 57, totalPages = 3 } = {}) => {
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    const page = Number(new URL(url).searchParams.get('page'));
    if (page > totalPages) return { ok: false, status: 404, json: async () => ({}) };
    return {
      ok: true, status: 200,
      json: async () => ({ list: pages[page - 1] ?? [], meta: { totalResults, perPage: 25, currentPage: page, totalPages } }),
    };
  };
  return urls;
};

test('the board own total travels beside what was collected', async () => {
  stub([envelope.list]);
  const out = await search({}, 1);
  assert.equal(out.found, 57);
  assert.equal(out.length, 2);
  assert.equal(out.complete, false, 'two of fifty-seven is a lower bound and says so');
});

test('a walk that reaches the total is complete', async () => {
  stub([envelope.list], { totalResults: 2, totalPages: 1 });
  const out = await search({}, 3);
  assert.equal(out.complete, true);
});

// A second page the board would really send: different ids, same shape.
const nextPage = envelope.list.map((job) => ({ ...job, id: job.id + 500 }));

test('the walk stops at the board last page rather than asking past it', async () => {
  // Past its last page this board answers 404, so the loop honours meta.totalPages.
  const urls = stub([envelope.list, nextPage], { totalResults: 50, totalPages: 2 });
  await search({}, 9);
  assert.deepEqual(urls.map((u) => new URL(u).searchParams.get('page')), ['1', '2']);
});

test('a repeated page is an error, not a quiet duplicate', async () => {
  // The board answering page 2 with page 1 again, which nothing in the data says.
  stub([envelope.list, envelope.list], { totalResults: 50, totalPages: 3 });
  await assert.rejects(() => search({}, 2), /repeats a page already fetched/);
});

test('results promised and nothing parsed is an error, not an empty day', async () => {
  stub([[]], { totalResults: 57, totalPages: 3 });
  await assert.rejects(() => search({}, 1), /reports results but nothing parsed/);
});

test('an answer without the list/meta pair is refused', async () => {
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ vacancies: [] }) });
  await assert.rejects(() => search({}, 1), /no list\/meta pair/);
});

test('the parameters the board silently ignores are not sent by accident', async () => {
  const urls = stub([envelope.list], { totalResults: 2, totalPages: 1 });
  await search({ query: 'node.js', qids: [4, 5], skills: ['264'], remote: true }, 1);
  const params = new URL(urls[0]).searchParams;
  assert.equal(params.get('q'), 'node.js');
  assert.equal(params.get('remote'), 'true');
  assert.deepEqual(params.getAll('qid[]'), ['4', '5']);
  assert.deepEqual(params.getAll('skills[]'), ['264']);
  assert.equal(params.get('type'), 'all', 'the anonymous listing, not the personalised one');
});

test('an empty query is left out rather than sent empty', async () => {
  const urls = stub([envelope.list], { totalResults: 2, totalPages: 1 });
  await search({ query: '' }, 1);
  assert.equal(new URL(urls[0]).searchParams.has('q'), false);
});
