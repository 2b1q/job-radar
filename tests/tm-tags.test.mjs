// Intersecting on tags, which the board cannot do.
//
// `skills` in the query is a union: adding a term widens the result. So "Node AND
// AI" is not expressible as a request at all - it has to be anchored by category,
// narrowed by language in the query, and intersected here.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { filterByTags, pickSlug, intersectById } from '../adapters/talentmove.mjs';

const job = (id, skills) => ({ id: `tm:${id}`, skills });

const jobs = [
  job(1, ['Node.js', 'AI', 'Backend']),
  job(2, ['Node.js', 'PostgreSQL']),
  job(3, ['TypeScript', 'LLM']),
  job(4, ['Airflow', 'Python']),
  job(5, []),
  job(6, ['Микросервисы', 'Kafka']),
];

test('a card passes if any wanted tag is on it', () => {
  const got = filterByTags(jobs, ['AI', 'LLM', 'ML']);
  assert.deepEqual(got.map((j) => j.id), ['tm:1', 'tm:3']);
});

test('an empty requirement changes nothing', () => {
  assert.equal(filterByTags(jobs, []).length, jobs.length);
  assert.equal(filterByTags(jobs).length, jobs.length);
});

test('matching is exact, not substring', () => {
  // "ai" inside "Airflow" is the obvious trap, and a fuzzy match would put a
  // data-engineering job in an AI shortlist without saying so.
  const got = filterByTags(jobs, ['AI']);
  assert.deepEqual(got.map((j) => j.id), ['tm:1']);
  assert.ok(!got.some((j) => j.id === 'tm:4'), 'Airflow is not AI');
});

test('slug or label, either is accepted', () => {
  // The query vocabulary is slugs, the card vocabulary is labels; a caller
  // holding one should not have to convert to the other.
  assert.deepEqual(filterByTags(jobs, ['node-js']).map((j) => j.id), ['tm:1', 'tm:2']);
  assert.deepEqual(filterByTags(jobs, ['Node.js']).map((j) => j.id), ['tm:1', 'tm:2']);
});

test('case and punctuation do not decide', () => {
  assert.equal(filterByTags(jobs, ['микросервисы']).length, 1);
  assert.equal(filterByTags(jobs, ['МИКРОСЕРВИСЫ']).length, 1);
});

test('a card with no tags never matches a requirement', () => {
  assert.ok(!filterByTags(jobs, ['AI']).some((j) => j.id === 'tm:5'));
});

// Slug resolution, which is what lets the board do the narrowing.
//
// The endpoint answers a prefix search: asking for "Go" brings back Golang,
// Google Ads and Governance, in that order and ahead of nothing. Taking the
// first result would filter on a skill nobody asked for and return a plausible
// list - the failure this board specialises in.
test('a slug is taken by exact label, never by best guess', () => {
  const results = [
    { value: 'golang', label: 'Golang (10)' },
    { value: 'google-ads', label: 'Google Ads (6)' },
    { value: 'go', label: 'Go (23)' },
  ];
  assert.equal(pickSlug(results, 'Go'), 'go');
  assert.equal(pickSlug(results, 'Golang'), 'golang');
});

test('a label the board does not know resolves to nothing, not to a neighbour', () => {
  const results = [{ value: 'kubernetes', label: 'Kubernetes (18)' }];
  assert.equal(pickSlug(results, 'Kuber'), null);
  assert.equal(pickSlug(results, 'K8s'), null);
  assert.equal(pickSlug([], 'Kubernetes'), null);
});

// The count suffix is presentation, and it changes as postings come and go.
test('the count in a label is not part of the label', () => {
  assert.equal(pickSlug([{ value: 'kafka', label: 'Kafka (2)' }], 'kafka'), 'kafka');
});

// The intersection of two board-side queries, which is how "Node AND AI" is
// expressed on a board whose own `skills` parameter can only union.
const side = (ids, { found = ids.length, slugs = ['x'], labels = [], tags = {} } = {}) => ({
  labels, slugs, unresolved: [],
  jobs: ids.map((id) => ({ id, skills: tags[id] || [] })),
  found, collected: ids.length, complete: ids.length >= found,
});

test('only ids present on every side survive', () => {
  const r = intersectById([side(['a', 'b', 'c']), side(['b', 'c', 'd'])]);
  assert.deepEqual(r.map((j) => j.id), ['b', 'c']);
  assert.equal(r.complete, true);
});

// A side that was paged short makes the intersection a lower bound. Reporting it
// as a count is how "we stopped reading" gets read as "the niche is empty" - the
// mistake this project has already made once, on a category.
test('a side paged short makes the whole answer incomplete', () => {
  const r = intersectById([side(['a', 'b'], { found: 40 }), side(['b'])]);
  assert.deepEqual(r.map((j) => j.id), ['b']);
  assert.equal(r.complete, false);
  assert.equal(r.sides[0].found, 40);
  assert.equal(r.sides[0].collected, 2);
});

test('an empty side empties the intersection, and says which side it was', () => {
  const r = intersectById([side(['a', 'b']), side([], { slugs: ['ai'] })]);
  assert.equal(r.length, 0);
  assert.deepEqual(r.sides[1].slugs, ['ai']);
});

// The board's `skills` reads one taxonomy and the card shows two: the first tag
// on a card is an industry, and no skills query matches it. Measured: a posting
// tagged with the AI industry was absent from a complete `skills=ai,llm,ml`
// answer and printed AI on its own card.
test('a card tag admits a posting the board-side query cannot see', () => {
  const lang = side(['a', 'b'], { tags: { b: ['AI', 'CLI'] } });
  const group = side([], { labels: ['AI', 'LLM'], slugs: ['ai', 'llm'] });
  assert.deepEqual(intersectById([lang, group]).map((j) => j.id), ['b']);
});

// And the card route stays exact: a card is trusted for what it says, not for
// what it resembles.
test('the card route matches whole tags, not substrings', () => {
  const lang = side(['a'], { tags: { a: ['Airflow'] } });
  const group = side([], { labels: ['AI'], slugs: ['ai'] });
  assert.equal(intersectById([lang, group]).length, 0);
});
