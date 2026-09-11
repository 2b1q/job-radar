#!/usr/bin/env node
// server.mjs - MCP server over stdio for several job boards.
// SRP: protocol glue only. HTTP and per board parsing live in adapters/,
// state in store.mjs. Adding a board means writing an adapter, listing it in
// adapters/index.mjs and giving it one entry in DRIVERS below: the schema, the
// dispatch and the per board paragraphs of both tool descriptions are built
// from that table, so nothing else here counts the boards.
//
// Run:  node --experimental-sqlite server.mjs

// Dynamic, for the reason `params.mjs` is below: a plugin install clones this
// repository without installing anything, and a missing dependency reaches the
// operator as a module-resolution stack trace on a transport nobody is reading.
const { McpServer, StdioServerTransport, z } = await Promise.all([
  import('@modelcontextprotocol/sdk/server/mcp.js'),
  import('@modelcontextprotocol/sdk/server/stdio.js'),
  import('zod'),
]).then(([mcp, stdio, zod]) => ({ ...mcp, ...stdio, z: zod.z })).catch(() => {
  console.error('job-radar: dependencies are not installed. Run `npm install` '
    + `(or \`pnpm install\`) in ${import.meta.dirname}, then start the server again. `
    + 'Installing the plugin clones this repository; it does not install its two '
    + 'dependencies for you.');
  process.exit(2);
});

import { statSync } from 'node:fs';

import { ADAPTERS as SOURCES, SOURCE_CODES } from './adapters/index.mjs';
import * as store from './store.mjs';
// Dynamic, so a missing or broken profile reaches the operator as one line
// rather than as a module-loading stack trace on a transport nobody is reading
// yet.
const { CATEGORIES, afFilters, hcParams, profileStatus, resolveTags,
        signalConfig, sinceCutoff, solParams, titleFilter, tmParams, w3Tag,
        watchlist } = await import('./params.mjs')
  .catch((err) => {
    console.error(`job-radar: ${err.message}`);
    process.exit(2);
  });

// The registry is the list of boards; these are the same modules under the
// names the drivers below read them with.
const { af: agilefluent, ats, hc: habrcareer, sol: solana, tm: talentmove,
        w3: web3career } = SOURCES;


const json = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });

const loadedAt = (file) => {
  try { return statSync(file).mtime.toISOString(); } catch { return null; }
};

/**
 * Which build is answering, not only which version: one version string has
 * already covered two different servers, and `profileStatus` reports an mtime
 * beside a name for the same reason.
 */
const BUILD = { version: '2.3.0', mtime: loadedAt(import.meta.filename) };

// The server name is the project; the tool names are not - see CLAUDE.md.
const server = new McpServer({ name: 'job-radar', version: BUILD.version });

const sourceSchema = z.enum(SOURCE_CODES);
const presetSchema = z.enum(['remote', 'ruroots', 'countries', 'anywhere']);
const sinceSchema = z.enum(['24h', '3d', 'week', '2w', 'month']);

/**
 * One entry per board: how to count it, how to search it, and the paragraph the
 * tool descriptions print about it. Every `count` states `found`, so a client
 * reading that name gets it from all six. A `search` that needs more than one
 * call is a function further down.
 */
