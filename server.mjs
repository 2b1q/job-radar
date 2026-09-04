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
import * as talentmove from './adapters/talentmove.mjs';
import * as web3career from './adapters/web3career.mjs';
import * as store from './store.mjs';
// Dynamic, so a missing or broken profile reaches the operator as one line
// rather than as a module-loading stack trace on a transport nobody is reading
// yet.
const { afFilters, resolveTags, tmParams } = await import('./params.mjs')
  .catch((err) => {
    console.error(`job-radar: ${err.message}`);
    process.exit(2);
  });

const SOURCES = { af: agilefluent, tm: talentmove, w3: web3career };

const json = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });

// The server name is the project; the tool names are not - see CLAUDE.md.
const server = new McpServer({ name: 'job-radar', version: '2.0.0' });

const sourceSchema = z.enum(['af', 'tm', 'w3']);
const presetSchema = z.enum(['remote', 'ruroots', 'countries', 'anywhere']);
const sinceSchema = z.enum(['24h', '3d', 'week', '2w', 'month']);

server.registerTool(
  'jobs_count',
  {
    title: 'Count matching jobs',
    description: 'Quick count for one board. source: af (AgileFluent), tm (TalentMove) or w3 (web3.career). AgileFluent presets: remote, ruroots (russian-roots companies), countries (the relocation list from the active profile), anywhere. TalentMove takes an optional category taxonomy id and skills (slugs from search-skills, comma separated or an array). web3.career ignores presets: it is addressed by tag page, so pass the tag slug as skills.',
    inputSchema: {
      source: sourceSchema.optional(),
      preset: presetSchema.optional(),
      since: sinceSchema.optional(),
      category: z.string().optional(),
      skills: z.union([z.string(), z.array(z.string())]).optional(),
      date: z.enum(['today', '7days', '30days']).optional(),
    },
  },
  async ({ source = 'af', preset = 'remote', since = 'week', category, skills, date }) => {
    // A count is one or two requests, but the ceiling belongs on every path: the
    // exception is a call that quietly grows one day and is not noticed.
    const board = SOURCES[source];
    board.beginCall(`jobs_count on ${source}`);
    try {
      if (source === 'w3') {
        return json({ source, ...(await web3career.count({ tag: Array.isArray(skills) ? skills[0] : (skills || null) })) });
      }
      if (source === 'tm') return json({ source, ...(await talentmove.count(tmParams({ preset, category, skills, date }))) });
      const total = await agilefluent.count(afFilters({ preset, since }));
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
    const { slugs } = await talentmove.skillSlugs(wanted, params.category);
    return talentmove.search({ ...params, skills: slugs.join(',') }, pages);
  }
  return talentmove.searchIntersect(params, [language, wanted], pages);
}

server.registerTool(
  'jobs_search',
  {
    title: 'Search jobs',
    description: 'Search a board and return jobs with real apply URLs. By default returns only jobs never seen before and records them as seen; dedup is shared across boards, so a posting republished on several surfaces once. source: af (AgileFluent), tm (TalentMove) or w3 (web3.career, addressed by tag page - pass the tag slug as skills). Set onlyNew=false to see everything, dryRun=true to not record. TalentMove and web3.career fill the skills field, AgileFluent usually leaves it empty. In the answer, found is the board own total where it states one and collected is what was fetched; complete=false means a page loop stopped short and the result is a lower bound.',
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
      pages: z.number().min(1).max(10).optional(),
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
      ? await web3career.search({ tag: Array.isArray(skills) ? skills[0] : (skills || null) }, pages)
      : source === 'tm'
        ? await tmSearch({ preset, category, skills, date, requireTags, pages })
        : await agilefluent.search(afFilters({ preset, since, query, minSalary }), pages);
    const requests = board.requestCount() - before;
    board.endCall();

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
    for (const key of ['complete', 'sides', 'tagLookups', 'unresolvedSkills']) {
      if (all[key] !== undefined) meta[key] = all[key];
    }

    return json({ source, preset, since,
                  found: all.found ?? all.length, collected: all.length,
                  returned: jobs.length, sortedBy, onlyNew, dryRun, ...meta, jobs });
  }
);

server.registerTool(
  'jobs_mark_status',
  {
    title: 'Mark job status',
    description: 'Record a status for a job id: applied | rejected | interview | skip | new. Use to keep the store in sync with the vacancies tracker. AgileFluent ids are bare numbers, TalentMove ids look like tm:266809.',
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
    description: 'How many jobs are stored, the breakdown by status and by source, and the last run.',
    inputSchema: {},
  },
  async () => json(store.stats())
);

const transport = new StdioServerTransport();
await server.connect(transport);
