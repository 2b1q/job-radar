// adapters/solana.mjs - jobs.solana.com (SRP: one job board, nothing else).
//
// The board runs on Getro, and Getro answers a JSON API rather than a page:
//
//   POST https://api.getro.com/api/v2/collections/858/search/jobs
//   { "page": 0, "query": "", "filters": {} }
//   -> { "results": { "count": 411, "jobs": [ ... ] } }
//
// `858` is this network's id, read out of the board's own page state
// (`__NEXT_DATA__ .. network.id`), not guessed.
//
// The reason this source exists at all is the `url` field: for most records it is
// the employer's own application, on the employer's own ATS - Ashby, Greenhouse,
// Lever, Gem - and not a link back to the board. For the rest the board hosts the
// form itself, which still reaches the employer and is still a different thing.
// Which of the two it is has to be visible in the record rather than discovered
// by clicking, so `applyAtEmployer` carries it. The counts are in
// notes/solana.md, where a number can be re-measured without going stale here.
//
// Reconnaissance, recorded because guessing a parameter name has cost this
// project a session before - measurements in notes/solana.md:
//   robots.txt   one line, a sitemap. Nothing is disallowed
//   accept       the API answers 406 to a request that does not ask for JSON
//   paging       `page`, ZERO based. `hitsPerPage` is accepted and ignored: a
//                page is 20 records whatever it says
//   the end      a page past the last answers `jobs: []` with `count` unchanged,
//                so the total is what says whether the walk finished
//   order        newest first by `created_at`, measured over 60 records. Not
//                relied on here; it is why `since` is not faked (see below)
//   filters      `work_mode` and `seniority` are real and REFUSE an unknown
//                value with 422 naming what is allowed. `job_functions` is real
//                and answers an unknown value with a silent zero. `locations`,
//                `skills`, `remote` and any name the API does not know are
//                accepted and dropped, and the answer is the unfiltered total
//   no date      no date filter exists under any name tried, so `since` is not
//                expressible here and is not approximated
//
// Returns the shared shape, so the store and the tools do not care which board a
// vacancy came from.

import { assertParsed, pageRepeatGuard } from './_shared/guards.mjs';
import { createHttp } from './_shared/http.mjs';
import { strip } from './_shared/text.mjs';

const BOARD_HOST = 'jobs.solana.com';
const API = 'https://api.getro.com/api/v2/collections/858/search/jobs';

// Its own timings. This board has shown no limit across 39 requests in an hour,
// which is a reason to be careful rather than a licence, so it sits where the
// other public board sits.
const http = createHttp({
  throttleMs: 3500,
  jitterMs: 2500,
  baseHeaders: {
    // Not decoration: without it the API answers 406 and no body at all.
    'accept': 'application/json',
    'content-type': 'application/json',
    'origin': `https://${BOARD_HOST}`,
    'referer': `https://${BOARD_HOST}/`,
  },
});

export const requestCount = http.requestCount;
// The per-call ceiling is opened by the caller: a tool call is bounded, a smoke
// script is not.
export const beginCall = http.beginCall;
export const endCall = http.endCall;

// The mapping is exported because it is pure and the fetching around it is not -
// and because it is the part that decides what a caller ends up reading.
/**
 * Does this link open the employer's own application, or the board's page?
 *
 * The board hosts the form itself for some postings - its own domain in the
 * `url` field - and that application does reach the employer, so this is not a
 * broken link. It is a different thing from an ATS link, and the difference is
 * what a caller is choosing between.
 */
export function leadsToEmployer(url) {
  if (!url) return false;
  try {
    return new URL(url).hostname !== BOARD_HOST;
  } catch {
    return false;   // not a url we can reason about, so not a claim we can make
  }
}

/**
 * The compensation, in the shape the rest of the repo speaks.
 *
 * `salaryMinUsd` is filled only when the board states USD *a year*: the field is
 * compared against annual figures from two other boards, and a number whose
 * period is "period_not_defined" is the "number without its conditions" this
 * repo refuses to store. The label keeps whatever the board said either way.
 */
