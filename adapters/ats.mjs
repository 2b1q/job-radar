// adapters/ats.mjs - the employers' own applicant tracking systems (SRP: one
// kind of source, nothing else).
//
// Greenhouse, Ashby and BambooHR each publish an unauthenticated list of the
// postings on one company's instance:
//
//   GET https://boards-api.greenhouse.io/v1/boards/<slug>/jobs?content=true
//   GET https://api.ashbyhq.com/posting-api/job-board/<slug>?includeCompensation=true
//   GET https://<slug>.bamboohr.com/careers/list
//
// WHY THIS IS ONE ADAPTER AND NOT THREE, AND WHY IT IS NOT A NEW INTERFACE.
// A board is a place to search; this is a list of employers to watch, and the
// question it answers is "what is open at these companies", not "who is hiring".
// That difference is real, and it turned out to live entirely in the parameters:
// three dialects of the same request, one record shape, and `pages` meaning
// "how many companies to read" instead of "how many pages to walk". Everything
// downstream - the store, the dedup key, the four tools - needed nothing. A
// second interface would have bought a second code path for the sake of a word.
//
// What it does change is `applyAtEmployer`, and that is the point: the url IS
// the employer's own system, so the answer is `true` for every record here
// rather than the `false` that every job board in this repository earns.
//
// The dedup key is `company + title` as everywhere else, and it behaves the same
// - but the ORDER now matters in a way it did not before. A posting already
// stored from a board is the same posting, so the ATS copy merges into it and
// the employer's link is the one that gets dropped. The store says so rather
// than swallowing it; see `filterFresh`.
//
// Reconnaissance, recorded because guessing has cost this project a session
// before - numbers in notes/ats.md:
//   the list      one request per company, whole. None of the three pages, and
//                 none of them offers a search parameter, so a query is a local
//                 filter here and is labelled as one
//   totals        Greenhouse states `meta.total` and BambooHR `meta.totalCount`;
//                 Ashby states none, so its own list length is the total
//   unknown slug  Greenhouse and Ashby answer 404. BambooHR answers 302 to its
//                 marketing site, so redirects are NOT followed here - a
//                 followed one parses as "this company has no openings"
//   description   Greenhouse sends the posting body twice-escaped in `content`
//                 and Ashby sends it as `descriptionPlain`. BambooHR's list
//                 carries none at all, and its per-posting detail endpoint would
//                 cost one request per vacancy
//   skills        none of the three publishes a tag or skill list
//   salary        no provider states a period next to an amount, so nothing
//                 enters a field named after one
//
// Returns the shared shape, so the store and the tools do not care where a
// vacancy came from.

import { createHttp } from './_shared/http.mjs';
import { detectSignals, signalNote } from './_shared/signals.mjs';
import { strip } from './_shared/text.mjs';

// Its own timings. Three different hosts, none of which has refused anything
// here, and a watchlist read is one request per company rather than a walk - so
// this sits at the pace of the public boards rather than below it.
const http = createHttp({
  throttleMs: 3500,
  jitterMs: 2500,
  baseHeaders: { 'accept': 'application/json' },
});

export const requestCount = http.requestCount;
export const beginCall = http.beginCall;
export const endCall = http.endCall;

/**
 * Greenhouse sends the posting body HTML-escaped INSIDE a JSON string, so it
 * arrives twice encoded: `&lt;p&gt;` becomes `<p>` before it becomes text. One
 * pass leaves the markup in the quote a human is meant to read.
 */
const htmlText = (s) => strip(strip(s));

const iso = (s) => (s ? String(new Date(s).toISOString()).slice(0, 10) : null);

/**
 * One provider: where its list lives, how to count it, and how one of its
 * records becomes the shared shape.
 *
 * `text` is the posting body where the provider publishes one - it is what the
 * signals are read from, and its absence is why BambooHR records carry none.
 */
export const PROVIDERS = {
  greenhouse: {
    url: (slug) => `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`,
    list: (data) => data.jobs,
    total: (data) => data.meta?.total ?? data.jobs.length,
    record: (job, entry) => ({
      id: `ats:gh:${entry.slug}:${job.id}`,
      company: strip(job.company_name || '') || entry.name || entry.slug,
      title: strip(job.title || ''),
      url: job.absolute_url || null,
      country: strip(job.location?.name || '') || null,
      format: null,          // the provider states none; the location string is not one
      salaryLabel: 'not stated',
      date: iso(job.first_published || job.updated_at),
      text: htmlText(job.content || ''),
    }),
  },
  ashby: {
    url: (slug) => `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=true`,
    list: (data) => data.jobs,
    total: (data) => data.jobs.length,   // the provider states no total of its own
    record: (job, entry) => ({
      id: `ats:ashby:${entry.slug}:${job.id}`,
      company: entry.name || entry.slug,
      title: strip(job.title || ''),
      // The posting page rather than the bare form: both are on the employer's
      // instance, and the one with the description is the one worth opening.
      url: job.jobUrl || job.applyUrl || null,
      country: strip(job.location || '') || null,
      format: job.workplaceType || null,
      salaryLabel: strip(job.compensation?.compensationTierSummary || '') || 'not stated',
      date: iso(job.publishedAt),
      text: job.descriptionPlain || '',
    }),
  },
  bamboohr: {
    url: (slug) => `https://${encodeURIComponent(slug)}.bamboohr.com/careers/list`,
    list: (data) => data.result,
    total: (data) => data.meta?.totalCount ?? data.result.length,
    record: (job, entry) => ({
      id: `ats:bamboo:${entry.slug}:${job.id}`,
      company: entry.name || entry.slug,
      title: strip(job.jobOpeningName || ''),
      url: `https://${entry.slug}.bamboohr.com/careers/${job.id}`,
      country: [job.location?.city, job.location?.state].filter(Boolean).join(', ') || null,
      format: job.isRemote ? 'remote' : null,
      salaryLabel: 'not stated',
      date: null,            // the list states no publication date
      text: '',              // and no body: the detail endpoint is one request per posting
    }),
  },
};