const DRIVERS = {
  af: {
    label: 'AgileFluent',
    countHelp: 'presets: remote, ruroots (russian-roots companies), countries (the relocation list from '
      + 'the active profile), anywhere. The profile roles and grades go into every request and '
      + 'BOTH CUT SILENTLY: the board leaves role unset on about half its postings and grade on a '
      + 'third, so a non-empty roles or grades discards those before any other filter runs and '
      + 'nothing in the answer says so. roles is not a vocabulary the board publishes - an '
      + 'unrecognised value crashes jobs_count with HTTP 500 rather than returning zero, and the '
      + 'accepted spellings are exact, case and spaces included. Empty lists filter nothing and '
      + 'are the way to see the whole board.',
    searchHelp: 'query is a free-text search that is neither a phrase nor a literal match, and multi-word '
      + 'queries are sent as given - but they narrow very sharply and often to zero (two words '
      + 'survive only where they genuinely sit together in a posting, three words usually return '
      + 'nothing), so start with one word and add another only if the count allows.',
    count: async ({ preset, since, query }) => {
      const total = await agilefluent.count(afFilters({ preset, since, query }));
      return { preset, since, found: total, totalCount: total };
    },
    search: ({ preset, since, query, minSalary, pages }) => agilefluent.search(
      afFilters({ preset, since, query, minSalary }), pages, { signalConfig: signalConfig() }),
  },
  tm: {
    label: 'TalentMove',
    countHelp: 'REQUIRES a category taxonomy id - the board answers HTTP 400 without one, and query is '
      + 'not sent to this board at all, so it is refused here rather than dropped. It also takes '
      + 'skills (slugs from search-skills, comma separated or an array).',
    count: ({ preset, category, skills, date, query }) =>
      talentmove.count(tmRequest({ preset, category, skills, date, query })),
    search: tmSearch,
  },
  // Addressed by tag page rather than by preset: the tag page is this board's
  // taxonomy, and `skills` is where the caller names it.
  w3: {
    label: 'web3.career',
    countHelp: 'ignores presets: it is addressed by tag page, so pass the tag slug as skills. The slugs '
      + 'belong to this board alone; the profile keeps them under skills.w3.',
    searchHelp: 'addressed by tag page - pass the tag slug as skills, which belong to this board alone.',
    count: ({ skills }) => web3career.count({ tag: w3Tag(skills) }),
    search: ({ skills, pages }) => web3career.search({ tag: w3Tag(skills) }, pages),
  },
  sol: {
    label: 'jobs.solana.com',
    countHelp: 'takes one free-text term - pass it as query or as the first skills entry - plus the '
      + 'remote preset.',
    searchHelp: 'one free-text term as query or the first skills entry; it has no date filter, so since '
      + 'is not applied there.',
    // The same one-term rule as a search, and the same duty to say which words
    // were not part of the question.
    count: async ({ preset, skills }) => {
      const { ignored, ...params } = solParams({ preset, skills });
      const counted = await solana.count(params);
      return { ...counted, ...(ignored.length ? { ignoredSkills: ignored } : {}) };
    },
    search: solSearch,
  },
  hc: {
    label: 'career.habr.com',
    countHelp: 'takes free text as query and the remote preset; the profile grades become its '
      + 'qualification filter. It has no date filter, so since is not applied there. Its skills '
      + 'are numeric term ids from /api/frontend/suggestions/skills?term=<word>, not the slugs it '
      + 'displays - a slug returns a silent zero.',
    searchHelp: 'russian-language product companies; free text as query, remote preset. Like sol it has '
      + 'NO date filter, so since is echoed in the answer and not applied - the results are '
      + 'whatever the board sorts newest first. skills are its own numeric term ids, not the '
      + 'slugs the board shows: a slug in that parameter is answered with a silent zero. Look an '
      + 'id up with /api/frontend/suggestions/skills?term=<word>, which returns value as the id, '
      + 'and keep it under skills.hc. query is full text over the whole posting rather than over '
      + 'its stack: a hit need not carry the term in skills at all.',
    count: async ({ preset, query, skills }) =>
      ({ preset, ...(await habrcareer.count(hcParams({ preset, query, skills }))) }),
    search: ({ preset, query, skills, pages }) =>
      habrcareer.search(hcParams({ preset, query, skills }), pages),
  },
  ats: {
    label: 'the employer watchlist from the active profile',
    countHelp: 'reads one company instance per request, starting with the ones read longest ago; '
      + 'watchlist says how many employers exist and how many this call reached, and complete is '
      + 'true only when that was all of them AND every one answered - a shorter walk or a single '
      + 'failing company makes it false.',
    searchHelp: 'Greenhouse, Ashby, BambooHR, Lever, Workable, Teamtailor and Recruitee instances read one company per request, so pages means '
      + 'how many companies to read, and query filters titles locally because no provider offers '
      + 'a search. The companies read are the ones read longest ago, so repeated calls walk the '
      + 'whole watchlist without reordering the profile; watchlist says how many exist and how '
      + 'many this call reached, and companies lists them. One company that fails no longer ends '
      + 'the run: it lands in errors and the walk continues, with found counted over the ones '
      + 'that answered. since IS applied here, locally, on the dates two of the three providers '
      + 'publish - dateFiltered says how many that dropped and undated how many carried no date '
      + 'and were kept.',
    count: async () => {
      const { employers, window } = atsWindow(10);
      const counted = await ats.count({ watchlist: window }, window.length);
      store.noteAtsReads(window);
      // The adapter only sees the window, so it would call a full window a
      // complete read of a watchlist twice its size.
      counted.complete = window.length === employers.length && !counted.errors;
      return { ...counted, watchlist: { size: employers.length, read: window.length } };
    },
    search: atsSearch,
  },
};

