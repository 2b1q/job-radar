// adapters/agilefluent.mjs - AgileFluent job board HTTP client (SRP: network only, no state).
// No external deps: uses built-in fetch (Node 18+).

import { createHttp, LANGS, pick, USER_AGENTS } from './_shared/http.mjs';
import { pageRepeatGuard } from './_shared/guards.mjs';
import { detectSignals, signalNote } from './_shared/signals.mjs';

const BASE = 'https://jobboard.agilefluent.ru/api';
const ORIGIN = 'https://jobboard.agilefluent.ru';
// Search vocabulary discovered from the site's own zod schema.
export const GRADES = ['intern', 'junior', 'middle', 'senior', 'lead']; // "principal" crashes their API (500)
export const SINCE = ['24h', '3d', 'week', '2w', 'month'];
const PAGE_SIZE = 50;

// Its own timings: this board has answered 429 under load, which the shared
// helper cannot know for it.
const http = createHttp({ throttleMs: 3500, jitterMs: 2500 });

export const requestCount = http.requestCount;
// The per-call ceiling is opened by the caller: a tool call is bounded, a smoke
// script is not.
export const beginCall = http.beginCall;
export const endCall = http.endCall;

function browserHeaders() {
  const ua = pick(USER_AGENTS);
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': pick(LANGS),
    Origin: ORIGIN,
    Referer: ORIGIN + '/',
    'User-Agent': ua,
  };
  if (ua.includes('Chrome/')) {
    const v = ua.match(/Chrome\/(\d+)/)[1];
    headers['sec-ch-ua'] = `"Chromium";v="${v}", "Not?A_Brand";v="24"`;
    headers['sec-ch-ua-mobile'] = '?0';
    headers['sec-ch-ua-platform'] = ua.includes('Windows') ? '"Windows"' : ua.includes('Mac') ? '"macOS"' : '"Linux"';
    headers['Sec-Fetch-Site'] = 'same-origin';
    headers['Sec-Fetch-Mode'] = 'cors';
    headers['Sec-Fetch-Dest'] = 'empty';
  }
  return headers;
}

// An unrecognised role crashes /jobs/count and not /jobs/search - the board
// falling over, not refusing. Measurements in notes/agilefluent.md.
function failed(path, status, body, text) {
  const page = text.trim().startsWith('<') ? ' (an HTML error page, not JSON)' : '';
  const roles = body?.filters?.roles;
  if (status === 500 && Array.isArray(roles) && roles.length) {
    return new Error(`af: ${path} answered HTTP 500${page}. This endpoint crashes `
      + 'on a role it does not have, and the board publishes no list of the ones '
      + `it does. Roles sent: [${roles.join(', ')}]. /jobs/search answers the same `
      + 'filters, so a search still works and only the total is lost - drop or '
      + 'correct a role in the profile to get it back');
  }
  return new Error(`af: ${path} answered HTTP ${status}${page}`);
}

async function post(path, body) {
  for (let attempt = 0; attempt < 2; attempt++) {
    http.countRequest();
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: browserHeaders(),
      body: JSON.stringify(body),
    });
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 65_000)); continue; }
    // Which endpoint answered is half the diagnosis: one has been seen crashing
    // while the other was healthy.
    if (!res.ok) throw failed(path, res.status, body, await res.text().catch(() => ''));
    return res.json();
  }
  throw new Error(`af: ${path} rate limited twice, giving up`);
}

// The "url" field is a JWT whose payload holds the real vacancy link. One
// undecodable token is a null url on one job - the field is nullable and the
// rest of the record is still worth having. Every token failing is a different
// event: the encoding changed, and a run of apply-less vacancies would otherwise
// look like a board that stopped filling the field. That case is caught in
// `search`, where the whole page can be seen at once.
function decodeJobUrl(token) {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64').toString('utf8'));
    return payload.url || null;
  } catch { return null; }
}

// The board puts the posting's own minimum into `salaryMinUsd` whatever currency
// the posting quotes: `JPY8010–16000k / год` arrives as 8010000, and a sort by
// money then ranks yen above dollars. The currency is stated in the label and
// nowhere else, so the label is what decides.
//
// Not converted, and not kept with a caveat: a number in a field called
// salaryMinUsd is USD or it is nothing. The figure is not lost - the label
// carries it, in the currency it was written in - which is the same bargain the
// other two adapters strike, one quoting roubles and the other only filling the
// field when the board says USD.
const USD_LABEL = /^\s*(?:\$|USD\b)/;

