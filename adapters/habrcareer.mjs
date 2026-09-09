// adapters/habrcareer.mjs - career.habr.com (SRP: one job board, nothing else).
//
// The board's own front end reads a JSON API, so nothing here parses markup:
//
//   GET https://career.habr.com/api/frontend/vacancies?type=all&sort=date&page=1
//   -> { "list": [ ... ], "meta": { "totalResults": 1252, "perPage": 25,
//                                   "currentPage": 1, "totalPages": 41 } }
//
// This source exists to cover a market the other four do not reach at all:
// russian-language product companies, with their own remote and relocation
// postings. It does NOT satisfy the criterion the other sources are judged on -
// see `applyAtEmployer` below - and that is a measurement, not an oversight.
//
// Reconnaissance, recorded because guessing a parameter name has cost this
// project a session before - numbers in notes/habrcareer.md:
//   robots.txt   /api/frontend is not disallowed; the list under Disallow is
//                account and response pages. A sitemap is declared
//   paging       `page`, ONE based, 25 per page whatever else is asked for.
//                `meta.totalPages` states the last one, and a page past it is
//                HTTP 404 rather than an empty list - loud, for once
//   parameters   an unknown parameter NAME is accepted and dropped, and the
//                answer is the unfiltered total. An unknown VALUE on `qid` or
//                `skills` is a silent zero, which is the worse of the two, so
//                both are checked here before the request is made
//   `q`          free text, and empty is ignored rather than answered with zero
//   `qid`        qualification, and the ids are not contiguous: 1, 3, 4, 5, 6.
//                Read out of the board's own filter schema, not guessed - `2`
//                answers zero like any other value the board does not have
//   `skills`     numeric term ids, not the slugs that appear in a skill's own
//                href. Several are a UNION, like every other multi-value filter
//                here
//   `type`       `all` is the anonymous listing; `suitable` is personalised and
//                answers a different total to a caller with no session
//
// Returns the shared shape, so the store and the tools do not care which board a
// vacancy came from.

import { assertParsed, pageRepeatGuard } from './_shared/guards.mjs';
import { createHttp } from './_shared/http.mjs';
import { strip } from './_shared/text.mjs';

const BOARD = 'https://career.habr.com';
const API = `${BOARD}/api/frontend/vacancies`;

// Its own timings. This board has shown no limit across the reconnaissance
// above, which is a reason to be careful rather than a licence, so it sits where
// the other public boards sit.
const http = createHttp({
  throttleMs: 3500,
  jitterMs: 2500,
  baseHeaders: {
    'accept': 'application/json',
    'referer': `${BOARD}/vacancies`,
  },
});

export const requestCount = http.requestCount;
// The per-call ceiling is opened by the caller: a tool call is bounded, a smoke
// script is not.
export const beginCall = http.beginCall;
export const endCall = http.endCall;

/**
 * The board's qualification ids, from its own filter schema.
 *
 * Closed and checked locally, unlike the skill ids: this list is five values the
 * board publishes next to the filter, and an unknown one answers zero without a
 * word - the shape of wrong answer this repository keeps finding. The gap at 2
 * is the board's, not a typo here.
 */
export const QUALIFICATIONS = { intern: 1, junior: 3, middle: 4, senior: 5, lead: 6 };

/**
 * One API record in the shape every adapter returns.
 *
 * `applyAtEmployer` is FALSE, measured rather than assumed: the card carries one
 * link, to this board's own page for the posting, and that page applies through
 * the board's own form. No field in the record holds an employer's address, so
 * an application placed here reaches the employer through the board or not at
 * all. That is the honest answer for this source and it is the reason it ranks
 * below one whose links leave for the employer's own system.
 *
 * The place is copied, never interpreted: what the board states is a city in its
 * own city taxonomy rather than a country, and `locationVerified: false` says
 * nobody checked it.
 */
