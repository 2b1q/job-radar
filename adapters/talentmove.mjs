// adapters/talentmove.mjs - TalentMove source (SRP: one job board, nothing else).
//
// Endpoint: GET /wp-json/tm/v1/filtered-jobs
// It answers with a JSON envelope whose `html` field holds server rendered
// cards, plus the counters we actually need for paging:
//   { html, found_posts, max_pages, current_page, filter_counts }
//
// Returns the shared shape, so the store and the tools do not care which board a
// vacancy came from.
//
// The session cookie lives in TM_COOKIE, never in the repository: it is an
// account someone pays for, not a setting.

import { normKey, strip } from './_shared/text.mjs';
import { assertParsed, pageRepeatGuard } from './_shared/guards.mjs';
import { createHttp } from './_shared/http.mjs';

const BASE = 'https://talent-move.ru/wp-json/tm/v1/filtered-jobs';
// The slowest of the three, on purpose. This is the board behind a paid account:
// it refused an address outright after roughly thirty requests in an hour once,
// and answered 150 in a session without complaint another time. Losing the
// session costs more than any single answer is worth, so the pace here is set by
// the worse of the two observations rather than the better.
const http = createHttp({
  throttleMs: 5000,
  jitterMs: 4000,
  baseHeaders: {
    'accept': '*/*',
    'referer': 'https://talent-move.ru/jobs/',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
  },
});

export const requestCount = http.requestCount;
// The per-call ceiling is opened by the caller: a tool call is bounded, a smoke
// script is not.
export const beginCall = http.beginCall;
export const endCall = http.endCall;

// The session is an account, not a setting, so it is read at call time from the
// environment and never captured into a header table at import.
const browserHeaders = () =>
  http.headers(process.env.TM_COOKIE ? { cookie: process.env.TM_COOKIE } : {});



// One card, in the shape every adapter returns.
// The card prints one figure in thousands of roubles a month - "510K" - and
// that is the only shape this board has been observed to use, across every row
// in the store. An unrecognised shape returns null rather than a number in
// guessed units: a salary whose unit is inferred is exactly the "number without
// its conditions" this repo refuses to store, and it would sort against figures
// that mean something else.
function salaryK(amount) {
  const k = String(amount ?? '').match(/^\s*(\d[\d\s\u00a0]*)\s*[KkКк]\b/);
  if (!k) return null;
  return Number(k[1].replace(/[\s\u00a0]/g, '')) || null;
}