/** The board's minimum, kept only where the board is quoting USD. */
export function usdMin(salaryLabel, salaryMinUsd) {
  if (salaryMinUsd == null) return null;
  // No label is no currency. A bare number could be any of the eleven this board
  // has been seen to quote, and USD is a guess, not a default.
  return USD_LABEL.test(String(salaryLabel ?? '')) ? salaryMinUsd : null;
}

// Normalize a raw API job into the compact shape we expose and store.
function normalize(job, signalConfig = {}) {
  // The board summarises every posting, so signals have text to read here. It is
  // the board's precis, not the employer's words - notes/agilefluent.md.
  const found = detectSignals(job.description || '', signalConfig);
  return {
    // Bare id, deliberately: the store already holds these under the plain
    // number with statuses attached. Prefixing would orphan every mark.
    // TalentMove ids carry a `tm:` prefix, so the two can never collide.
    id: String(job.id),
    source: 'af',
    company: job.companyName,
    title: job.title,
    url: decodeJobUrl(job.url),
    // Unknown, deliberately. The link this board carries is sometimes an
    // employer's own ATS and sometimes another aggregator - LinkedIn, or the
    // other board in this repo - and a host list that decides which is which
    // would be a guess dressed as a fact. Null is "nobody checked".
    applyAtEmployer: null,
    country: job.country,
    locationVerified: false,
    format: job.format,
    salaryLabel: job.salaryLabel,
    salaryMinUsd: usdMin(job.salaryLabel, job.salaryMinUsd ?? null),
    hasRussianRoots: !!job.hasRussianRoots,
    visa: !!job.visa,
    skills: Array.isArray(job.skills) ? job.skills : [],
    date: job.createdAtIso ? job.createdAtIso.slice(0, 10) : null,
    signals: found,
    note: signalNote(found),
  };
}

export async function count(filters) {
  const { totalCount } = await post('/jobs/count', { filters });
  // `search` reports this as the board's own total, so an envelope that stopped
  // carrying it would leave "how many are there" reading as zero or as absent,
  // next to a collected count that looks like an answer.
  if (!Number.isInteger(totalCount)) {
    throw new Error('af: /jobs/count answered without a totalCount - the count '
      + 'envelope changed');
  }
  return totalCount;
}

/**
 * The board's own total, or the reason there isn't one.
 *
 * Never fatal: `/jobs/count` and `/jobs/search` have been measured disagreeing
 * about the same filters, and a total is worth one request but not the source.
 */
async function totalOrReason(filters) {
  try {
    return { total: await count(filters) };
  } catch (err) {
    return { total: null, reason: err.message };
  }
}

// Guarded because paging is a request a board can ignore in silence, and the
// store's dedup then swallows the repeats.
export async function search(filters, maxPages = 5, { signalConfig = {} } = {}) {
  const out = [];
  const noRepeat = pageRepeatGuard('af');
  const { total, reason } = await totalOrReason(filters);
  let reachedEnd = false;
  for (let page = 1; page <= maxPages; page++) {
    const { data, hasMore } = await post('/jobs/search', { filters, pagination: { page, limit: PAGE_SIZE } });
    // Promised more and delivered nothing: the shape moved, or paging broke.
    // An empty last page with hasMore false is an ordinary end of results.
    if (!data.length && hasMore) {
      throw new Error(`af: page ${page} came back empty while the board says there `
        + 'is more - paging or the response shape changed');
    }
    noRepeat(data[0]?.id, page);
    const jobs = data.map((job) => normalize(job, signalConfig));
    // A vacancy without a link cannot be applied to, so a page of them is a
    // parsing failure wearing the clothes of an ordinary result.
    if (jobs.length && jobs.every((j) => j.url === null)) {
      throw new Error(`af: page ${page} has ${jobs.length} jobs and not one usable `
        + 'url - the token that carries the vacancy link changed shape');
    }
    out.push(...jobs);
    if (!hasMore) { reachedEnd = true; break; }
    if (page < maxPages) await http.throttle();
  }
  // A bare null `found` reads as a board that states no totals, so the reason
  // travels with it.
  out.found = total;
  out.complete = total != null ? out.length >= total : reachedEnd;
  if (reason) out.foundUnavailable = reason;
  return out;
}