// A code the registry lists and this table does not answers a tool call with
// "cannot read properties of undefined" rather than with a sentence.
const undriven = SOURCE_CODES.filter((code) => !DRIVERS[code]);
if (undriven.length) {
  console.error(`job-radar: adapters/index.mjs lists ${undriven.join(', ')} with no entry `
    + 'in DRIVERS - the server would accept that source and then fail on dispatch');
  process.exit(2);
}

/** The board paragraphs of a tool description, in registry order. */
const sourceGuide = (kind) => `source: ${SOURCE_CODES.join(', ')}. `
  + SOURCE_CODES.map((code) => {
    const { label, [kind]: help } = DRIVERS[code];
    return help ? `${code} (${label}): ${help}` : `${code} (${label}).`;
  }).join(' ');

server.registerTool(
  'jobs_count',
  {
    title: 'Count matching jobs',
    // Reads a board and nothing else: no row, no run log, no mark.
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    description: 'Quick count for one source. ' + sourceGuide('countHelp'),
    inputSchema: {
      source: sourceSchema.optional(),
      preset: presetSchema.optional(),
      since: sinceSchema.optional(),
      query: z.string().max(255).optional(),
      category: z.string().optional(),
      skills: z.union([z.string(), z.array(z.string())]).optional(),
      date: z.enum(['today', '7days', '30days']).optional(),
    },
  },
  async ({ source = 'af', preset = 'remote', since = 'week', query, category, skills, date }) => {
    // A count is one or two requests, but the ceiling belongs on every path: the
    // exception is a call that quietly grows one day and is not noticed.
    const board = SOURCES[source];
    board.beginCall(`jobs_count on ${source}`);
    try {
      return json({ source, ...(await DRIVERS[source].count({ preset, since, query, category, skills, date })) });
    } finally {
      board.endCall();
    }
  }
);

/**
 * TalentMove refuses a request that carries neither a category nor its own text
 * search, and this server never sends the text search - so `query` reached the
 * schema, was dropped by `tmParams`, and the board answered HTTP 400 about a
 * parameter the caller believed they had passed. Refused here instead, before
 * the request, naming what the profile actually offers.
 */
function tmRequest({ preset, category, skills, date, query }) {
  if (category === undefined || category === null || category === '') {
    const known = Object.keys(CATEGORIES);
    throw new Error('tm: this board needs a category - it answers HTTP 400 to a '
      + 'request carrying neither a category nor its own text search, and this '
      + `server does not send the text search. ${known.length
        ? `The active profile names: ${known.join(', ')}.`
        : 'The active profile names none; add a `categories` map or pass a raw taxonomy id.'}`);
  }
  if (query) {
    throw new Error('tm: query is not a parameter this board takes from here - '
      + 'it is filtered by category and skills. Drop query, or narrow with '
      + '`skills` (its own slugs) and `requireTags`');
  }
  return tmParams({ preset, category, skills, date });
}