export function normalize(job) {
  const salary = job.salary || {};
  return {
    id: `hc:${job.id}`,
    source: 'hc',
    company: strip(job.company?.title || '') || null,
    title: strip(job.title || ''),
    url: job.href ? `${BOARD}${job.href}` : null,
    applyAtEmployer: false,
    // The board's own word for the place, city taxonomy and all. `locations` is
    // the list the card shows; `location` is the single value older records
    // carry, and both are absent on a remote-only posting.
    country: strip(job.locations?.[0]?.title || job.location?.title || '') || null,
    locationVerified: false,
    // One boolean is all the board states about the arrangement, so it is mapped
    // to the two phrases its own filter uses and nothing else is derived from it.
    format: job.remoteWork ? 'remote' : 'not remote',
    salaryLabel: strip(salary.formatted || '') || 'not stated',
    // Never filled, and that is the measurement: the record carries an amount and
    // a currency and states no PERIOD at all. A monthly figure read as an annual
    // one would sort this board's postings among the other boards' salaries and
    // be quoted back later, so the number stays in the label with the only
    // conditions the board actually gave it.
    salaryMinUsd: null,
    skills: (job.skills || []).map((s) => strip(s.title)).filter(Boolean),
    // Neither is a dimension this board has. Copying the other boards' `false`
    // says "not stated here", which is what it is.
    hasRussianRoots: false,
    visa: false,
    date: job.publishedDate?.date ? String(job.publishedDate.date).slice(0, 10) : null,
  };
}

/**
 * `qids` are qualification ids, `skills` are numeric term ids, and both are
 * checked before the request rather than after: this board answers an unknown
 * value with an unfiltered-looking zero.
 */
function url({ query = '', qids = [], skills = [], remote = false, page = 1 }) {
  const params = new URLSearchParams({ type: 'all', sort: 'date', page: String(page) });
  if (query) params.set('q', query);
  if (remote) params.set('remote', 'true');
  for (const qid of qids) params.append('qid[]', String(qid));
  for (const skill of skills) params.append('skills[]', String(skill));
  return `${API}?${params}`;
}

async function get(target, page) {
  http.countRequest();
  const res = await fetch(target, { headers: http.headers() });
  // Only meaningful past the last page, and the caller stops before that: a 404
  // inside `totalPages` is the API moving, not the end of the results.
  if (res.status === 404) throw new Error(`hc: HTTP 404 on page ${page} - the `
    + 'board answers 404 past its last page, so either paging moved or the page '
    + 'was requested beyond meta.totalPages');
  if (!res.ok) throw new Error(`hc: HTTP ${res.status} on page ${page}`);
  const data = await res.json();
  if (!Array.isArray(data?.list) || !data.meta) {
    throw new Error('hc: the answer carries no list/meta pair - the API shape changed');
  }
  return data;
}

export async function search(params = {}, maxPages = 3) {
  const out = [];
  const noRepeat = pageRepeatGuard('hc');
  let total = null;
  let lastPage = maxPages;
  for (let page = 1; page <= Math.min(maxPages, lastPage); page++) {
    const { list, meta } = await get(url({ ...params, page }), page);
    if (page === 1) {
      total = meta.totalResults ?? null;
      lastPage = meta.totalPages || 1;
      // Results promised and nothing parsed: the record shape moved.
      assertParsed(list.length, total || 0, 'hc');
    }
    if (!list.length) break;
    const jobs = list.map(normalize);
    // Paging is a parameter a board can ignore in silence - one of them did, and
    // the store's dedup swallowed the repeats for weeks.
    noRepeat(jobs[0].id, page);
    out.push(...jobs);
    if (page < Math.min(maxPages, lastPage)) await http.throttle();
  }
  // What the board says the query matched, next to what was actually collected.
  out.found = total;
  out.complete = total != null && out.length >= total;
  return out;
}

export async function count(params = {}) {
  const { list, meta } = await get(url({ ...params, page: 1 }), 1);
  return { found: meta.totalResults ?? null, onPage: list.length };
}
