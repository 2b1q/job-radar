// web3career.mjs - web3.career source (SRP: one job board, nothing else).
//
// Built on schema.org/JobPosting embedded in the page, not on the markup. Job
// boards carry it for Google Jobs, and it is a contract with a third party
// rather than a private layout: `title`, `hiringOrganization`, `datePosted`,
// `baseSalary` with currency and range, `jobLocation`, `applicantLocationRequirements`.
// A redesign moves classes around; it does not usually break this.
//
// Reconnaissance, recorded because half the work on the previous board went into
// discovering that a parameter was not named what the markup said:
//   robots.txt   allows everything except /metrics*, and declares a sitemap
//   JSON-LD      present on job pages (12 blocks: the job plus related ones) and
//                on listing pages (15 blocks, one per row)
//   listings     /{tag}-jobs, e.g. /node-jobs, /typescript-jobs. `/nodejs-jobs`
//                and `/node-js-jobs` both 302 to /404 - the slug is not derivable
//   paging       ?page=N, and page 2 genuinely differs from page 1
//   sitemap      an index of four sub-sitemaps
//   session      none needed; every read here is anonymous
//
// Two things the JSON-LD does NOT carry, so they come from the row markup:
//   the job id and url  - hence the pairing, and the guard that checks it
//   the tags            - `occupationalCategory` is present but always empty
//   whether the salary is the board's estimate - marked by a star in the markup
//
// Returns the same normalized shape as the other adapters, so the store and the
// tools do not care which board a vacancy came from.

import { normKey, strip } from './_shared/text.mjs';
import { pageRepeatGuard } from './_shared/guards.mjs';
import { createHttp } from './_shared/http.mjs';

const BASE = 'https://web3.career';
// Its own timings: this board has shown no limit yet, which is a reason to be
// careful rather than a licence, so it sits close to the one that did.
const http = createHttp({
  throttleMs: 3500,
  jitterMs: 2500,
  baseHeaders: {
    'accept': 'text/html,application/xhtml+xml',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'same-origin',
  },
});

export const requestCount = http.requestCount;
// The per-call ceiling is opened by the caller: a tool call is bounded, a smoke
// script is not.
export const beginCall = http.beginCall;
export const endCall = http.endCall;
const browserHeaders = () => http.headers();

// The board mangles the titles it RENDERS: the row for "Platform Engineer, Core
// Systems" reads "Platm Engineer Core Systems" - it deletes the substring "for"
// wherever it appears, inside words included. So the structured title is the
// authoritative one, and the rendered one can only be checked for consistency,
// not equality.
//
// Since the mangling only ever removes characters, the rendered title must be a
// SUBSEQUENCE of the structured one. That still catches a misalignment - a
// different job's title is not a subsequence of this one - while tolerating
// whatever the board decides to delete next.
function isSubsequence(needle, haystack) {
  let i = 0;
  for (const ch of haystack) if (ch === needle[i]) i += 1;
  return i === needle.length;
}

