// What a request becomes for the two sources added last, and what the profile is
// refused for.
//
// Both boards belong to the class this repository keeps finding: an unknown
// parameter NAME is accepted and dropped, and an unknown VALUE is answered with
// a silent zero. The second is the one that reads as "the market is empty", so
// every value that CAN be checked without a request is checked here, before the
// run starts.
//
// The third case is the query on AgileFluent, which is not a keyword search at
// all. Measurements in notes/agilefluent.md; what they mean for a caller is
// asserted below.
//
// No network, and no personal profile: every case is a profile in the fixture.

import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.JOBS_PROFILES = 'tests/fixtures/profiles-sources.json';

/** params.mjs reads the profile at import, so each shape needs its own load. */
let loaded = 0;
const load = async (profile) => {
  process.env.JOBS_PROFILE = profile;
  return import(`../params.mjs?sources=${(loaded += 1)}`);
};

test('the profile grades become the board own qualification ids', async () => {
  const { hcParams } = await load('watcher');
  assert.deepEqual(hcParams({ preset: 'remote' }).qids, [4, 5]);
});

test('a grade the board does not have is refused here, not answered with zero', async () => {
  const { hcParams } = await load('badgrade');
  assert.throws(() => hcParams({ preset: 'remote' }),
                /not a grade this board has.*zero results/s);
});

test('the remote preset is the only one this board can express', async () => {
  const { hcParams } = await load('watcher');
  assert.equal(hcParams({ preset: 'remote' }).remote, true);
  // Stubs, and that is a measurement: the board's place dimension is its own
  // city taxonomy and it has no notion of where a company has its roots.
  for (const preset of ['anywhere', 'countries', 'ruroots']) {
    assert.equal(hcParams({ preset }).remote, undefined, preset);
  }
});

test('this board skills are its numeric term ids, and a slug is refused', async () => {
  const { hcParams } = await load('watcher');
  assert.deepEqual(hcParams({ preset: 'remote', skills: ['264'] }).skills, ['264']);
  const bad = await load('badskill');
  assert.throws(() => bad.hcParams({ preset: 'remote', skills: bad.skillsFor('hc') }),
                /numeric term ids/);
});

test('the watchlist comes back validated, with the optional name kept', async () => {
  const { watchlist } = await load('watcher');
  assert.deepEqual(watchlist(), [
    { provider: 'greenhouse', slug: 'example-co', name: 'Example Co' },
    { provider: 'ashby', slug: 'example-labs' },
    { provider: 'bamboohr', slug: 'example-group' },
  ]);
});

test('no watchlist is an empty one, and the caller decides what that means', async () => {
  const { watchlist } = await load('nowatchlist');
  assert.deepEqual(watchlist(), []);
});

test('a provider nobody wrote an adapter for is refused at load', async () => {
  // Checked here rather than in the adapter: the entry would otherwise reach the
  // walk and fail after the other companies had already been read and paid for.
  const { watchlist } = await load('badprovider');
  assert.throws(() => watchlist(), /"workday", which is not one of/);
});

test('a url pasted where an instance name belongs is refused', async () => {
  const { watchlist } = await load('badslug');
  assert.throws(() => watchlist(), /not an instance name/);
});

test('the signal vocabulary is the profile own, and it survives the load intact', async () => {
  const { signalConfig } = await load('watcher');
  assert.deepEqual(signalConfig(), {
    phrases: { usWorkAuthorization: ['This employer participates in E-Verify'] },
    onsite: true,
    languages: ['Go', 'Scala'],
  });
});

test('no signals configured is no signals, not a default list', async () => {
  // A shipped stop list would be one person's search compiled into the tool.
  const { signalConfig } = await load('nowatchlist');
  assert.deepEqual(signalConfig(), {});
});

test('a signal named with nothing to look for is refused', async () => {
  const empty = await load('badphrases');
  assert.throws(() => empty.signalConfig(), /non-empty list of phrases/);
  const wrong = await load('badlanguages');
  assert.throws(() => wrong.signalConfig(), /must be a list of language names/);
});

// AgileFluent's `query` is an ordered phrase search: the words have to be
// adjacent and in order, so a stack typed as a query is a phrase nobody wrote
// and the board answers it with a zero. The counts are in notes/agilefluent.md.
test('a single term reaches the board as its search', async () => {
  const { afFilters } = await load('watcher');
  assert.equal(afFilters({ query: 'node.js' }).searchQuery, 'node.js');
});

test('a multi-word query is refused with what the board would have done with it', async () => {
  const { afFilters } = await load('watcher');
  assert.throws(() => afFilters({ query: 'backend node.js' }),
                /ordered phrase search.*silent zero/s);
});

test('a query of nothing but spaces is no query, not an empty one', async () => {
  const { afFilters } = await load('watcher');
  assert.equal('searchQuery' in afFilters({ query: '   ' }), false);
  assert.equal('searchQuery' in afFilters({}), false);
});
