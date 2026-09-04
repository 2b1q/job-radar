// The `verified` label, and where it lies.
//
// "from posting" means the figure came from the posting rather than from the
// board's own estimate, and the whole pipeline leans on that difference. It is
// not always true: three postings in one slice carried it at 68K against a slice
// median near 500K - the board mis-parsing a range. A label wrong in the
// direction of MORE confidence is the worst kind, so it gets marked rather than
// believed or quietly dropped.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { flagSuspiciousSalaries, salaryK } from '../adapters/talentmove.mjs';

const job = (id, value, kind) => ({
  id: `tm:${id}`, salaryValue: value, salaryKind: kind,
  salaryLabel: `${value}K RUB/mo (${kind === 'verified' ? 'from posting' : 'site estimate'})`,
});

// A slice whose median sits at 500K.
const slice = () => [
  job(1, 300, 'estimated'), job(2, 400, 'estimated'), job(3, 450, 'verified'),
  job(4, 500, 'verified'), job(5, 550, 'estimated'), job(6, 600, 'verified'),
  job(7, 680, 'estimated'), job(8, 850, 'verified'), job(9, 1063, 'verified'),
];

test('an anomalously low verified figure is marked', () => {
  const jobs = flagSuspiciousSalaries([...slice(), job(10, 68, 'verified')]);
  const odd = jobs.find((j) => j.id === 'tm:10');
  assert.equal(odd.salarySuspect, true);
  assert.match(odd.salaryLabel, /SUSPECT/);
});

test('the number itself is never changed', () => {
  // There is nothing to correct it to; the doubt is added, the figure is not
  // touched, and nobody downstream has to guess what was substituted.
  const jobs = flagSuspiciousSalaries([...slice(), job(10, 68, 'verified')]);
  const odd = jobs.find((j) => j.id === 'tm:10');
  assert.equal(odd.salaryValue, 68);
  assert.match(odd.salaryLabel, /^68K RUB\/mo/);
});

test('a low ESTIMATE is left alone', () => {
  // An estimate is already labelled as a guess; marking it would say nothing new.
  const jobs = flagSuspiciousSalaries([...slice(), job(10, 68, 'estimated')]);
  assert.ok(!jobs.find((j) => j.id === 'tm:10').salarySuspect);
});

test('ordinary verified figures are not marked', () => {
  for (const j of flagSuspiciousSalaries(slice())) {
    assert.ok(!j.salarySuspect, `${j.id} should not be suspect`);
  }
});

test('too small a sample has no distribution to judge against', () => {
  // Three jobs cannot establish a median worth trusting, so nothing is claimed.
  const jobs = flagSuspiciousSalaries([job(1, 500, 'verified'), job(2, 600, 'verified'),
                                       job(3, 68, 'verified')]);
  assert.ok(!jobs.find((j) => j.id === 'tm:3').salarySuspect);
});

test('jobs without a salary do not disturb the median', () => {
  const jobs = flagSuspiciousSalaries([
    ...slice(), job(10, 68, 'verified'),
    { id: 'tm:11', salaryValue: null, salaryKind: null, salaryLabel: 'not stated' },
  ]);
  assert.equal(jobs.find((j) => j.id === 'tm:10').salarySuspect, true);
  assert.equal(jobs.find((j) => j.id === 'tm:11').salaryLabel, 'not stated');
});

// The card prints one figure in thousands - "510K" - and that is the only shape
// 60 rows of real board output contain. A test fixture that invents a different
// one (a rouble range with spaces, "300 000 - 400 000") makes a parser look
// broken and a repair look justified; this one is bound to the observed shape.
test('the board shape - thousands with a K - is read as thousands', () => {
  assert.equal(salaryK('510K'), 510);
  assert.equal(salaryK('1948K'), 1948);
  assert.equal(salaryK('65 K'), 65);
});

// The unit is what makes the number comparable, so an unrecognised shape is not
// worth a guess: 300000 could be roubles a month or a year, and either reading
// sorts it against figures that mean something else.
test('an unrecognised shape has no value, rather than a number in guessed units', () => {
  assert.equal(salaryK('300 000 — 400 000'), null);
  assert.equal(salaryK('по договорённости'), null);
  assert.equal(salaryK(null), null);
  assert.equal(salaryK('0K'), null);
});

// The verdict depends on the whole slice, so it must not be written back into
// the objects the caller passed in: the same posting can sit in two slices, and
// whichever ran last would decide what its label says.
test('the caller keeps the jobs it passed in, unmarked', () => {
  const input = [...slice(), job(10, 68, 'verified')];
  const before = input.find((j) => j.id === 'tm:10');
  const marked = flagSuspiciousSalaries(input).find((j) => j.id === 'tm:10');

  assert.equal(marked.salarySuspect, true, 'the returned copy carries the doubt');
  assert.equal(before.salarySuspect, undefined, 'the original does not');
  assert.equal(before.salaryLabel, '68K RUB/mo (from posting)');
});

test('jobs that are not marked are passed through as they are', () => {
  const input = [...slice(), job(10, 68, 'verified')];
  const out = flagSuspiciousSalaries(input);
  const untouched = out.find((j) => j.id === 'tm:1');
  assert.equal(untouched, input.find((j) => j.id === 'tm:1'),
               'an unmarked job needs no copy at all');
});