// TalentMove: a required tag set is a second board-side query, not a filter over
// the cards that came back. The board matches on a posting's full tag list while
// a card shows at most four of them - measured at 20 of 20 cards truncated - so
// the narrowing belongs in the query wherever the board can express it. What it
// cannot express is the AND, hence two queries intersected on ids.
async function tmSearch({ preset, category, skills, date, query, requireTags, pages }) {
  const params = tmRequest({ preset, category, skills, date, query });
  const wanted = resolveTags(requireTags);
  if (!wanted.length) return talentmove.search(params, pages);
  // The slug lookup is scoped to a category, and without one there is nothing to
  // scope it to; fall back to the card filter and let the caller see the tags it
  // was checked against rather than silently getting a wider answer.
  if (!params.category) {
    return talentmove.search(params, pages, { requireSkills: wanted, deepen: true });
  }
  const language = Array.isArray(skills) ? skills : String(skills || '').split(',').filter(Boolean);
  // One group is not an intersection: ask the board once and be done, rather
  // than paying for the same query twice to intersect it with itself.
  if (!language.length) {
    const { slugs, unresolved } = await talentmove.skillSlugs(wanted, params.category);
    // Same refusal as searchIntersect: an empty `skills=` is an unknown value to
    // this board, and it answers zero - which reads as "no such job" rather than
    // "none of those tags exists here".
    if (!slugs.length) throw new Error(`tm: none of [${wanted.join(', ')}] is a `
      + `known skill in category ${params.category} - the query would fall back `
      + 'to the whole category and look like a result');
    const jobs = await talentmove.search({ ...params, skills: slugs.join(',') }, pages);
    // The half the board could not resolve travels with the answer. It used to
    // be dropped here, and a query silently narrowed to the tags that happened
    // to resolve is the wrong answer wearing the right shape.
    if (unresolved.length) jobs.unresolvedSkills = unresolved;
    return jobs;
  }
  return talentmove.searchIntersect(params, [language, wanted], pages);
}

// What `jobs_search` states itself. Every other property of the array travels:
// an allowlist here dropped a new adapter's caveat unasked.
const ENVELOPE = ['source', 'preset', 'since', 'found', 'collected', 'returned',
                  'sortedBy', 'onlyNew', 'dryRun', 'jobs'];

/**
 * Carry an array's own caveats onto a filtered copy - and nothing else.
 *
 * `Object.assign` was used for this and copies the INDICES too, so every filter
 * here counted correctly and then wrote the unfiltered list back over its own
 * result: honest numbers beside a list that ignored them.
 */
function carryMeta(kept, from) {
  for (const key of Object.keys(from)) {
    if (!/^\d+$/.test(key)) kept[key] = from[key];
  }
  return kept;
}

/**
 * One posting twice inside one answer.
 *
 * The store collapses these when it records them, so a normal run never shows
 * them - but `dryRun` does not touch the store, and a board that lists the same
 * role once per country then reads as several openings.
 */
function collapseTwins(jobs) {
  const seen = new Set();
  let collapsed = 0;
  const kept = jobs.filter((job) => {
    const key = store.dupKey(job.company, job.title);
    if (!key) return true;              // no company, no claim that two are one
    if (seen.has(key)) { collapsed += 1; return false; }
    seen.add(key);
    return true;
  });
  if (!collapsed) return jobs;
  carryMeta(kept, jobs);
  kept.collapsed = collapsed;
  return kept;
}

/**
 * The profile's own title filter, over every source alike.
 *
 * Never silent: what it dropped is counted, and `showFiltered` hands back the
 * titles themselves. A filter that cannot be seen is indistinguishable from a
 * board with nothing to offer, which is the failure this repository is built
 * around.
 */
