// web3.career parsing, on a fixture. No network.
//
// The board's structured data and its markup disagree in two ways that matter,
// and both are pinned here rather than trusted:
//   - the rendered title is mangled ("Platm" for "Platform"), so the structured
//     title is authoritative and the rendered one only checks alignment
//   - the JSON-LD carries no id and no url, so postings and rows are paired by
//     order - which is exactly the kind of assumption that fails silently
//
// The fixture is SYNTHETIC and says so in its first line: real shape, invented
// content. Tests ship with the code, so a fixture is as public as the code.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { pair, parseListing, parsePostings, parseRows } from '../adapters/web3career.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, 'fixtures/w3-listing.html'), 'utf8');
const jobs = parseListing(html);

test('every row becomes a job, and every job has its structured half', () => {
  assert.equal(parseRows(html).length, parsePostings(html).length);
  assert.equal(jobs.length, 3);
});

test('ids are namespaced to the board', () => {
  for (const j of jobs) assert.match(j.id, /^w3:\d+$/);
  assert.equal(new Set(jobs.map((j) => j.id)).size, jobs.length);
});

test('the shape matches the other adapters exactly', () => {
  // The store and the tools are shared; an extra or missing field here means
  // touching them, which is the thing the common shape exists to avoid.
  const expected = ['id', 'source', 'company', 'title', 'url', 'country', 'format',
                    'salaryLabel', 'salaryMinUsd', 'salaryEstimated', 'skills',
                    'hasRussianRoots', 'visa', 'date'];
  assert.deepEqual(Object.keys(jobs[0]).sort(), [...expected].sort());
});

test('the structured title wins over the mangled one', () => {
  // The board renders "Platm Engineer Core Systems". Publishing that would put a
  // typo in every shortlist and break the dedup key against other boards.
  assert.equal(jobs[0].title, 'Platform Engineer, Core Systems');
});

test('an estimate is labelled as one', () => {
  assert.match(jobs[0].salaryLabel, /from posting/);
  assert.match(jobs[1].salaryLabel, /site estimate/);
  assert.equal(jobs[1].salaryEstimated, true);
});

test('salary comes out in USD, unconverted', () => {
  assert.equal(jobs[0].salaryMinUsd, 200000);
  assert.match(jobs[0].salaryLabel, /^200K-260K USD/);
});

test('location prefers the row and falls back to the structured address', () => {
  assert.equal(jobs[0].country, 'New York');
  assert.equal(jobs[2].country, 'Berlin');
});

test('tags come from the row, which is the only place they exist', () => {
  assert.deepEqual(jobs[0].skills, ['engineer', 'blockchain']);
  assert.deepEqual(jobs[2].skills, ['frontend', 'react']);
});

test('urls are absolute', () => {
  for (const j of jobs) assert.match(j.url, /^https:\/\/web3\.career\//);
});


// --- the guards -------------------------------------------------------------

const posting = (title) => ({ '@type': 'JobPosting', title, hiringOrganization: { name: 'X' } });
const row = (id, title) => ({ id, url: `/x/${id}`, title, company: 'X', tags: [],
                              salaryEstimated: false, salaryText: '' });

test('a mismatch in list lengths is refused, not truncated', () => {
  assert.throws(() => pair([posting('A'), posting('B')], [row('1', 'A')]),
                /no longer safe/);
});

test('two lists out of step are refused rather than silently mispaired', () => {
  // The failure this guard exists for: every job would take its neighbour's id,
  // and therefore its url and its dedup key, while the output looked healthy.
  assert.throws(() => pair([posting('Backend Engineer'), posting('UI Engineer')],
                           [row('1', 'Backend Engineer'), row('2', 'Backend Engineer')]),
                /out of step/);
});

test('the board mangling a title does not trip the guard', () => {
  // Mangling only removes characters, so the rendered title stays a subsequence
  // of the structured one. Requiring equality here would refuse every page.
  assert.doesNotThrow(() => pair([posting('Platform Engineer, Core Systems')],
                                 [row('1', 'Platm Engineer Core Systems')]));
});

test('rows with no structured data at all is an error, not an empty page', () => {
  const rowsOnly = html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '');
  assert.throws(() => parseListing(rowsOnly), /JSON-LD block changed/);
});

test('a genuinely empty page is empty, not an error', () => {
  assert.deepEqual(parseListing('<html><body>no jobs today</body></html>'), []);
});
