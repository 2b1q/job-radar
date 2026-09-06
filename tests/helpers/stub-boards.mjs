// A preload that answers every board from a fixture, for tests that need the
// real server rather than one of its parts.
//
//   node --experimental-sqlite --import ./tests/helpers/stub-boards.mjs server.mjs
//
// `--import` runs before the entry module, so `server.mjs` and its adapters see
// this `fetch` and never open a socket. The point is to exercise the seam the
// unit tests cannot reach: server.mjs starts a stdio transport at import and
// everything past the adapter - the store write, the run log, the request count
// - only happens inside a tool call.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const read = (name) => readFileSync(join(FIXTURES, name), 'utf8');

const reply = (url, body) => ({
  ok: true,
  status: 200,
  url,
  text: async () => body,
  json: async () => JSON.parse(body),
});

// AgileFluent answers JSON over POST; its `url` field is a JWT whose payload
// carries the real link, so the fixture has to be built rather than stored.
const token = (url) => `x.${Buffer.from(JSON.stringify({ url })).toString('base64')}.y`;
const afJobs = (n) => Array.from({ length: n }, (_, i) => ({
  id: 26100000 + i,
  companyName: `StubCo ${i}`,
  title: `Backend Engineer ${i}`,
  url: token(`https://example.invalid/jobs/${26100000 + i}`),
  country: 'RS',
  format: 'remote',
  salaryLabel: '$120–180k / год',
  salaryMinUsd: 120000,
  createdAtIso: '2026-09-04T00:00:00.000Z',
}));

// The same posting as two boards mint it: one company and title, two ids. Asked
// for by name (`twin`) so a test can reach it without disturbing the fixtures.
const TWIN = { company: 'TwinCo', title: 'Staff Backend Engineer' };
const afTwin = {
  id: 26100500, companyName: TWIN.company, title: TWIN.title,
  url: token('https://example.invalid/jobs/26100500'), country: 'RS', format: 'remote',
  salaryLabel: '$150–200k / год', salaryMinUsd: 150000,
  createdAtIso: '2026-09-04T00:00:00.000Z',
};
const tmTwin = JSON.stringify({
  found_posts: 1, max_pages: 1, current_page: 1,
  html: '<article class="card-job">'
    + `<a class="card-job__link" href="https://talent-move.ru/jobs/twin-900500/">${TWIN.title}</a>`
    + `<div class="card-job__company">@${TWIN.company}</div>`
    + '<div class="card-job__feature card-job__feature--format"> <span>Удалённо</span></div>'
    + '</article>',
});

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (url.includes('web3.career')) return reply(url, read('w3-listing.html'));
  if (url.includes('api.getro.com')) {
    // jobs.solana.com pages from zero and reports its own total; page 1 is past
    // the end of this fixture, which is how the walk is supposed to stop.
    const { page } = JSON.parse(init.body || '{}');
    const envelope = JSON.parse(read('sol-search.json'));
    if (page > 0) envelope.results.jobs = [];
    envelope.results.count = 4;
    return reply(url, JSON.stringify(envelope));
  }
  if (url.includes('/tm/v1/filtered-jobs')) {
    return reply(url, url.includes('skills=twin') ? tmTwin : read('tm-envelope.json'));
  }
  if (url.includes('/tm/v1/search-skills')) return reply(url, JSON.stringify({ results: [] }));
  if (url.includes('/api/jobs/search')) {
    const { filters, pagination } = JSON.parse(init.body || '{}');
    const data = filters?.searchQuery === 'twin' ? [afTwin] : afJobs(2);
    return reply(url, JSON.stringify({ data, hasMore: (pagination?.page || 1) < 1 }));
  }
  if (url.includes('/api/jobs/count')) return reply(url, JSON.stringify({ totalCount: 2 }));
  throw new Error(`stub-boards: nothing is stubbed for ${url}`);
};