export function parsePostings(html) {
  const out = [];
  for (const m of html.matchAll(/type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    let data;
    try {
      data = JSON.parse(m[1]);
    } catch {
      continue;   // the page carries other, sometimes malformed, blocks
    }
    for (const item of Array.isArray(data) ? data : [data]) {
      if (item && item['@type'] === 'JobPosting') out.push(item);
    }
  }
  return out;
}

export function parseRows(html) {
  const rows = [];
  for (const m of html.matchAll(/<tr[^>]*\bdata-jobid=(\d+)[\s\S]*?(?=<tr[^>]*\bdata-jobid=|<\/tbody>)/g)) {
    const chunk = m[0];
    const href = (chunk.match(/href="(\/[^"?#]*\/\d+)"/) || [])[1];
    const title = (chunk.match(/<h2[^>]*>([\s\S]*?)<\/h2>/) || [])[1];
    const company = (chunk.match(/<h3[^>]*>([\s\S]*?)<\/h3>/) || [])[1];
    const location = (chunk.match(/job-loc-pin[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/) || [])[1];
    const salary = (chunk.match(/class="[^"]*text-salary[^"]*"[^>]*>([\s\S]*?)<\/p>/) || [])[1] || '';
    // Tags live in their own cell as links to other listings.
    const tagCell = (chunk.match(/class=cell-tags[\s\S]*$/) || [''])[0];
    const tags = [...tagCell.matchAll(/href="\/[a-z0-9-]+-jobs"[^>]*>([\s\S]*?)<\/a>/g)]
      .map((t) => strip(t[1])).filter(Boolean);
    rows.push({
      id: m[1],
      url: href ? BASE + href : null,
      title: strip(title || ''),
      company: strip(company || '') || null,
      location: strip(location || '') || null,
      // A star means the board guessed. Same distinction the other board makes,
      // and worth keeping for the same reason: an estimate is not a salary.
      salaryEstimated: /estimated_star/.test(salary),
      salaryText: strip(salary),
      tags,
    });
  }
  return rows;
}

function money(posting) {
  const s = posting.baseSalary || {};
  const v = s.value || {};
  const min = Number(v.minValue) || null;
  const max = Number(v.maxValue) || null;
  return { currency: s.currency || null, min, max, unit: v.unitText || null };
}

/**
 * Pair the structured postings with the rows they belong to.
 *
 * The JSON-LD carries no id and no url, and the blocks sit in one run at the
 * foot of the page rather than inside the rows - so the only link is order.
 * Order is checked rather than trusted: a silent misalignment would attach every
 * job to its neighbour's id, and therefore to the wrong url and the wrong dedup
 * key, while looking perfectly healthy.
 */
export function pair(postings, rows) {
  if (!postings.length || !rows.length) return [];
  if (postings.length !== rows.length) {
    throw new Error(`w3: ${postings.length} structured postings against ${rows.length} `
      + 'rows - the page layout changed and pairing them by order is no longer safe');
  }
  return postings.map((p, i) => {
    const row = rows[i];
    if (!isSubsequence(normKey(row.title), normKey(p.title))) {
      throw new Error(`w3: posting ${i} is "${strip(p.title)}" while row ${i} is `
        + `"${row.title}" - the two lists are out of step and every id after this `
        + 'one would be wrong');
    }
    const { currency, min, max, unit } = money(p);
    // The row's location cell is sometimes just punctuation left over from a
    // template, and a country of "," is worse than no country: it reads as data.
    const meaningful = (v) => (v && /[\p{L}\p{N}]/u.test(v) ? v.replace(/^[\s,]+|[\s,]+$/g, '') : null);
    const where = meaningful(row.location)
      || meaningful(p.jobLocation?.address?.addressLocality)
      || meaningful(p.jobLocation?.address?.addressCountry)
      || meaningful(p.applicantLocationRequirements?.name)
      || null;
    return {
      id: `w3:${row.id}`,
      source: 'w3',
      company: strip(p.hiringOrganization?.name || row.company || '') || null,
      title: strip(p.title || row.title),
      url: row.url,
      country: where,
      format: p.jobLocationType === 'TELECOMMUTE' ? 'remote' : (p.employmentType || null),
      salaryLabel: min
        ? `${Math.round(min / 1000)}K-${Math.round((max || min) / 1000)}K ${currency}/`
          + `${unit === 'YEAR' ? 'year' : String(unit || '').toLowerCase()}`
          + ` (${row.salaryEstimated ? 'site estimate' : 'from posting'})`
        : (row.salaryText || 'not stated'),
      // Filled only when the board states it in USD. Left null rather than
      // converted: a rate-converted figure is invented, and somebody would quote it.
      salaryMinUsd: currency === 'USD' && min ? min : null,
      salaryEstimated: row.salaryEstimated,
      skills: row.tags,
      hasRussianRoots: false,
      visa: false,
      date: p.datePosted ? String(p.datePosted).slice(0, 10) : null,
    };
  });
}

export function parseListing(html) {
  const postings = parsePostings(html);
  const rows = parseRows(html);
  // A layout change would leave zero jobs and a cheerful "nothing new". Silent
  // empty is the failure this project keeps finding, so it is made loud.
  if (rows.length && !postings.length) {
    throw new Error('w3: rows are present but no structured posting parsed - '
      + 'the JSON-LD block changed');
  }
  return pair(postings, rows);
}

async function get(path) {
  http.countRequest();
  const res = await fetch(BASE + path, { headers: browserHeaders(), redirect: 'follow' });
  if (res.status === 404 || res.url.endsWith('/404')) {
    throw new Error(`w3: ${path} does not exist - tag slugs are not derivable, `
      + 'check the listing links on the site');
  }
  if (!res.ok) throw new Error(`w3: HTTP ${res.status} on ${path}`);
  return res.text();
}

/**
 * `tag` is a listing slug without the `-jobs` suffix: node, typescript, golang.
 * Omit it for the whole board.
 */
export async function search({ tag = null } = {}, maxPages = 2) {
  const out = [];
  const noRepeat = pageRepeatGuard('w3');
  for (let page = 1; page <= maxPages; page++) {
    const path = `${tag ? `/${tag}-jobs` : '/'}?page=${page}`;
    const jobs = parseListing(await get(path));
    if (!jobs.length) break;
    // Paging broke silently on the previous board and the store's dedup hid it
    // for weeks. Nothing in the data says "this is the same page again".
    noRepeat(jobs[0].id, page);
    out.push(...jobs);
    if (page < maxPages) await http.throttle();
  }
  return out;
}

export async function count({ tag = null } = {}) {
  const html = await get(`${tag ? `/${tag}-jobs` : '/'}?page=1`);
  // "2,842 Node.js Jobs" - the number is followed by the tag name, not by the
  // word "jobs" directly, and anchoring on "jobs" alone matched "20-jobs" in a
  // url and reported three.
  const total = (html.match(/\b([\d,]{2,})\s+[^<>{}]{0,24}?jobs\b/i) || [])[1] || null;
  return { found: total ? Number(total.replace(/,/g, '')) : null,
           onPage: parseListing(html).length };
}
