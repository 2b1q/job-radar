// The seam nothing else covers: a tool call from a client, through an adapter,
// into the store and the run log.
//
// Two silences lived exactly here, in the part of the pipeline that has no unit
// test because `server.mjs` starts a stdio transport at import and never
// returns. The store held 284 AgileFluent rows and 61 TalentMove rows and not
// one from web3.career, whose adapter has been written and tested for as long as
// the others; and the run log carried three TalentMove runs with no request
// count against a board that answers 401 when its budget runs out.
//
// So the server is started as a client would start it, with every board answered
// from a fixture and the store pointed at a throwaway file. No network.
//
// The profile comes from `profiles.example.json`: what to search for is
// configuration, and a test that needs somebody's personal `profiles.json` is
// the defect this repository is careful about.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DB = join(mkdtempSync(join(tmpdir(), 'jobs-server-')), 'jobs.db');

// Every client here starts a REAL server process, and an unclosed one keeps the
// test runner alive after the suite has passed. One way to start a server, and
// it always closes - not three connect blocks each expected to remember.
async function connect(name, env = {}) {
  const client = new Client({ name, version: '0' });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: ['--experimental-sqlite', '--import', join(HERE, 'helpers/stub-boards.mjs'), 'server.mjs'],
    cwd: ROOT,
    env: { ...process.env, JOBS_DB_PATH: DB, JOBS_PROFILES: 'profiles.example.json', ...env },
  }));
  return client;
}

/** A server for the length of one test, closed whether the test passes or not. */
async function withServer(name, env, run) {
  const client = await connect(name, env);
  try {
    return await run(client);
  } finally {
    await client.close();
  }
}

let client;

before(async () => { client = await connect('server-store-test'); });

// Closed even if `before` threw before assigning: a failed setup used to leave
// its child behind.
after(async () => { await client?.close(); });

/** The tool answers with one JSON text block; this is what a client reads. */
async function search(args) {
  const res = await client.callTool({ name: 'jobs_search', arguments: args });
  const text = res.content[0].text;
  if (res.isError) throw new Error(text);
  return JSON.parse(text);
}

const rows = (sql, ...args) => {
  const db = new DatabaseSync(DB);
  const out = db.prepare(sql).all(...args);
  db.close();
  return out;
};

test('a web3.career search reaches the store, like the other two boards', async () => {
  // The whole finding: the adapter worked and the rows were not there. Every
  // board goes through the same three steps, and this asserts all three of them
  // for the one that had none.
  const w3 = await search({ source: 'w3', skills: 'node', pages: 1 });
  assert.equal(w3.collected, 3, 'the board answered');
  assert.equal(w3.returned, 3, 'and the run reported them as new');

  const stored = rows("SELECT id FROM jobs WHERE source = 'w3'");
  assert.equal(stored.length, 3, 'the rows are in the store, not only in the answer');
  for (const r of stored) assert.match(r.id, /^w3:\d+$/);
});

test('the fourth board reaches the store too, with its outbound link intact', async () => {
  // The reason jobs.solana.com is here: the url is the employer's own
  // application. A record whose link only reaches the board says so instead of
  // passing the board's own page off as an apply link.
  const sol = await search({ source: 'sol', pages: 1, skills: 'rust' });
  assert.equal(sol.collected, 4);
  assert.equal(sol.returned, 4);
  assert.equal(rows("SELECT id FROM jobs WHERE source = 'sol'").length, 4);

  const outbound = sol.jobs.filter((j) => j.applyAtEmployer);
  assert.equal(outbound.length, 3, 'three of the four leave the board');
  for (const j of outbound) assert.doesNotMatch(j.url, /jobs\.solana\.com/);
  const boardHosted = sol.jobs.find((j) => !j.applyAtEmployer);
  assert.match(boardHosted.url, /jobs\.solana\.com/, 'and the fourth is kept, marked');
});

test('dryRun is the only thing that keeps a board out of the store', async () => {
  // Which is what the empty w3 slice turned out to be. A dry run must leave no
  // row and no run - otherwise the next real run would find its own jobs seen.
  const before = rows('SELECT id FROM jobs').length;
  const runsBefore = rows('SELECT ts FROM runs').length;
  const res = await search({ source: 'af', pages: 1, dryRun: true });
  assert.ok(res.collected > 0, 'the board still answered');
  assert.equal(rows('SELECT id FROM jobs').length, before);
  assert.equal(rows('SELECT ts FROM runs').length, runsBefore);
});

