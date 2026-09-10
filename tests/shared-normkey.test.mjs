// One normaliser, three call sites.
//
// Tag matching, title alignment and the store's dedup key each grew their own
// version, and they had already drifted: two removed separators, the third
// replaced them with a space. Nothing failed loudly - dedup would simply have
// stopped matching across boards.
//
// This test fails the moment someone reintroduces a local normalisation, which
// is the only way that drift gets caught before it costs a duplicate.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decode, normKey, strip } from '../adapters/_shared/text.mjs';
import { filterByTags } from '../adapters/talentmove.mjs';
import { pair } from '../adapters/web3career.mjs';

process.env.JOBS_DB_PATH = process.env.JOBS_DB_PATH
  || `${process.env.TMPDIR || '/tmp'}/jobs-normkey-${process.pid}.db`;
const store = await import('../store.mjs');

// Written the way three different boards would write the same thing.
const VARIANTS = ['Node.js', 'node js', 'NODE-JS', ' node.JS ', 'Node&nbsp;JS'];

test('all variants collapse to one key', () => {
  const keys = new Set(VARIANTS.map(normKey));
  assert.equal(keys.size, 1, `expected one key, got ${[...keys].join(', ')}`);
});

test('tag matching uses it', () => {
  for (const v of VARIANTS) {
    const kept = filterByTags([{ id: 'tm:1', skills: ['Node.js'] }], [v]);
    assert.equal(kept.length, 1, `tag filter did not match "${v}"`);
  }
});

test('title alignment uses it', () => {
  // `pair` compares a rendered title against a structured one; if it stopped
  // using the shared key, a punctuation difference would read as a misalignment
  // and every page would be refused.
  assert.doesNotThrow(() => pair(
    [{ '@type': 'JobPosting', title: 'Node.js Engineer', hiringOrganization: { name: 'X' } }],
    [{ id: '1', url: '/x/1', title: 'NODE-JS Engineer', company: 'X', tags: [],
       salaryEstimated: false, salaryText: '' }],
  ));
});

test('the dedup key uses it', () => {
  const keys = new Set(VARIANTS.map((v) => store.dupKey('ExampleCo', v)));
  assert.equal(keys.size, 1, `dupKey disagrees across variants: ${[...keys].join(' | ')}`);
});

test('and the three agree with each other, not just internally', () => {
  // The real failure was not that one was wrong - it was that they differed.
  const viaKey = normKey('Backend & Data');
  const viaStore = store.dupKey('X', 'Backend &amp; Data').split('|')[1];
  assert.equal(viaStore, viaKey);
});

test('entities are decoded to a fixed point, not once', () => {
  // One board escapes its envelope twice. A single pass left `&amp;` in the
  // title, and that title built a dup_key no other board could meet.
  assert.equal(decode('Backend &amp;amp; Blockchain'), 'Backend & Blockchain');
  assert.equal(strip('Engineer, Backend &amp;amp; Data'), 'Engineer, Backend & Data');
  assert.equal(normKey('Backend &amp;amp; Data'), normKey('Backend & Data'),
               'the two spellings now meet in the dedup key');
});

test('a closing block tag ends a sentence; a space does not', () => {
  // Measured on a live posting: flattening `</li>` to a space glued a list into
  // one sentence, and an office requirement was quoted together with the
  // heading that followed it.
  const html = '<ul><li>Ability to work in our NYC office</li>'
    + '<li>~3 days in office weekly</li></ul><h3>Nice to Have</h3><p>Snowflake</p>';
  assert.deepEqual(strip(html).split('\n'),
                   ['Ability to work in our NYC office', '~3 days in office weekly',
                    'Nice to Have', 'Snowflake']);
});

test('and a title with no markup is untouched by either', () => {
  assert.equal(strip('  Senior   Backend Engineer  '), 'Senior Backend Engineer');
});