function filterTitles(jobs, showFiltered) {
  const { exclude, include } = titleFilter();
  if (!exclude.length && !include.length) return jobs;
  const dropped = [];
  const kept = jobs.filter((job) => {
    const title = job.title || '';
    if (include.length && !include.some((re) => re.test(title))) { dropped.push(title); return false; }
    if (exclude.some((re) => re.test(title))) { dropped.push(title); return false; }
    return true;
  });
  carryMeta(kept, jobs);
  kept.titleFiltered = dropped.length;
  if (showFiltered && dropped.length) kept.filteredTitles = dropped;
  return kept;
}

// The watchlist is configuration, and an empty one is the silent-zero shape this
// repository keeps finding: a source with nothing to read answers "no jobs"
// rather than "nobody told me whom to watch".
function watchedEmployers() {
  const employers = watchlist();
  if (!employers.length) {
    throw new Error('ats: the active profile names no employers to watch. Add a '
      + '`watchlist` of { provider, slug } entries - greenhouse, ashby or '
      + 'bamboohr, with the company\'s own instance name - see '
      + 'profiles.example.json. Whose openings to follow is yours, not the '
      + "repository's");
  }
  return employers;
}

// The employer watchlist. `pages` is a walk over COMPANIES here rather than over
// pages: none of the three providers pages, and none of them offers a search
// parameter either - so `query` is a local filter over titles and the answer
// says how many records it dropped.
/**
 * The companies to read this call: the `pages` read longest ago, never-read
 * first. One call cannot walk a long watchlist inside a client's timeout, and
 * `slice(0, n)` always read the same head - so the tail was reachable only by
 * reordering the profile. Every call now moves the window itself.
 */
function atsWindow(pages) {
  const employers = watchedEmployers();
  const window = store.leastRecentlyRead(employers, pages);
  return { employers, window };
}

/**
 * `since` on the watchlist, applied here because no provider offers a date
 * filter. Two of the three state a publication date and one does not, so a
 * posting with no date is kept and counted rather than dropped on a guess.
 */
function applySince(jobs, since) {
  const cutoff = sinceCutoff(since);
  if (!cutoff) return jobs;
  let dropped = 0;
  let undated = 0;
  const kept = jobs.filter((j) => {
    if (!j.date) { undated += 1; return true; }
    if (j.date >= cutoff) return true;
    dropped += 1;
    return false;
  });
  carryMeta(kept, jobs);
  kept.dateFiltered = dropped;
  if (undated) kept.undated = undated;
  return kept;
}

async function atsSearch({ query, since, pages }) {
  const { employers, window } = atsWindow(pages);
  let jobs = await ats.search({ watchlist: employers.length ? window : [], query, signalConfig: signalConfig() }, window.length);
  jobs = applySince(jobs, since);
  // Stamped whether or not they answered: a slug that 404s every time must not
  // hold the window still.
  store.noteAtsReads(window);
  jobs.complete = window.length === employers.length && !jobs.errors;
  jobs.watchlist = { size: employers.length, read: window.length };
  return jobs;
}

// jobs.solana.com takes one search term and a work mode, and nothing else this
// tool offers reaches it: it has no date filter under any name tried, and its
// location filter is accepted and dropped. Whatever the caller named beyond the
// one term travels back in the answer rather than disappearing.
async function solSearch({ preset, query, skills, pages }) {
  const { ignored, ...params } = solParams({ preset, query, skills });
  const jobs = await solana.search(params, pages);
  if (ignored.length) jobs.ignoredSkills = ignored;
  return jobs;
}