export const PROVIDER_NAMES = Object.keys(PROVIDERS);

/**
 * A watchlist record in the shape every adapter returns.
 *
 * `applyAtEmployer` is TRUE and is not a guess: the url addresses the employer's
 * own instance of their own applicant tracking system, which is the thing a job
 * board's apply button either reaches or does not.
 *
 * `locationVerified` is false like everywhere else. The employer stating the
 * place is a better source than a board restating it, and it is still a claim
 * nobody here checked.
 */
export function normalize(raw, entry, signalConfig = {}) {
  const { text, ...job } = raw;
  const found = text ? detectSignals(text, signalConfig) : [];
  return {
    ...job,
    source: 'ats',
    provider: entry.provider,
    applyAtEmployer: true,
    locationVerified: false,
    // No provider states a period beside an amount, so nothing enters a field
    // named after one - the same bargain every other adapter here strikes.
    salaryMinUsd: null,
    skills: [],
    hasRussianRoots: false,
    visa: false,
    signals: found,
    note: signalNote(found),
  };
}

async function get(entry) {
  const provider = PROVIDERS[entry.provider];
  http.countRequest();
  // Never followed: one provider answers an unknown company with a redirect to
  // its own marketing site, and following it turns "no such instance" into a
  // parse failure or, worse, into an empty list that reads as "nothing open".
  const res = await fetch(provider.url(entry.slug), { headers: http.headers(), redirect: 'manual' });
  if (res.status === 404 || (res.status >= 300 && res.status < 400)) {
    throw new Error(`ats: ${entry.provider} has no board "${entry.slug}" (HTTP `
      + `${res.status}) - the slug is the company's own instance name, and a `
      + 'wrong one is not an empty company');
  }
  if (!res.ok) throw new Error(`ats: HTTP ${res.status} from ${entry.provider} for "${entry.slug}"`);
  const data = await res.json();
  const list = provider.list(data);
  if (!Array.isArray(list)) {
    throw new Error(`ats: ${entry.provider} answered without a list of postings `
      + `for "${entry.slug}" - the API shape changed`);
  }
  return { list, total: provider.total(data) };
}

/** Case-insensitive title match. The providers offer no search of their own. */
const titleMatches = (title, query) => title.toLowerCase().includes(query.toLowerCase());

/**
 * Read the watchlist.
 *
 * `maxCompanies` is what `pages` means for this source: a walk over companies
 * rather than over pages, bounded the same way and for the same reason.
 *
 * `query` is applied HERE, on the titles, because no provider offers a search
 * parameter. It is reported as `filtered` rather than folded into the totals: a
 * local filter and a board's own answer are different facts about a run.
 */
/**
 * Read each company, and let one refusal cost only that company.
 *
 * A watchlist is a list of independent employers: a slug that has gone stale
 * says nothing about the next one. Throwing lost every company already read and
 * never reached the rest, so one wrong entry took the whole source down.
 */
async function walk(read, onCompany) {
  const errors = [];
  const companies = [];
  for (const [index, entry] of read.entries()) {
    try {
      const { list, total } = await get(entry);
      companies.push({ provider: entry.provider, slug: entry.slug, found: total });
      onCompany(entry, list);
    } catch (err) {
      errors.push({ provider: entry.provider, slug: entry.slug, message: err.message });
    }
    if (index < read.length - 1) await http.throttle();
  }
  return { errors, companies };
}

/** Totals over the companies that answered, and whether that was all of them. */
function summarise(out, { errors, companies }, watchlist, read) {
  out.found = companies.reduce((n, c) => n + c.found, 0);
  out.companies = companies;
  out.complete = read.length === watchlist.length && errors.length === 0;
  if (errors.length) out.errors = errors;
  return out;
}

export async function search({ watchlist = [], query = '', signalConfig = {} } = {}, maxCompanies = 10) {
  const out = [];
  const read = watchlist.slice(0, maxCompanies);
  let filtered = 0;
  const walked = await walk(read, (entry, list) => {
    for (const raw of list) {
      const job = normalize(PROVIDERS[entry.provider].record(raw, entry), entry, signalConfig);
      if (query && !titleMatches(job.title, query)) { filtered += 1; continue; }
      out.push(job);
    }
  });
  summarise(out, walked, watchlist, read);
  if (query) out.filtered = filtered;
  return out;
}

export async function count({ watchlist = [] } = {}, maxCompanies = 10) {
  const read = watchlist.slice(0, maxCompanies);
  const walked = await walk(read, () => {});
  return summarise({}, walked, watchlist, read);
}