export function money(job) {
  const min = job.compensation_amount_min_cents;
  const max = job.compensation_amount_max_cents;
  const currency = job.compensation_currency;
  const period = job.compensation_period;
  if (!min) return { label: 'not stated', usd: null };
  const k = (cents) => `${Math.round(cents / 100000)}K`;
  const per = period && period !== 'period_not_defined' ? period : 'period not stated';
  const label = `${k(min)}-${k(max || min)} ${currency || 'currency not stated'}/${per}`;
  return { label, usd: currency === 'USD' && period === 'year' ? Math.round(min / 100) : null };
}

/**
 * One API record in the shape every adapter returns.
 *
 * Location and work mode are copied, not interpreted. Three postings measured on
 * other boards said one thing and meant another - `remote` that was an office
 * five days a week, `Remote` that was a hybrid in another country, a country
 * code on a posting whose own text said "over 25 countries" - so what the board
 * states is stored and `locationVerified: false` says nobody checked it.
 */
export function normalize(job) {
  const org = job.organization || {};
  const { label, usd } = money(job);
  return {
    id: `sol:${job.id}`,
    source: 'sol',
    company: strip(org.name || '') || null,
    title: strip(job.title || ''),
    url: job.url || null,
    // The whole reason for this source, and never inferred from the board's own
    // page url: the field is what the board published as the way to apply.
    applyAtEmployer: leadsToEmployer(job.url),
    country: (Array.isArray(job.locations) && job.locations[0]) || null,
    locationVerified: false,
    format: job.work_mode || null,
    salaryLabel: label,
    salaryMinUsd: usd,
    skills: Array.isArray(job.skills) ? job.skills : [],
    hasRussianRoots: false,
    visa: false,
    date: job.created_at ? new Date(job.created_at * 1000).toISOString().slice(0, 10) : null,
  };
}

async function post(body) {
  http.countRequest();
  const res = await fetch(API, { method: 'POST', headers: http.headers(), body: JSON.stringify(body) });
  if (res.status === 422) {
    // The board names what it would have accepted, and its sentence is more use
    // than ours: "Only on_site and remote are allowed as work mode options".
    const said = await res.text().catch(() => '');
    throw new Error(`sol: the API refused a filter value - ${strip(said) || '422'}`);
  }
  if (res.status === 406) {
    throw new Error('sol: HTTP 406 - the API answers only to a request that asks '
      + 'for JSON, and the accept header went missing');
  }
  if (!res.ok) throw new Error(`sol: HTTP ${res.status} on ${JSON.stringify(body.filters || {})}`);
  const data = await res.json();
  // A renamed envelope would otherwise read as "no jobs today", which is the
  // failure this repository keeps finding.
  if (!data?.results || !Array.isArray(data.results.jobs)) {
    throw new Error('sol: the answer carries no results.jobs array - the API shape changed');
  }
  return data.results;
}

const filtersFor = (workMode) => (workMode ? { work_mode: [workMode] } : {});

/**
 * `query` is the board's free text search, and it NARROWS with each word added -
 * measured: "rust" 76, "typescript" 69, "rust solana" 62 - so it takes one term
 * rather than a stack. `workMode` is `remote`, `on_site` or null for both - and
 * a wrong one is left to the board on purpose: it answers 422 naming what it
 * would have taken, which is louder than a local list that goes stale.
 */
export async function search({ query = '', workMode = null } = {}, maxPages = 3) {
  const out = [];
  const noRepeat = pageRepeatGuard('sol');
  let total = null;
  for (let page = 0; page < maxPages; page++) {
    const results = await post({ page, query, filters: filtersFor(workMode) });
    if (page === 0) {
      total = results.count ?? null;
      // Promised results and parsed none: the record shape moved.
      assertParsed(results.jobs.length, total || 0, 'sol');
    }
    if (!results.jobs.length) break;   // past the last page; `count` says so too
    const jobs = results.jobs.map(normalize);
    // Paging is a parameter a board can ignore in silence - one of them did, and
    // the store's dedup swallowed the repeats for weeks.
    noRepeat(jobs[0].id, page);
    out.push(...jobs);
    if (total != null && out.length >= total) break;
    if (page < maxPages - 1) await http.throttle();
  }
  // What the board says the query matched, next to what was actually collected.
  out.found = total;
  out.complete = total != null && out.length >= total;
  return out;
}

export async function count({ query = '', workMode = null } = {}) {
  const results = await post({ page: 0, query, filters: filtersFor(workMode) });
  return { found: results.count ?? null, onPage: results.jobs.length };
}