server.registerTool(
  'jobs_search',
  {
    title: 'Search jobs',
    // NOT read-only, and the hint says so. This tool records every posting it
    // returns as seen, which changes what the next call answers - a caller that
    // trusted a read-only hint here would find a repeated search returning
    // nothing and read it as an empty market. `dryRun: true` is the read-only
    // path, and it is a parameter rather than a second tool, so the annotation
    // has to describe the default.
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    description: 'Search a source and return jobs with real apply URLs. By default returns only jobs never '
      + 'seen before and records them as seen; dedup is shared across sources, so a posting '
      + 'republished on several surfaces returns once. '
      + sourceGuide('searchHelp') + ' '
      + 'This tool is NOT read-only by default: every posting it returns is recorded as seen, so '
      + 'the same search run twice returns the second answer empty. Set onlyNew=false to see '
      + 'everything, dryRun=true to record nothing - dryRun is the read-only way to call it. '
      + 'Either way the answer carries status and note for postings the store already knows, so '
      + 'one already marked applied or skip is not mistaken for a fresh one. tm, w3 and hc fill '
      + 'the skills field; af usually leaves it empty and ats never fills it, because no ATS '
      + 'provider publishes one. In the answer, found is the source own total where it states one '
      + 'and collected is what was fetched; found null with foundUnavailable means the total '
      + 'could not be fetched and the jobs still could - on af the count and search endpoints '
      + 'have been seen disagreeing, so a dead counter no longer hides a working board; '
      + 'complete=false means a page or company loop stopped short and the result is a lower '
      + 'bound; filtered is how many records a local query dropped on ats. skipped says why the '
      + 'answer is shorter than what was collected: seen is this source offering the same id '
      + 'again, merged lists postings already stored under another id - and a merged entry '
      + 'carrying atEmployer is a posting that reaches the employer directly, with stored=true '
      + 'meaning that link was added to the row it merged into, so it can be asked for again '
      + 'later. applyAtEmployer says whether a job url opens the employer own application: always '
      + 'true on ats, true for most of sol, false on w3, tm and hc, and on af read from the link '
      + 'host - true for an ATS or a company careers domain, false for an aggregator, null where '
      + 'the host settles nothing. signals and note carry what the posting own text says about '
      + 'work authorisation, office presence and the required backend language, quoted verbatim - '
      + 'they are raised where the source publishes text - ats, and af, whose summary keeps an '
      + 'office requirement but not a legal notice - nothing is ever dropped for them, and which '
      + 'phrases and languages to look for is configured in the profile. titleExclude and '
      + 'titleInclude in the profile are regular expressions applied to every source after '
      + 'collection, for the boards that cannot filter by role without discarding most of '
      + 'themselves; titleFiltered says how many they dropped and showFiltered=true returns the '
      + 'titles. locationVerified is false everywhere: the location and work mode are what the '
      + 'source states, and three of them have been measured wrong.',
    inputSchema: {
      source: sourceSchema.optional(),
      preset: presetSchema.optional(),
      since: sinceSchema.optional(),
      query: z.string().max(255).optional(),
      category: z.string().optional(),
      skills: z.union([z.string(), z.array(z.string())]).optional(),
      requireTags: z.union([z.string(), z.array(z.string())]).optional(),
      date: z.enum(['today', '7days', '30days']).optional(),
      minSalary: z.number().min(0).optional(),
      // Ten pages is 500 records on one board and 200 on another, and the real
      // ceiling on a call is MAX_REQUESTS_PER_CALL either way - so this is high
      // enough to read a small board in one go rather than in three.
      pages: z.number().min(1).max(25).optional(),
      onlyNew: z.boolean().optional(),
      dryRun: z.boolean().optional(),
      showFiltered: z.boolean().optional(),
    },
  },
  async ({ source = 'af', preset = 'remote', since = 'week', query, category, skills, requireTags, date, minSalary, pages = 5, onlyNew = true, dryRun = false, showFiltered = false }) => {
    // Requests are counted around the call rather than reported by it: how many
    // pages a board needed is the adapter's business, and the delta is what a
    // run actually spent.
    const board = SOURCES[source];
    const before = board.requestCount();
    board.beginCall(`jobs_search on ${source}`);
    const all = await DRIVERS[source].search(
      { preset, since, query, category, skills, requireTags, date, minSalary, pages });
    const collected = collapseTwins(filterTitles(all, showFiltered));
    const requests = board.requestCount() - before;
    board.endCall();
    // Checked before anything is written: `filterFresh` marks what it stores as
    // seen, so failing after it would swallow this run's jobs - they would never
    // be returned and never come back as new either.
    store.assertRequestsCounted(source, requests);

    // Sorting by a key half the corpus does not have is worse than not sorting:
    // records sink because their board omits the number, not because they pay
    // less. AgileFluent and web3.career fill salaryMinUsd, TalentMove never does
    // - it quotes roubles, and converting them at some rate would invent a figure
    // somebody would later quote as real. So the sort stays, and the answer says
    // what it could actually sort on.
    const priced = collected.filter((j) => j.salaryMinUsd).length;
    collected.sort((a, b) => (b.salaryMinUsd || 0) - (a.salaryMinUsd || 0));
    const sortedBy = priced === collected.length ? 'salaryMinUsd'
      : priced === 0 ? 'none - no record on this board carries a USD figure'
        : `salaryMinUsd, but ${collected.length - priced} of ${collected.length} lack one and sit at the end`;

    // Not filtering to the new ones means the answer will contain postings the
    // store already knows something about. Saying nothing about them is how a
    // vacancy already marked `skip` came back looking untouched.
    const jobs = onlyNew && !dryRun ? store.filterFresh(collected) : store.marksFor(collected);
    if (!dryRun) store.logRun(source, preset, since, collected.length, jobs.length, requests);

    // An adapter hangs its caveats on the array it returns, and JSON.stringify
    // drops properties of an array. Reading them out here is what keeps "we
    // stopped reading" from being served as "that is all there is": `found` is
    // the board's own total when it states one, `collected` is what was actually
    // fetched, and the two differing is the whole message.
    const meta = carryMeta({}, collected);
    for (const key of ENVELOPE) delete meta[key];
    // Why the answer is shorter than what was collected. `merged` is the second
    // board's copy of a posting already stored, which is the one thing the store
    // used to do without saying so - and the only measure of what a second
    // adapter is actually adding.
    if (jobs.skipped) meta.skipped = jobs.skipped;

    return json({ source, preset, since,
                  found: all.found ?? all.length, collected: all.length,
                  returned: jobs.length, sortedBy, onlyNew, dryRun, ...meta, jobs });
  }
);

