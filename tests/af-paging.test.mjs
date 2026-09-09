// AgileFluent paging, with the network stubbed.
//
// This board had no guards at all while the other two did, which is not a
// judgement about this board: paging is a request any of them can ignore
// without saying so, and the store's dedup then swallows the repeats. On the
// board where that happened, a four-page run reported "80 found, 20 new" and
// read as dedup doing its job.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { search } from '../adapters/agilefluent.mjs';

// The url field is a JWT whose payload carries the real link; only the payload
// segment is ever read, so the header and signature are placeholders.
const token = (url) =>
  'x.' + Buffer.from(JSON.stringify({ url })).toString('base64') + '.y';

const job = (id) => ({
  id, companyName: `Co${id}`, title: `Title ${id}`,
  url: token(`https://example.invalid/jobs/${id}`),
  country: 'RS', format: 'remote', salaryLabel: 'not stated',
  createdAtIso: '2026-01-01T00:00:00.000Z',
});

// One response per call, in order; past the end the board keeps answering,
// which is the failure being reproduced rather than an edge case.
//
// `search` opens with a count, because `/jobs/search` states only `hasMore` and
// the board's own total is what tells a narrowed query from an empty one. That
// request is answered here and left out of `calls`, which are the page requests
// these tests are about.
function stub(pages, { hasMoreAfterLast = false, total = 100 } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/jobs/count')) {
      return { ok: true, status: 200, json: async () => ({ totalCount: total }) };
    }
    calls.push(JSON.parse(init.body));
    const i = Math.min(calls.length - 1, pages.length - 1);
    const last = calls.length >= pages.length;
    return {
      ok: true, status: 200,
      json: async () => ({ data: pages[i], hasMore: last ? hasMoreAfterLast : true }),
    };
  };
  return calls;
}

test('pages accumulate, and the page number is what changes', async () => {
  const calls = stub([[job(1), job(2)], [job(3)]]);
  const jobs = await search({ roles: [] }, 2);
  assert.deepEqual(jobs.map((j) => j.id), ['1', '2', '3']);
  assert.equal(calls[0].pagination.page, 1);
  assert.equal(calls[1].pagination.page, 2);
});

test('a repeated page is an error, not a quiet duplicate', async () => {
  // The board answers, `hasMore` stays true, and every page is the first one.
  stub([[job(1), job(2)]], { hasMoreAfterLast: true });
  await assert.rejects(() => search({ roles: [] }, 3),
                       /repeats a page already fetched/);
});

test('more promised and nothing delivered is an error, not an empty result', async () => {
  stub([[]], { hasMoreAfterLast: true });
  await assert.rejects(() => search({ roles: [] }, 2),
                       /empty while the board says there is more/);
});

test('an empty page with no more promised is an ordinary end of results', async () => {
  stub([[]], { hasMoreAfterLast: false, total: 0 });
  const jobs = await search({ roles: [] }, 2);
  assert.equal(jobs.length, 0);
  // And the emptiness says which kind it is. The board's own total is what
  // separates "these filters match nothing" from "we stopped reading", and this
  // board states one only through its count endpoint.
  assert.equal(jobs.found, 0);
  assert.equal(jobs.complete, true);
});

test('a collected page shorter than the board total is not reported as complete', async () => {
  // The pair the other adapters report, and the reason a narrowed query on this
  // board no longer reads as an empty market.
  stub([[job(1), job(2)]], { hasMoreAfterLast: false, total: 57 });
  const jobs = await search({ roles: [] }, 1);
  assert.equal(jobs.found, 57);
  assert.equal(jobs.length, 2);
  assert.equal(jobs.complete, false);
});

test('a count envelope without a total is an error, not an absent found', async () => {
  globalThis.fetch = async (url) => ({
    ok: true, status: 200,
    json: async () => (String(url).endsWith('/jobs/count') ? {} : { data: [job(1)], hasMore: false }),
  });
  await assert.rejects(() => search({ roles: [] }, 1), /answered without a totalCount/);
});

test('hasMore false stops the walk before maxPages', async () => {
  const calls = stub([[job(1)]], { hasMoreAfterLast: false });
  await search({ roles: [] }, 5);
  assert.equal(calls.length, 1);
});

// The vacancy link arrives as a JWT payload. One token that will not decode is a
// null url on one job; every token failing means the encoding changed, and the
// run would otherwise read as a board that stopped publishing links.
test('a page where no url decodes is an error, not a page of linkless jobs', async () => {
  stub([[{ ...job(1), url: 'not-a-token' }, { ...job(2), url: 'also-not' }]]);
  await assert.rejects(() => search({ roles: [] }, 1),
                       /not one usable url/);
});

test('a single undecodable token leaves one null url and keeps the rest', async () => {
  stub([[{ ...job(1), url: 'not-a-token' }, job(2)]]);
  const jobs = await search({ roles: [] }, 1);
  assert.equal(jobs[0].url, null);
  assert.equal(jobs[1].url, 'https://example.invalid/jobs/2');
});
