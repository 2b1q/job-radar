// Just enough XML to read a job feed - and the four ways a feed can say
// something that this has to keep apart.
//
// It exists because one applicant tracking system answers RSS and five answer
// JSON, and a parser dependency for one feed is not worth having. The risk it
// carries is the repository's usual one: a reader that quietly returns the
// wrong string rather than failing.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { elements, field } from '../adapters/_shared/xml.mjs';

const FEED = `<?xml version="1.0"?>
<rss xmlns:tt="https://example.invalid/x">
  <channel>
    <title>Channel title</title>
    <item>
      <title>First</title>
      <tt:city>Warsaw</tt:city>
      <tt:zip/>
      <guid isPermaLink="false">g-1</guid>
    </item>
    <item>
      <title><![CDATA[Second & last]]></title>
      <tt:city>Berlin</tt:city>
      <guid isPermaLink="false">g-2</guid>
    </item>
  </channel>
</rss>`;

test('every repeated element comes back, in the order the feed wrote them', () => {
  const items = elements(FEED, 'item');
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((i) => field(i, 'guid')), ['g-1', 'g-2']);
});

test('a namespaced name is a name, not a lookup', () => {
  // The feed spells it `tt:city`; nothing here resolves the namespace, and that
  // is the documented limit rather than an oversight.
  assert.deepEqual(elements(FEED, 'item').map((i) => field(i, 'tt:city')), ['Warsaw', 'Berlin']);
});

test('an attribute does not hide the element it is on', () => {
  assert.equal(field(elements(FEED, 'item')[0], 'guid'), 'g-1');
});

test('CDATA is unwrapped, because a title is not markup', () => {
  // Handed back whole, `<![CDATA[Second & last]]>` would travel into a dedup key
  // and match nothing, in silence.
  assert.equal(field(elements(FEED, 'item')[1], 'title'), 'Second & last');
});

test('stated-and-empty is not the same answer as never stated', () => {
  const [first, second] = elements(FEED, 'item');
  assert.equal(field(first, 'tt:zip'), '', 'the feed states this one as empty');
  assert.equal(field(second, 'tt:zip'), null, 'and does not state this one at all');
  assert.equal(field(first, 'tt:nothing'), null);
});

test('the first element wins, so a channel field is read before any item', () => {
  assert.equal(field(FEED.split('<item>')[0], 'title'), 'Channel title');
});

test('entities are left for the text module, which is where decoding lives', () => {
  // Structure here, text there: `strip()` decodes to a fixed point, and a second
  // decoder in front of it is how a twice-escaped body became unreadable once.
  assert.equal(field('<d>&lt;p&gt;hello&lt;/p&gt;</d>', 'd'), '&lt;p&gt;hello&lt;/p&gt;');
});

test('nothing to read is null, not an empty string, and never a throw', () => {
  assert.deepEqual(elements(null, 'item'), []);
  assert.deepEqual(elements('', 'item'), []);
  assert.equal(field(null, 'title'), null);
  assert.equal(field('<not-xml', 'title'), null);
});