server.registerTool(
  'jobs_mark_status',
  {
    title: 'Mark job status',
    // Writes, but only over one row's own status, and writing the same status
    // twice leaves the same row - so not destructive, and idempotent.
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: 'Record a status for a job id: applied | rejected | interview | skip | new. Use to keep the store in sync with the vacancies tracker. AgileFluent ids are bare numbers; every other source prefixes its own - tm:266809, w3:..., sol:..., hc:..., and ats:<provider>:<company>:<id>.',
    inputSchema: {
      id: z.string(),
      status: z.enum(['applied', 'rejected', 'interview', 'skip', 'new']),
      note: z.string().optional(),
    },
  },
  async ({ id, status, note }) => json({ id, status, updated: store.markStatus(id, status, note) })
);

server.registerTool(
  'jobs_stats',
  {
    title: 'Seen/store stats',
    // Counts what is already on disk; touches no board.
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: 'How many jobs are stored, the breakdown by status and by source, how many rows carry a way in to the employer own application (withApplyAtEmployer, by source - rows written before that was recorded are not counted), and the last run. Also build - the version this server reports AND the modification time of the file it was started from, because a version string alone has covered two different builds, and profile - which search profile is loaded and when it was read.',
    inputSchema: {},
  },
  async () => json({ ...store.stats(), build: BUILD, profile: profileStatus() })
);

const transport = new StdioServerTransport();
await server.connect(transport);