test('a cross-board duplicate is reported, not silently dropped', async () => {
  // The store's whole job, and until now the one thing it did without a word.
  // The stub serves the same posting from AgileFluent and from TalentMove under
  // the two ids the two boards mint for it.
  const first = await search({ source: 'af', pages: 1, query: 'twin' });
  assert.equal(first.returned, first.collected, 'the AgileFluent copy is new');

  const second = await search({ source: 'tm', pages: 1, category: '903', skills: 'twin' });
  const merged = second.skipped.merged;
  assert.equal(merged.length, 1, 'one posting, already stored under the other id');
  assert.equal(merged[0].id, 'tm:900500');
  assert.equal(merged[0].into, '26100500');
});

test('the fifth source reaches the store, and fills the skills the store keeps', async () => {
  // career.habr.com covers a market the other four do not. It does not reach the
  // employer, and says so rather than passing its own page off as an apply link.
  const hc = await search({ source: 'hc', pages: 1 });
  assert.equal(hc.collected, 2);
  assert.equal(hc.returned, 2);
  for (const j of hc.jobs) assert.equal(j.applyAtEmployer, false);

  const stored = rows("SELECT id, skills FROM jobs WHERE source = 'hc'");
  assert.equal(stored.length, 2, 'the rows are in the store, not only in the answer');
  for (const r of stored) assert.match(r.id, /^hc:\d+$/);
  assert.equal(stored.find((r) => r.skills)?.skills, 'Node.js, PostgreSQL');
});

test('every board that stores a run stores what it cost', async () => {
  // NULL here is what made a metered budget invisible. `requests` is now checked
  // before the store is touched, so an uncounted run is an error rather than a
  // zero that reads as a free run.
  await search({ source: 'af', pages: 1 });
  await search({ source: 'tm', pages: 1, category: '903' });
  const runs = rows('SELECT source, requests FROM runs');
  assert.deepEqual([...new Set(runs.map((r) => r.source))].sort(), ['af', 'hc', 'sol', 'tm', 'w3']);
  for (const r of runs) {
    assert.ok(Number.isInteger(r.requests) && r.requests > 0,
              `${r.source} logged a run costing ${r.requests}`);
  }
});

test('and the budget adds up to what the runs actually spent', async () => {
  const res = await client.callTool({ name: 'jobs_stats', arguments: {} });
  const stats = JSON.parse(res.content[0].text);
  const runs = rows('SELECT source, requests FROM runs');
  const spent = runs.reduce((n, r) => n + r.requests, 0);
  const reported = stats.requestsLast24h.reduce((n, s) => n + s.requests, 0);
  assert.equal(reported, spent);
  for (const s of stats.requestsLast24h) {
    assert.equal(s.unrecorded, 0, `${s.source} has a run that did not say what it cost`);
  }
  assert.deepEqual(stats.bySource.map((s) => s.source).sort(), ['af', 'hc', 'sol', 'tm', 'w3']);
});

// The employer watchlist is configuration, and the profile that carries one in
// the shipped example is not the active one - so this source is exercised the
// way a user reaches it, by naming the profile.
test('the watchlist source reaches the store, with its signals and its link', async () => {
  await withServer('server-store-test-ats', { JOBS_PROFILE: 'android' }, async (watcher) => {
    const res = await watcher.callTool({ name: 'jobs_search', arguments: { source: 'ats', pages: 1 } });
    const ats = JSON.parse(res.content[0].text);

    // The stub's Greenhouse instance republishes a posting already in the store.
    // The stored row wins, but gains the link this source was added for.
    assert.equal(ats.collected, 1);
    assert.equal(ats.returned, 0, 'the posting is already stored under a board id');
    const [merged] = ats.skipped.merged;
    assert.equal(merged.into, '26100500');
    assert.match(merged.atEmployer, /greenhouse\.io/);
    assert.equal(merged.stored, true);

    // And in the store, not only in the answer - what a shortlist asks tomorrow.
    const [kept] = rows('SELECT url, apply_url, apply_from FROM jobs WHERE id = ?', '26100500');
    assert.match(kept.apply_url, /greenhouse\.io/, 'the way in survives the call');
    assert.equal(kept.apply_from, 'ats:gh:example-co:7000500');
    assert.doesNotMatch(kept.url, /greenhouse\.io/, 'and the original link is not substituted');
  });
});

