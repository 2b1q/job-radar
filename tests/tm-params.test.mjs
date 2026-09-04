// How a request becomes TalentMove query parameters.
//
// Worth pinning because the failure is quiet in one direction and loud in the
// other: an unknown parameter *name* is accepted and discarded, while an unknown
// *value* returns zero results. Serialising the skills list wrongly lands in the
// second case, which at least shows up - but as "no such jobs", which is exactly
// the answer a stack search is supposed to give when it works.
//
// No network. Importing server.mjs would hang the run - it starts the stdio
// transport at module load and never returns - so the mapping lives in its own
// module. That is not a workaround: what is pure belongs apart from what talks.

import assert from 'node:assert/strict';
import { test } from 'node:test';

// Bound to the PUBLISHED profile, never to the private one. profiles.json is
// gitignored and differs per machine; a test that reads it passes or fails
// depending on whose checkout it runs in.
process.env.JOBS_PROFILES = 'profiles.example.json';
const { tmParams, TM_PRESETS, TM_DATES, resolveTags, CATEGORIES } = await import('../params.mjs');

test('a skills string is passed through as the board wants it', () => {
  assert.equal(tmParams({ skills: 'node-js' }).skills, 'node-js');
});

test('an array becomes one comma separated parameter', () => {
  // Not repeated params and not `skills[]`: the board reads one value and splits
  // it on commas, the way its own filter script builds the query.
  assert.equal(tmParams({ skills: ['node-js', 'typescript'] }).skills,
               'node-js,typescript');
});

test('whitespace and empty entries are dropped', () => {
  assert.equal(tmParams({ skills: ' node-js , , typescript ' }).skills,
               'node-js,typescript');
  assert.equal(tmParams({ skills: ['node-js', '', '  '] }).skills, 'node-js');
});

test('no skills means no parameter at all', () => {
  // An empty `skills=` would be an unknown value, and an unknown value returns
  // zero results rather than being ignored.
  assert.ok(!('skills' in tmParams({})));
  assert.ok(!('skills' in tmParams({ skills: '' })));
  assert.ok(!('skills' in tmParams({ skills: [] })));
  assert.ok(!('skills' in tmParams({ skills: '  ,  ' })));
});

test('category is stringified, skills sit next to it', () => {
  const p = tmParams({ category: 7, skills: ['postgresql'] });
  assert.equal(p.category, '7');
  assert.equal(p.skills, 'postgresql');
});

test('the preset still supplies the format', () => {
  assert.equal(tmParams({ preset: 'remote' }).format, 'fully-remote');
  // `anywhere` means every format, not a synonym for remote.
  assert.ok(!('format' in tmParams({ preset: 'anywhere' })));
});

test('the two stub presets are still stubs, and say so by shape', () => {
  // If either ever grows a real filter, this fails and the README paragraph
  // explaining why they are stubs needs revisiting.
  assert.deepEqual(Object.keys(TM_PRESETS.countries), ['format']);
  assert.deepEqual(Object.keys(TM_PRESETS.ruroots), ['format']);
});

test('date takes only what the board actually recognises', () => {
  for (const d of ['today', '7days', '30days']) {
    assert.equal(tmParams({ date: d }).date, d);
  }
});

test('a plausible date typo is refused here, not sent', () => {
  // The board drops an unrecognised `date` in silence and answers with the
  // UNFILTERED total: measured, `date=7d` returned 383 where `7days` returned 18.
  // A wrong answer shaped like good news is the one worth refusing locally.
  for (const bad of ['7d', 'week', '14days', 'nonsense', 'TODAY']) {
    assert.throws(() => tmParams({ date: bad }), /must be one of/,
                  `${bad} must not reach the board`);
  }
});

test('no date means no parameter', () => {
  assert.ok(!('date' in tmParams({})));
  assert.ok(!('date' in tmParams({ date: '' })));
});

test('date sits alongside skills and category', () => {
  const p = tmParams({ category: 7, skills: ['node-js'], date: '30days' });
  assert.equal(p.category, '7');
  assert.equal(p.skills, 'node-js');
  assert.equal(p.date, '30days');
});

test('a well formed category id passes through as a string', () => {
  assert.equal(tmParams({ category: 7 }).category, '7');
  assert.equal(tmParams({ category: '38359' }).category, '38359');
  assert.equal(tmParams({ category: ' 903 ' }).category, '903');
});

test('a malformed category id is refused, because the board would misread it', () => {
  // Measured: `category=7abc` returns 7400 - the full dev category. Not an empty
  // answer but a complete one from a filter nobody asked for, which is the worst
  // shape a silent failure can take.
  for (const bad of ['7abc', 'crypto', '0', '-7', '7.5', 'abc']) {
    assert.throws(() => tmParams({ category: bad }), /must be a job_category term id/,
                  `${bad} must not reach the board`);
  }
});

test('an unknown but well formed id is left to the board', () => {
  // It answers 0, which answers for itself; a local whitelist of 58 ids would go
  // stale the day a category is added.
  assert.equal(tmParams({ category: '999999' }).category, '999999');
});

test('no category means no parameter', () => {
  assert.ok(!('category' in tmParams({})));
  assert.ok(!('category' in tmParams({ category: '' })));
});


test('a profile category name resolves to its board id', () => {
  // Queries read `data`, not `38467`: taxonomy ids are per board and belong in
  // configuration rather than in every call.
  assert.equal(tmParams({ category: 'data' }).category, String(CATEGORIES.data));
  assert.equal(tmParams({ category: '38359' }).category, '38359');
});

// A name the profile does not define is not silently treated as an id: it goes
// through the same shape check, and a non-numeric one is refused rather than
// coerced by the board into a different category.
test('an undefined category name is refused, not passed through', () => {
  assert.throws(() => tmParams({ category: 'dba' }), /term id/);
});

test('a tag group expands, an unknown name stays literal', () => {
  assert.deepEqual(resolveTags('rdbms'), ['PostgreSQL', 'Oracle', 'MySQL', 'MS SQL']);
  assert.deepEqual(resolveTags('Kafka'), ['Kafka']);
  assert.deepEqual(resolveTags(['rdbms', 'Kafka']),
    ['PostgreSQL', 'Oracle', 'MySQL', 'MS SQL', 'Kafka']);
  assert.deepEqual(resolveTags(''), []);
});