function parseCard(card) {
  const link = card.match(/<a class="card-job__link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
  if (!link) return null;

  const salary = card.match(/data-salary-type="(\w+)"[^>]*>([\s\S]*?)<\/div>/);
  const company = card.match(/class="card-job__company"[^>]*>([\s\S]*?)<\/div>/);
  const tags = [...card.matchAll(/class="job-tags__tag[^"]*"[^>]*>([\s\S]*?)<\/li>/g)].map((m) => strip(m[1]));
  const feats = [...card.matchAll(/class="card-job__feature[^"]*--(\w+)"[^>]*>\s*<span>([\s\S]*?)<\/span>/g)];
  const format = feats.find((f) => f[1] === 'format');
  const location = feats.find((f) => f[1] === 'location');
  const age = card.match(/class="time-ago__full"[^>]*>([\s\S]*?)<\/span>/);

  const url = link[1].replace(/\\\//g, '/');
  const id = (url.match(/-(\d+)\/?$/) || [])[1];
  if (!id) return null;

  // The site shows either its own estimate or a figure from the posting.
  // Keeping the kind next to the number: an estimate is not a salary.
  const kind = salary ? salary[1] : null;
  const amount = salary ? strip(salary[2]) : null;

  return {
    id: `tm:${id}`,
    source: 'tm',
    // `@` and then the name, but the name is sometimes wrapped in a tag and
    // stripping that tag leaves a space where it was - so the handle marker
    // takes the whitespace behind it with it. " AlphaCo" and "AlphaCo" are one
    // employer; only `normKey` was hiding the difference, and the store is not
    // the place to clean up a board's punctuation.
    company: company ? strip(company[1]).replace(/^@\s*/, '') || null : null,
    title: strip(link[2]),
    url,
    country: location ? strip(location[2]) : null,
    format: format ? strip(format[2]) : null,
    salaryLabel: amount ? `${amount} RUB/mo (${kind === 'verified' ? 'from posting' : 'site estimate'})` : 'not stated',
    salaryKind: kind,
    salaryValue: salaryK(amount),
    salaryMinUsd: null,
    skills: tags,          // TalentMove fills these, AgileFluent leaves them empty
    hasRussianRoots: false,
    visa: false,
    date: age ? strip(age[1]) : null,
  };
}

function parseCards(html, foundPosts) {
  const cards = html.split('<article class="card-job">').slice(1);
  const out = [];
  for (const c of cards) {
    const job = parseCard(c);
    if (job) out.push(job);
  }
  // A layout change would leave us with zero cards and a cheerful "no new jobs".
  // Silent empty is the failure we keep hunting, so make it loud instead.
  assertParsed(out.length, foundPosts, 'tm');
  return out;
}

// Exported for the tests: card parsing is pure, the fetching around it is not.
// The markup of a board is the part that changes without warning, so it is the
// part that gets pinned.
export { parseCard, parseCards, salaryK };

async function get(params, page) {
  // `pg`, not `page`. The board ignores `page` in silence and answers with the
  // first page every time - which is invisible downstream, because the store
  // deduplicates the repeats and a four page search reports "80 found, 20 new"
  // as if that were the dedup working. Confirmed: page=2 returns the same first
  // ids as page=1, pg=2 does not.
  const qs = new URLSearchParams({ ...params, pg: String(page) });
  http.countRequest();
  const res = await fetch(`${BASE}?${qs}`, { headers: browserHeaders() });
  if (res.status === 401 || res.status === 403) {
    // Name the category. A refusal has been seen to depend on more than the
    // cookie - the same category answered 200 anonymously in one window and 401
    // in another - so "which request was refused" is the first thing worth
    // knowing, and an error that only blames the session sends the reader to the
    // wrong place.
    const where = params.category ? `category ${params.category}` : 'no category';
    throw new Error(`tm: ${res.status} on ${where}, page ${page}. Set TM_COOKIE, `
      + 'or wait: the board also refuses after repeated anonymous requests');
  }
  if (res.status === 400) {
    // Not an auth failure, whatever it looks like.
    throw new Error('tm: HTTP 400 - the endpoint requires a category or a search '
      + 'query, and says so in the body');
  }
  if (!res.ok) throw new Error(`tm: HTTP ${res.status}`);
  return res.json();
}

// Slugs for the board's own `skills` parameter.
//
// This is the half of the tag problem the board can solve itself: `skills`
// filters on the FULL tag list, not on the few tags a card shows, so pushing a
// group into the query costs one request instead of one per miss and loses
// nothing. Cards the client filter drops are returned by the board, tags and
// all - the measurement is in notes/talentmove.md.
//
// The endpoint needs `q` AND `category` together. `q` alone is refused, and
// `category` alone answers `{"results":[]}` - an empty answer that looks like
// "no such skill" rather than "you asked wrong".
const SKILLS_URL = 'https://talent-move.ru/wp-json/tm/v1/search-skills';
const slugCache = new Map();

// The endpoint answers a prefix search, so "Go" brings back Golang, Google Ads
// and Governance. Only an exact label match is the slug that was asked for; a
// near miss silently filters on something else entirely.
export function pickSlug(results, label) {
  const want = normKey(label);
  for (const r of results || []) {
    if (normKey(String(r.label ?? '').replace(/\s*\(\d+\)\s*$/, '')) === want) return r.value;
  }
  return null;
}

/**
 * Resolve tag labels to board slugs, within a category.
 * Returns { slugs, unresolved }: an unresolved label is reported rather than
 * dropped, because this board drops an unknown member of a `skills` list in
 * silence and the query then narrows to something the caller never asked for.
 */
export async function skillSlugs(labels, category) {
  const slugs = [];
  const unresolved = [];
  for (const label of labels) {
    const key = `${category}|${normKey(label)}`;
    if (!slugCache.has(key)) {
      const qs = new URLSearchParams({ q: label, category: String(category) });
      http.countRequest();
      const res = await fetch(`${SKILLS_URL}?${qs}`, { headers: browserHeaders() });
      if (!res.ok) throw new Error(`tm: HTTP ${res.status} resolving skill "${label}"`);
      const data = await res.json();
      slugCache.set(key, pickSlug(data.results, label));
      await http.throttle();
    }
    const slug = slugCache.get(key);
    if (slug) slugs.push(slug); else unresolved.push(label);
  }
  return { slugs, unresolved };
}

// Re-checking a card against its job page costs one request each, so the cap is
// a constant rather than a number buried in the loop: it is the knob that trades
// budget for completeness, and the caller is told how much went unchecked
// instead of being handed a count that looks complete. How badly cards are
// truncated is measured in notes/talentmove.md.
export const MAX_TAG_LOOKUPS = 25;

const JOB_TAGS = /<ul class="job-tags">([\s\S]*?)<\/ul>/;
const INDUSTRY = /industry\/[^']*'>([^<]+)</;

export async function fetchTags(url) {
  http.countRequest();
  const res = await fetch(url, { headers: browserHeaders() });
  if (!res.ok) throw new Error(`tm: HTTP ${res.status} fetching tags for ${url}`);
  const html = await res.text();
  const block = (html.match(JOB_TAGS) || [])[1] || '';
  const tags = [...block.matchAll(/job-tag\/[^"]*">([^<]+)</g)].map((m) => strip(m[1]));
  const industry = (html.match(INDUSTRY) || [])[1];
  return [industry, ...tags].filter(Boolean).map(strip);
}

/**
 * Re-check the cards that did not match, against their full tag lists.
 * Returns the enriched matches and how much of the remainder went unchecked, so
 * the caller can say "5 found" or "5 found, 40 not checked" rather than pretend.
 */
export async function deepenByTags(misses, wanted, limit = MAX_TAG_LOOKUPS) {
  const found = [];
  const checked = misses.slice(0, limit);
  for (const [i, job] of checked.entries()) {
    const full = await fetchTags(job.url);
    if (filterByTags([{ ...job, skills: full }], wanted).length) {
      found.push({ ...job, skills: full });
    }
    if (i < checked.length - 1) await http.throttle();
  }
  return { found, checked: checked.length, unchecked: misses.length - checked.length };
}

/**
 * Keep cards whose tags intersect `wanted`. Exact match on normalised tags,
 * never a substring: "ai" must not pull in "Airflow".
 *
 * Intersection, not containment: an idea like "AI" is spread over several
 * interchangeable tags, and requiring all of them would match nothing.
 *
 * A card MATCH is trustworthy; a card MISS is not, because the card shows only
 * the first few tags of a posting. This is the second route into an
 * intersection, next to the board's own query - see `intersectById`.
 */
export function filterByTags(jobs, wanted = []) {
  const want = new Set(wanted.map(normKey).filter(Boolean));
  if (!want.size) return jobs;
  return jobs.filter((j) => (j.skills || []).some((t) => want.has(normKey(t))));
}

// A `verified` figure is supposed to come from the posting itself, and the whole
// point of the label is that it can be trusted where an estimate cannot. It is
// not always true: three postings in one slice carried "from posting" at 68K
// against a slice median near 500K, which is the board mis-parsing a range, not
// an employer offering that.
//
// Not corrected, because there is nothing to correct it to - only marked. A
// label that is wrong in the direction of MORE confidence is the worst kind, so
// the doubt is put where the number is read rather than left in a note nobody
// opens.
const SUSPECT_RATIO = 0.25;

// Returns new objects rather than editing the ones it was given: the verdict
// depends on the whole slice, so the same job marked in one slice and unmarked
// in another would otherwise carry whichever label was computed last.
export function flagSuspiciousSalaries(jobs) {
  const values = jobs.map((j) => j.salaryValue).filter((v) => v > 0).sort((a, b) => a - b);
  if (values.length < 8) return jobs;   // too few to have a distribution
  const median = values[Math.floor(values.length / 2)];
  const floor = Math.round(median * SUSPECT_RATIO);
  return jobs.map((job) => {
    if (job.salaryKind !== 'verified' || !job.salaryValue) return job;
    if (job.salaryValue >= median * SUSPECT_RATIO) return job;
    return {
      ...job,
      salarySuspect: true,
      salaryLabel: job.salaryLabel.replace(
        '(from posting)',
        `(from posting - SUSPECT: ${floor}K+ expected against a slice median of `
        + `${median}K, most likely a mis-parsed range)`),
    };
  });
}

export async function search(params = { format: 'fully-remote' }, maxPages = 3,
                             { requireSkills = [], deepen = false } = {}) {
  const out = [];
  const noRepeat = pageRepeatGuard('tm');
  let pages = maxPages;
  let reported = null;
  for (let page = 1; page <= pages; page++) {
    const data = await get(params, page);
    if (page === 1) {
      pages = Math.min(maxPages, data.max_pages || 1);
      reported = data.found_posts ?? null;
    }
    const cards = parseCards(data.html || '', data.found_posts || 0);

    // A page that starts where the previous one started is the same page again.
    // Paging broke once already by sending a parameter name the board ignores,
    // and nothing downstream noticed: the store deduplicated the repeats and the
    // run looked like a healthy one with a lot of already-seen jobs.
    noRepeat(cards[0]?.id, page);

    out.push(...cards);
    if (page < pages) await http.throttle();
  }
  const all = flagSuspiciousSalaries(out);
  // What the board said the query matched, next to what was actually collected.
  // A page loop that stopped early is not an empty niche, and the difference is
  // the only thing that tells them apart.
  all.found = reported;
  if (!requireSkills.length) return all;

  const hits = filterByTags(all, requireSkills);
  if (!deepen) return hits;

  // Cards that missed may simply have had the deciding tag cut off - measured at
  // 20 of 20 cards truncated. Which is why the board did the narrowing above
  // when it could: what reaches here is already a short list, so the cap is a
  // safety net rather than the mechanism.
  const missed = all.filter((j) => !hits.includes(j));
  const { found, checked, unchecked } = await deepenByTags(missed, requireSkills);
  const result = [...hits, ...found];
  result.tagLookups = { checked, unchecked };
  return result;
}

/**
 * An intersection of tag groups, computed from board-side queries.
 *
 * The board's `skills` is a UNION, so "Node AND AI" cannot be one query - but it
 * can be two, intersected on ids. That matters because each side is matched
 * against the FULL tag list of a posting, while a card shows at most four tags:
 * measured on category 903, every one of 20 cards was truncated, and the card
 * filter missed 2 of the 3 true infra matches that the board itself returned.
 *
 * So the intersection happens on ids, and no card tag decides anything.
 *
 * Each side reports `found` against how much was collected: an intersection of
 * two truncated sides is a lower bound, and saying so is the difference between
 * "nothing there" and "we did not look at all of it".
 */
export async function searchIntersect(params, groups, maxPages = 3) {
  if (!params.category) throw new Error('tm: searchIntersect needs a category - '
    + 'the slug lookup is scoped to one');
  if (groups.length < 2) throw new Error('tm: an intersection needs two groups; '
    + 'for one, pass its slugs as `skills` and call search');

  const sides = [];
  for (const group of groups) {
    const { slugs, unresolved } = await skillSlugs(group, params.category);
    if (!slugs.length) throw new Error(`tm: none of [${group.join(', ')}] is a `
      + `known skill in category ${params.category} - the query would fall back `
      + 'to the whole category and look like a result');
    const jobs = await search({ ...params, skills: slugs.join(',') }, maxPages);
    sides.push({ labels: group, slugs, unresolved, jobs, found: jobs.found,
                 collected: jobs.length,
                 complete: jobs.found != null && jobs.length >= jobs.found });
  }

  return intersectById(sides);
}

/**
 * The intersection itself, kept pure so it can be tested without a board.
 * `complete` is false as soon as one side was paged short: the answer is then a
 * lower bound, and a lower bound reported as a count reads as "the niche is
 * empty" when it means "we stopped reading".
 */
export function intersectById(sides) {
  const [first, ...rest] = sides;
  const others = rest.map((side) => ({
    ids: new Set(side.jobs.map((j) => j.id)),
    labels: side.labels || [],
  }));

  // Two routes into the intersection, because the board's `skills` covers only
  // one of the two taxonomies a card shows. The first tag on a card is an
  // INDUSTRY, and `skills=ai` does not match it: a posting tagged with the AI
  // industry is invisible to the board-side query and visible on the card. Both
  // routes are sound in the direction that matters - a tag the board reports and
  // a tag printed on the card are each a fact - so a posting qualifies by either.
  const result = first.jobs.filter((job) => others.every(
    // filterByTags keeps everything when asked for nothing, so the card route is
    // only open when there is actually a label to match - otherwise a side with
    // no labels would admit the entire other side.
    ({ ids, labels }) => ids.has(job.id)
      || (labels.length > 0 && filterByTags([job], labels).length > 0)));

  result.sides = sides.map(({ labels, slugs, unresolved, found, collected, complete }) =>
    ({ labels, slugs, unresolved, found, collected, complete }));
  result.complete = sides.every((s) => s.complete);
  return result;
}

export async function count(params = { format: 'fully-remote' }) {
  const data = await get(params, 1);
  return { found: data.found_posts, pages: data.max_pages, counts: data.filter_counts };
}