test('what the filters count is what the list actually lost', async () => {
  // The defect this checks for: every filter counted correctly and then wrote
  // the unfiltered list back over its own result, so the numbers were honest
  // and the postings beside them were not.
  await withServer('server-store-test-arith', { JOBS_PROFILE: 'frontend-wallets' }, async (c) => {
    const res = await c.callTool({
      name: 'jobs_search',
      arguments: { source: 'af', pages: 1, query: 'mixed', dryRun: true, onlyNew: false, showFiltered: true },
    });
    const out = JSON.parse(res.content[0].text);

    assert.equal(out.collected, 4, 'the board returned four');
    assert.equal(out.titleFiltered, 1, 'one title the profile excludes');
    assert.deepEqual(out.filteredTitles, ['Head of Sales']);
    assert.equal(out.collapsed, 1, 'and one of the two identical postings');
    assert.equal(out.returned, 2);
    assert.equal(out.jobs.length, 2, 'the list is what the counters say it is');

    const titles = out.jobs.map((j) => j.title).sort();
    assert.deepEqual(titles, ['Backend Engineer', 'Platform Engineer']);
    assert.equal(out.jobs.some((j) => j.title === 'Head of Sales'), false,
                 'an excluded title is not in the list it was excluded from');
  });
});

test('and the answer adds up', async () => {
  await withServer('server-store-test-arith2', { JOBS_PROFILE: 'frontend-wallets' }, async (c) => {
    const res = await c.callTool({
      name: 'jobs_search',
      arguments: { source: 'af', pages: 1, query: 'mixed', onlyNew: true, showFiltered: true },
    });
    const out = JSON.parse(res.content[0].text);
    const dropped = (out.titleFiltered ?? 0) + (out.collapsed ?? 0)
      + (out.skipped?.seen ?? 0) + (out.skipped?.merged?.length ?? 0);
    assert.equal(out.collected - dropped, out.returned,
                 `collected ${out.collected} minus ${dropped} dropped should be returned ${out.returned}`);
    assert.equal(out.returned, out.jobs.length);
  });
});

test('an excluded posting is not written to the store either', async () => {
  await withServer('server-store-test-arith3', { JOBS_PROFILE: 'frontend-wallets' }, async (c) => {
    await c.callTool({
      name: 'jobs_search',
      arguments: { source: 'af', pages: 1, query: 'mixed', onlyNew: true },
    });
    assert.equal(rows("SELECT id FROM jobs WHERE title = 'Head of Sales'").length, 0,
                 'it was filtered before the store saw it');
    assert.ok(rows("SELECT id FROM jobs WHERE title = 'Backend Engineer' AND source = 'af'").length > 0);
  });
});

test('a title filter cuts, and never silently', async () => {
  // A board that cannot filter by role returns everything; the profile says
  // which titles are somebody else's job, and the answer says what it dropped.
  await withServer('server-store-test-titles', { JOBS_PROFILE: 'frontend-wallets' }, async (c) => {
    const res = await c.callTool({
      name: 'jobs_search',
      arguments: { source: 'af', pages: 1, dryRun: true, showFiltered: true },
    });
    const out = JSON.parse(res.content[0].text);
    assert.equal(out.titleFiltered, 0, 'the stub titles are all engineering');

    const sales = await c.callTool({
      name: 'jobs_search',
      arguments: { source: 'w3', pages: 1, dryRun: true, showFiltered: true, skills: 'node' },
    });
    const w3 = JSON.parse(sales.content[0].text);
    assert.equal(typeof w3.titleFiltered, 'number', 'the count is always reported');
  });
});

