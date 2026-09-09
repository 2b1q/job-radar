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
import { mkdtempSync } from 'node:fs';
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
  await search({ source: 'tm', pages: 1 });
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

test('every source the schema declares is one the server can actually dispatch', async () => {
  // The list is written twice - SOURCE_CODES, which the schema derives from, and
  // the adapter map the dispatch reads. A code in one but not the other is
  // silent either way, so every declared source is called.
  await withServer('server-store-test-sources', { JOBS_PROFILE: 'android' }, async (watcher) => {
    const { tools } = await watcher.listTools();
    const declared = tools.find((t) => t.name === 'jobs_search').inputSchema.properties.source.enum;
    assert.ok(declared.length >= 6, 'the schema names every source');
    for (const source of declared) {
      const res = await watcher.callTool({ name: 'jobs_count', arguments: { source } });
      assert.equal(res.isError, undefined, `${source}: ${res.content[0].text}`);
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
