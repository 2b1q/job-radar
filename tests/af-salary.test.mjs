// What may be called `salaryMinUsd`.
//
// The board quotes eleven currencies and fills the same numeric field for all of
// them: `JPY8010–16000k / год` arrives with `salaryMinUsd: 8010000`, which puts
// a yen figure above every dollar figure in a sort by money. The rule this repo
// already keeps - never convert a currency - was not the one being broken; the
// broken one is that a number in a field named after a currency is in that
// currency or it is not there.
//
// The labels below are real shapes from the board, kept verbatim as data. The
// figure is never lost: the label carries it in the currency it was written in.
//
// No network: `usdMin` is pure, and it is the whole decision.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { usdMin } from '../adapters/agilefluent.mjs';

test('a dollar figure is a dollar figure', () => {
  assert.equal(usdMin('$173–255k / год', 173000), 173000);
  assert.equal(usdMin('$4–0k / мес', 4000), 4000);
  assert.equal(usdMin('USD 120k / год', 120000), 120000);
});

test('yen is not dollars, and the field is left empty', () => {
  // The reported case: 8000000 in a USD field outranks every real dollar salary.
  assert.equal(usdMin('JPY8000–16000k / год', 8000000), null);
  assert.equal(usdMin('JPY8010–16000k / год', 8010000), null);
});

test('nor are roubles', () => {
  // The other board quotes roubles and leaves the field null for exactly this
  // reason. Two adapters disagreeing about what the field means is worse than
  // either answer.
  assert.equal(usdMin('RUB300–500k / мес', 300000), null);
});

test('nor any of the other currencies the board prints', () => {
  for (const [label, value] of [['€103–139k / год', 103000], ['GBP142–190k / год', 142000],
                                ['PLN365–485k / год', 365000], ['CAD153–213k / год', 153000],
                                ['INR2475–3465k / год', 2475000], ['SGD180–240k / год', 180000],
                                ['PEN90–120k / год', 90000], ['BYR200–300k / мес', 200000]]) {
    assert.equal(usdMin(label, value), null, `${label} is not USD`);
  }
});

test('the label stays exactly as the board wrote it', () => {
  // Nothing is corrected or annotated: the currency and the figure are what the
  // board said, and the reader can see both. Only the sortable field is refused.
  const label = 'JPY8000–16000k / год';
  usdMin(label, 8000000);
  assert.equal(label, 'JPY8000–16000k / год');
});

test('no label is no currency, and no currency is not USD', () => {
  // A bare number could be any of the eleven. Defaulting to dollars is the guess
  // that produced the defect in the first place.
  assert.equal(usdMin(null, 150000), null);
  assert.equal(usdMin('', 150000), null);
  assert.equal(usdMin('Не указана', 150000), null);
});

test('no figure stays no figure', () => {
  assert.equal(usdMin('$173–255k / год', null), null);
  assert.equal(usdMin('Не указана', null), null);
  assert.equal(usdMin(undefined, undefined), null);
});

test('a currency is not read out of the middle of a label', () => {
  // "converted from USD" is a note about a conversion, not a dollar figure, and
  // matching the code anywhere in the string would accept it.
  assert.equal(usdMin('JPY8000–16000k / год (approx USD 54k)', 8000000), null);
});

// And through the adapter, because `normalize` is where the field is actually
// filled and a pure helper nobody calls proves nothing.
test('a yen posting comes out of a search with an empty USD field', async () => {
  const token = (url) => `x.${Buffer.from(JSON.stringify({ url })).toString('base64')}.y`;
  const board = [
    { id: 26090315, companyName: 'YenCo', title: 'Backend Engineer',
      url: token('https://example.invalid/jobs/26090315'), country: 'JP', format: 'remote',
      salaryLabel: 'JPY8000–16000k / год', salaryMinUsd: 8000000,
      createdAtIso: '2026-09-04T00:00:00.000Z' },
    { id: 26090316, companyName: 'DollarCo', title: 'Backend Engineer',
      url: token('https://example.invalid/jobs/26090316'), country: 'US', format: 'remote',
      salaryLabel: '$173–255k / год', salaryMinUsd: 173000,
      createdAtIso: '2026-09-04T00:00:00.000Z' },
  ];
  // `search` asks for the board's total before it walks the pages, so the count
  // envelope has to be answered too - it is a different shape from a page.
  globalThis.fetch = async (url) => ({ ok: true, status: 200,
                                       json: async () => (String(url).endsWith('/jobs/count')
                                         ? { totalCount: board.length }
                                         : { data: board, hasMore: false }) });

  const { search } = await import('../adapters/agilefluent.mjs');
  const [yen, dollars] = await search({ roles: [] }, 1);
  assert.equal(yen.salaryMinUsd, null, 'the sort key is refused');
  assert.equal(yen.salaryLabel, 'JPY8000–16000k / год', 'the figure is still readable');
  assert.equal(dollars.salaryMinUsd, 173000);
});