test('an answer that is not filtering to the new ones says what is already known', async () => {
  // A posting already marked `skip` used to come back looking untouched.
  await search({ source: 'sol', pages: 1, skills: 'rust' });
  const stored = rows("SELECT id FROM jobs WHERE source = 'sol' LIMIT 1")[0].id;
  await client.callTool({ name: 'jobs_mark_status', arguments: { id: stored, status: 'skip', note: 'not this one' } });

  const again = await search({ source: 'sol', pages: 1, skills: 'rust', onlyNew: false });
  const marked = again.jobs.find((j) => j.id === stored);
  assert.equal(marked.status, 'skip');
  assert.equal(marked.note, 'not this one');
});

test('jobs_stats says which profile is loaded and when it was read', async () => {
  const res = await client.callTool({ name: 'jobs_stats', arguments: {} });
  const stats = JSON.parse(res.content[0].text);
  assert.match(stats.profile.path, /profiles\.example\.json$/);
  assert.match(stats.profile.mtime, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(stats.profile.profile, 'and which profile inside it');
});

test('jobs_stats names the build, and the three version strings agree', async () => {
  // A version string alone has already covered two different builds: it was
  // bumped in the working tree and the fix beside it landed two hours later, so
  // a defect was measured against a "2.2.0" that no longer existed. The mtime is
  // what tells two builds of one version apart.
  const res = await client.callTool({ name: 'jobs_stats', arguments: {} });
  const { build } = JSON.parse(res.content[0].text);
  assert.match(build.mtime, /^\d{4}-\d{2}-\d{2}T/, 'the file this process was started from');

  // And the release rule, which nothing checked until now: three files carry a
  // version and a user gets an update only when they agree.
  const json = (name) => JSON.parse(readFileSync(join(ROOT, name), 'utf8')).version;
  assert.equal(build.version, json('package.json'));
  assert.equal(build.version, json('.claude-plugin/plugin.json'));
});

test('every source the schema declares is one the server can actually dispatch', async () => {
  // Schema, dispatch and tool prose all come off the one registry now, but a
  // code listed there and left out of DRIVERS still reaches the caller as a
  // TypeError on the far side of a tool call. So every declared source is
  // called, and every one is described.
  await withServer('server-store-test-sources', { JOBS_PROFILE: 'android' }, async (watcher) => {
    const { tools } = await watcher.listTools();
    const declared = tools.find((t) => t.name === 'jobs_search').inputSchema.properties.source.enum;
    assert.ok(declared.length >= 6, 'the schema names every source');
    for (const source of declared) {
      for (const tool of tools.filter((t) => t.name.startsWith('jobs_') && t.description.includes('source:'))) {
        assert.ok(tool.description.includes(`${source} (`), `${tool.name} describes ${source}`);
      }
      // tm is the one source that refuses a request with no category, which is
      // itself the contract - give it one so this checks dispatch, not that.
      const args = source === 'tm' ? { source, category: '903' } : { source };
      const res = await watcher.callTool({ name: 'jobs_count', arguments: args });
      assert.equal(res.isError, undefined, `${source}: ${res.content[0].text}`);
      // One name for the total on every board. It was `totalCount` on af and
      // `found` on the rest, so a client reading either name got `undefined`
      // from the other and read it as a board with nothing on it.
      assert.ok('found' in JSON.parse(res.content[0].text), `${source} states found`);
    }
  });
});

test('and a watchlist posting nobody has stored keeps its note in the store', async () => {
  await withServer('server-store-test-ats2', { JOBS_PROFILE: 'android' }, async (watcher) => {
    // Two companies: the twin above, then a new one whose postings raise the
    // office-presence signal the profile asks for.
    const res = await watcher.callTool({ name: 'jobs_search', arguments: { source: 'ats', pages: 2 } });
    const ats = JSON.parse(res.content[0].text);
    assert.ok(ats.returned > 0, 'the second company answered');
    assert.equal(ats.complete, false, 'two of the three watched companies were read');
    for (const j of ats.jobs) assert.equal(j.applyAtEmployer, true);

    const noted = rows("SELECT id, note FROM jobs WHERE source = 'ats' AND note IS NOT NULL");
    assert.ok(noted.length, 'a signal raised at collection is kept, not recomputed later');
    assert.match(noted[0].note, /onsite: "/);
  });
});
