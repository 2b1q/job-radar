// Skills are per board, because board vocabularies are not portable.
//
// The measured case: a profile listing `node-js` - a perfectly good slug
// somewhere - made every web3.career call fetch `/node-js-jobs`, which redirects
// to `/404`. The adapter was right to raise; the configuration was wrong, and
// nothing between the two said so. One list shared by three boards is a general
// shape asserting that the data travels, and this data does not travel.
//
// What can be checked locally is checked at load: which boards a profile names,
// and whether the entries are slugs at all. What cannot be checked locally is
// whether a board has a given slug - a whitelist of that would go stale the day
// a tag is added - so the case that IS knowable is caught instead: a slug this
// profile wrote for another board.
//
// No network, and no personal profile: every case is a profile in the fixture.

import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.JOBS_PROFILES = 'tests/fixtures/profiles-skills.json';

/** params.mjs reads the profile at import, so each shape needs its own load. */
let loaded = 0;
const load = async (profile) => {
  process.env.JOBS_PROFILE = profile;
  return import(`../params.mjs?skills=${(loaded += 1)}`);
};

test('a board with its own list gets it, and the others get the default', async () => {
  const { skillsFor } = await load('perboard');
  assert.deepEqual(skillsFor('w3'), ['node', 'typescript']);
  assert.deepEqual(skillsFor('tm'), ['node-js', 'typescript']);
  assert.deepEqual(skillsFor('af'), ['node-js', 'typescript']);
});

test('a plain list is still a profile, and it is every board', async () => {
  // The shape that shipped. It stays valid: one vocabulary is the right answer
  // until a second board disagrees with it.
  const { skillsFor } = await load('sharedlist');
  for (const source of ['af', 'tm', 'w3']) {
    assert.deepEqual(skillsFor(source), ['node-js', 'typescript']);
  }
});

test('no skills at all is empty, not an error', async () => {
  const { skillsFor } = await load('noskills');
  assert.deepEqual(skillsFor('w3'), []);
});

test('the tag web3.career is asked for comes from its own list', async () => {
  const { w3Tag } = await load('perboard');
  assert.equal(w3Tag('node'), 'node');
  assert.equal(w3Tag(['typescript', 'node']), 'typescript');
  assert.equal(w3Tag(''), null, 'no tag is the whole board, which is a real query');
  assert.equal(w3Tag(undefined), null);
});

test("another board's slug is refused before the request, not by /404", async () => {
  // The reported failure, caught where it can be read: the message names the
  // board, the slug, the list this board does have and the file to edit.
  const { w3Tag } = await load('perboard');
  assert.throws(() => w3Tag('node-js'), (err) => {
    assert.match(err.message, /"node-js" is this profile's slug for another board/);
    assert.match(err.message, /w3 uses \[node, typescript\]/);
    assert.match(err.message, /skills\.w3 in tests\/fixtures\/profiles-skills\.json/);
    return true;
  });
});

test('and the same slug is fine on the board it was written for', async () => {
  const { tmParams } = await load('perboard');
  assert.equal(tmParams({ skills: 'node-js' }).skills, 'node-js');
  // While the one written for web3.career is refused here, symmetrically.
  assert.throws(() => tmParams({ skills: 'node' }), /slug for another board/);
});

test('an unknown slug nobody claimed is passed through', async () => {
  // The profile is a vocabulary somebody cares about, not the board's dictionary.
  // Refusing everything outside it would make trying a new tag impossible.
  const { w3Tag, tmParams } = await load('perboard');
  assert.equal(w3Tag('golang'), 'golang');
  assert.equal(tmParams({ skills: 'kubernetes' }).skills, 'kubernetes');
});

test('with one shared list there is no other board to belong to', async () => {
  const { w3Tag } = await load('sharedlist');
  assert.equal(w3Tag('node-js'), 'node-js', 'the profile has not said the boards differ');
});

test('jobs.solana.com takes one term, and says which it did not use', async () => {
  // Its search narrows with every word - "rust" 76, "typescript" 69, "rust
  // solana" 62 - so a stack cannot be sent as one query. The first term is the
  // question asked; the rest come back in the answer rather than vanishing.
  const { solParams } = await load('perboard');
  assert.deepEqual(solParams({ preset: 'remote', skills: ['rust', 'solana'] }),
                   { workMode: 'remote', query: 'rust', ignored: ['solana'] });
});

test('an explicit query wins over the profile, and the profile is reported', async () => {
  const { solParams } = await load('perboard');
  const p = solParams({ preset: 'anywhere', query: 'validator', skills: ['rust'] });
  assert.equal(p.query, 'validator');
  assert.deepEqual(p.ignored, ['rust']);
  assert.equal(p.workMode, undefined, 'anywhere is both work modes, not a filter');
});

test('the presets this board cannot express are empty, not approximated', async () => {
  // `locations` is accepted and dropped by the API - the answer is the
  // unfiltered total - so a country preset here would be a filter that filters
  // nothing while looking like one.
  const { solParams } = await load('perboard');
  assert.equal(solParams({ preset: 'countries', skills: [] }).workMode, undefined);
  assert.equal(solParams({ preset: 'ruroots', skills: [] }).workMode, undefined);
  assert.equal(solParams({ preset: 'remote', skills: [] }).workMode, 'remote');
});

test("and it refuses another board's word too", async () => {
  const { solParams } = await load('perboard');
  assert.throws(() => solParams({ skills: ['node-js'] }), /slug for another board/);
  assert.throws(() => solParams({ skills: ['node'] }), /slug for another board/);
});

test('a source key nobody reads is refused at load', async () => {
  // The quietest of the four: `web3` is not a source, the key is ignored, the
  // board silently falls back to the default vocabulary, and the first sign of
  // it is a 404 somewhere in the middle of a run.
  await assert.rejects(() => load('badsource'), /skills\."web3" is not a board/);
});

test('an empty list for a board is refused at load', async () => {
  await assert.rejects(() => load('emptylist'), /skills\.w3 is empty/);
});

test('an entry that is not a slug is refused at load', async () => {
  await assert.rejects(() => load('notaslug'), /is not a slug/);
  await assert.rejects(() => load('notalist'), /must be a list of board slugs/);
});
