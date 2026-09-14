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
// Three postings for the arithmetic test: one an excluded title, and two that
// are the same posting under different ids.
const afMixed = [
  { id: 26200001, companyName: 'GammaCo', title: 'Backend Engineer' },
  { id: 26200002, companyName: 'GammaCo', title: 'Head of Sales' },
  { id: 26200003, companyName: 'DeltaCo', title: 'Platform Engineer' },
  { id: 26200004, companyName: 'DeltaCo', title: 'Platform Engineer' },
].map((j) => ({
  ...j,
  url: token(`https://jobs.ashbyhq.com/x/${j.id}`),
  country: 'RS', format: 'remote', salaryLabel: 'not stated', salaryMinUsd: null,
  createdAtIso: '2026-09-09T00:00:00.000Z',
}));

// Filed under the lower-case alpha-3 codes this board writes. Two carry the same
// relocation phrase, one asserting it and one denying it.
const afCountries = [
  { id: 26300001, country: 'usa', title: 'Backend Engineer, Payments' },
  { id: 26300002, country: 'ww', title: 'Backend Engineer, Ledger' },
  { id: 26300003, country: 'unk', title: 'Backend Engineer, Wallets' },
  { id: 26300004, country: 'prt', title: 'Backend Engineer, Custody' },
  { id: 26300005, country: 'gbr', title: 'Backend Engineer, Settlement',
    description: 'We offer a relocation package.' },
  { id: 26300006, country: 'deu', title: 'Backend Engineer, Risk',
    description: 'There is no relocation package for this role.' },
].map((j) => ({
  ...j,
  companyName: `CountryCo ${j.id}`,
  url: token(`https://jobs.ashbyhq.com/x/${j.id}`),
  format: 'remote', salaryLabel: 'not stated', salaryMinUsd: null,
  createdAtIso: '2026-09-09T00:00:00.000Z',
}));

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

// career.habr.com answers its own front end's JSON. One page, and the fixture's
// own totals, so the walk ends where the board says it does.
const hcPage = () => {
  const envelope = JSON.parse(read('hc-vacancies.json'));
  envelope.meta = { totalResults: envelope.list.length, perPage: 25, currentPage: 1, totalPages: 1 };
  return JSON.stringify(envelope);
};

// The employer watchlist. The Greenhouse instance carries the same posting the
// other two boards already published, under the employer's own link - which is
// the case the store has to say something about rather than merge in silence.
// Dated yesterday at serve time: a fixed date ages out of the default `since`
// and turned both watchlist tests red.
const yesterday = () => new Date(Date.now() - 86400e3).toISOString();
const ghTwin = () => JSON.stringify({
  jobs: [{
    id: 7000500, title: TWIN.title, company_name: TWIN.company,
    absolute_url: 'https://job-boards.greenhouse.io/twinco/jobs/7000500',
    location: { name: 'Remote' }, offices: [], departments: [],
    first_published: yesterday(), updated_at: yesterday(),
    content: '&lt;p&gt;This is a hybrid role.&lt;/p&gt;',
  }],
  meta: { total: 1 },
});

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (url.includes('web3.career')) return reply(url, read('w3-listing.html'));
  if (url.includes('career.habr.com')) return reply(url, hcPage());
  if (url.includes('greenhouse.io')) return reply(url, ghTwin());
  if (url.includes('ashbyhq.com')) {
    const board = JSON.parse(read('ats-ashby.json'));
    for (const job of board.jobs) job.publishedAt = yesterday();
    return reply(url, JSON.stringify(board));
  }
  if (url.includes('bamboohr.com')) return reply(url, read('ats-bamboohr.json'));
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
    const data = filters?.searchQuery === 'twin' ? [afTwin]
      : filters?.searchQuery === 'mixed' ? afMixed
        : filters?.searchQuery === 'countries' ? afCountries
          : afJobs(2);
    return reply(url, JSON.stringify({ data, hasMore: (pagination?.page || 1) < 1 }));
  }
  if (url.includes('/api/jobs/count')) {
    const { filters } = JSON.parse(init.body || '{}');
    const sets = { mixed: afMixed, countries: afCountries };
    return reply(url, JSON.stringify({ totalCount: sets[filters?.searchQuery]?.length ?? 2 }));
  }
  throw new Error(`stub-boards: nothing is stubbed for ${url}`);
};
