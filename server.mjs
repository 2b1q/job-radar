#!/usr/bin/env node
// server.mjs - MCP server over stdio for several job boards.
// SRP: protocol glue only. HTTP and per board parsing live in adapters/,
// state in store.mjs. Adding a board means adding an adapter, not touching
// this file beyond one line in SOURCES.
//
// Run:  node --experimental-sqlite server.mjs

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import * as agilefluent from './adapters/agilefluent.mjs';
import * as ats from './adapters/ats.mjs';
import * as habrcareer from './adapters/habrcareer.mjs';
import * as solana from './adapters/solana.mjs';
import * as talentmove from './adapters/talentmove.mjs';
import * as web3career from './adapters/web3career.mjs';
import * as store from './store.mjs';
// Dynamic, so a missing or broken profile reaches the operator as one line
// rather than as a module-loading stack trace on a transport nobody is reading
// yet.
const { SOURCE_CODES, afFilters, hcParams, resolveTags, signalConfig, solParams,
        tmParams, w3Tag, watchlist } = await import('./params.mjs')
  .catch((err) => {
    console.error(`job-radar: ${err.message}`);
    process.exit(2);
  });

const SOURCES = { af: agilefluent, tm: talentmove, w3: web3career, sol: solana, hc: habrcareer, ats };


const json = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });

// The server name is the project; the tool names are not - see CLAUDE.md.
const server = new McpServer({ name: 'job-radar', version: '2.0.0' });

const sourceSchema = z.enum(SOURCE_CODES);
const presetSchema = z.enum(['remote', 'ruroots', 'countries', 'anywhere']);
const sinceSchema = z.enum(['24h', '3d', 'week', '2w', 'month']);

server.registerTool(
  'jobs_count',
  {
    title: 'Count matching jobs',
    description: 'Quick count for one source. source: af (AgileFluent), tm (TalentMove), w3 (web3.career), sol (jobs.solana.com), hc (career.habr.com) or ats (the employer watchlist from the active profile). AgileFluent presets: remote, ruroots (russian-roots companies), countries (the relocation list from the active profile), anywhere. TalentMove takes an optional category taxonomy id and skills (slugs from search-skills, comma separated or an array). web3.career ignores presets: it is addressed by tag page, so pass the tag slug as skills. The slugs belong to this board alone; the profile keeps them under skills.w3. jobs.solana.com takes one free-text term - pass it as query or as the first skills entry - plus the remote preset. career.habr.com takes free text as query, the remote preset, and skills as ITS OWN numeric term ids under skills.hc; the profile grades become its qualification filter. ats reads one company instance per request and counts what those employers have open.',
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
      if (source === 'w3') return json({ source, ...(await web3career.count({ tag: w3Tag(skills) })) });
      if (source === 'sol') {
        // The same one-term rule as a search, and the same duty to say which
        // words were not part of the question.
        const { ignored, ...params } = solParams({ preset, skills });
        const counted = await solana.count(params);
        return json({ source, ...counted, ...(ignored.length ? { ignoredSkills: ignored } : {}) });
      }
      if (source === 'tm') return json({ source, ...(await talentmove.count(tmParams({ preset, category, skills, date }))) });
      if (source === 'hc') return json({ source, preset, ...(await habrcareer.count(hcParams({ preset, query, skills }))) });
      if (source === 'ats') return json({ source, ...(await ats.count({ watchlist: watchedEmployers() })) });
      const total = await agilefluent.count(afFilters({ preset, since, query }));
      return json({ source, preset, since, totalCount: total });
    } finally {
      board.endCall();
    }
  }
);

