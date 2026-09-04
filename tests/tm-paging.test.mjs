// Paging, with the network stubbed.
//
// This exists because paging broke silently and stayed broken: the adapter sent
// `page`, the board reads `pg`, and an ignored parameter name is answered with
// the first page every time. Downstream it looked healthy - the store
// deduplicated the repeats, so a four page search reported "80 found, 20 new"
// and read as dedup doing its job.
//
// Nothing in the data says "this is the same page again", so the adapter has to
// say it.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { search } from '../adapters/talentmove.mjs';

const card = (id) =>
  `<article class="card-job">`
  + `<a class="card-job__link" href="https://example.invalid/jobs/x-${id}/">Title ${id}</a>`
  + `<div class="card-job__company">@Co${id}</div>`
  + `</article>`;

// One envelope per call, in order. Requests are captured so the query can be
// inspected without a board.
function stub(pagesHtml, maxPages = pagesHtml.length) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    // Past the end, the board keeps answering - that is the whole failure being
    // reproduced, so the stub repeats the last page rather than running out.
    const html = pagesHtml[Math.min(calls.length - 1, pagesHtml.length - 1)];
    return {
      ok: true, status: 200,
      json: async () => ({ html, found_posts: 99, max_pages: maxPages }),
    };
  };
  return calls;
}

test('the paging parameter is pg, which is what the board reads', async () => {
  const calls = stub([card(1), card(2)]);
  await search({ category: '7' }, 2);
  assert.match(calls[0], /[?&]pg=1(&|$)/, 'first page asks for pg=1');
  assert.match(calls[1], /[?&]pg=2(&|$)/, 'second page asks for pg=2');
  assert.ok(!/[?&]page=/.test(calls[1]), '`page` is the name the board ignores');
});

test('distinct pages accumulate', async () => {
  stub([card(1) + card(2), card(3) + card(4)]);
  const jobs = await search({ category: '7' }, 2);
  assert.deepEqual(jobs.map((j) => j.id), ['tm:1', 'tm:2', 'tm:3', 'tm:4']);
});

test('a repeated page is an error, not a quiet duplicate', async () => {
  // The exact shape of the original bug: the envelope claims three pages and
  // every one of them comes back identical.
  stub([card(1) + card(2)], 3);
  await assert.rejects(() => search({ category: '7' }, 3),
                       /repeats a page already fetched/);
});

test('one page asked for is one page fetched', async () => {
  const calls = stub([card(1)]);
  await search({ category: '7' }, 1);
  assert.equal(calls.length, 1, 'no guard should fire on a single page');
});

test('max_pages caps the walk below what was asked for', async () => {
  const calls = stub([card(1) + card(2)]);
  await search({ category: '7' }, 5);
  assert.equal(calls.length, 1, 'the envelope said there is one page');
});