// TalentMove: a required tag set is a second board-side query, not a filter over
// the cards that came back. The board matches on a posting's full tag list while
// a card shows at most four of them - measured at 20 of 20 cards truncated - so
// the narrowing belongs in the query wherever the board can express it. What it
// cannot express is the AND, hence two queries intersected on ids.
async function tmSearch({ preset, category, skills, date, requireTags, pages }) {
  const params = tmParams({ preset, category, skills, date });
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
async function atsSearch({ query, pages }) {
  return ats.search({ watchlist: watchedEmployers(), query, signalConfig: signalConfig() }, pages);
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
    description: 'Search a source and return jobs with real apply URLs. By default returns only jobs never seen before and records them as seen; dedup is shared across sources, so a posting republished on several surfaces returns once. source: af (AgileFluent), tm (TalentMove), w3 (web3.career, addressed by tag page - pass the tag slug as skills, which belong to this board alone), sol (jobs.solana.com, one free-text term as query or the first skills entry; it has no date filter, so since is not applied there), hc (career.habr.com, russian-language product companies; free text as query, remote preset, skills as its own numeric term ids under skills.hc) or ats (the employer watchlist from the active profile - Greenhouse, Ashby and BambooHR instances read one company per request, so pages means how many companies to read, and query filters titles locally because no provider offers a search). On af, query is the board own PHRASE search - consecutive words in order - so a multi-word query is refused here rather than answered with a silent zero. Set onlyNew=false to see everything, dryRun=true to not record. tm, w3 and hc fill the skills field; af usually leaves it empty and ats never fills it, because no ATS provider publishes one. In the answer, found is the source own total where it states one and collected is what was fetched; complete=false means a page or company loop stopped short and the result is a lower bound; filtered is how many records a local query dropped on ats. skipped says why the answer is shorter than what was collected: seen is this source offering the same id again, merged lists postings already stored under another id - and a merged entry carrying atEmployer is a posting that reaches the employer directly, with stored=true meaning that link was added to the row it merged into, so it can be asked for again later. applyAtEmployer says whether a job url opens the employer own application: always true on ats, true for most of sol, false on w3, tm and hc, and null on af, where nobody checked. signals and note carry what the posting own text says about work authorisation, office presence and the required backend language, quoted verbatim - they are raised only where the source publishes a description (ats), nothing is ever dropped for them, and which phrases and languages to look for is configured in the profile. locationVerified is false everywhere: the location and work mode are what the source states, and three of them have been measured wrong.',
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
    },
  },
  async ({ source = 'af', preset = 'remote', since = 'week', query, category, skills, requireTags, date, minSalary, pages = 5, onlyNew = true, dryRun = false }) => {
    // Requests are counted around the call rather than reported by it: how many
    // pages a board needed is the adapter's business, and the delta is what a
    // run actually spent.
    const board = SOURCES[source];
    const before = board.requestCount();
    board.beginCall(`jobs_search on ${source}`);
    // web3.career takes a listing slug rather than presets: its own taxonomy is
    // the tag page, and `skills` is where the caller names it.
    const all = source === 'w3'
      ? await web3career.search({ tag: w3Tag(skills) }, pages)
      : source === 'tm'
        ? await tmSearch({ preset, category, skills, date, requireTags, pages })
        : source === 'sol'
          ? await solSearch({ preset, query, skills, pages })
          : source === 'hc'
            ? await habrcareer.search(hcParams({ preset, query, skills }), pages)
            : source === 'ats'
              ? await atsSearch({ query, pages })
              : await agilefluent.search(afFilters({ preset, since, query, minSalary }), pages);
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
    const priced = all.filter((j) => j.salaryMinUsd).length;
    all.sort((a, b) => (b.salaryMinUsd || 0) - (a.salaryMinUsd || 0));
    const sortedBy = priced === all.length ? 'salaryMinUsd'
      : priced === 0 ? 'none - no record on this board carries a USD figure'
        : `salaryMinUsd, but ${all.length - priced} of ${all.length} lack one and sit at the end`;

    const jobs = onlyNew && !dryRun ? store.filterFresh(all) : all;
    if (!dryRun) store.logRun(source, preset, since, all.length, jobs.length, requests);

    // An adapter hangs its caveats on the array it returns, and JSON.stringify
    // drops properties of an array. Reading them out here is what keeps "we
    // stopped reading" from being served as "that is all there is": `found` is
    // the board's own total when it states one, `collected` is what was actually
    // fetched, and the two differing is the whole message.
    const meta = {};
    for (const key of ['complete', 'filtered', 'sides', 'tagLookups', 'unresolvedSkills', 'ignoredSkills']) {
      if (all[key] !== undefined) meta[key] = all[key];
    }
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
    description: 'How many jobs are stored, the breakdown by status and by source, how many rows carry a way in to the employer own application (withApplyAtEmployer, by source - rows written before that was recorded are not counted), and the last run.',
    inputSchema: {},
  },
  async () => json(store.stats())
);

const transport = new StdioServerTransport();
await server.connect(transport);
