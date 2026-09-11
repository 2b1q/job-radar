// The registry is now the only list of boards: the tool schema, the dispatch
// table and the board paragraphs of both tool descriptions are derived from it.
// That is a saving only while every entry really is an adapter - a module
// missing one export reaches the user as a TypeError on the far side of a tool
// call, which is exactly the silence this repository is built against.
//
// Offline and pure: importing an adapter creates its throttle and nothing else.

import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { test } from 'node:test';

import { ADAPTERS, SOURCE_CODES } from '../adapters/index.mjs';

// `server.mjs` calls these around every tool call, before it knows which board
// it is talking to.
const CONTRACT = ['search', 'count', 'requestCount', 'beginCall', 'endCall'];

test('an adapter nobody registered is caught here, not by its absence', () => {
  // The whole saving is that the registry is the list. An adapter written and
  // left out of it is a board that silently does not exist.
  const files = readdirSync(new URL('../adapters/', import.meta.url))
    .filter((name) => name.endsWith('.mjs') && name !== 'index.mjs');
  assert.equal(files.length, SOURCE_CODES.length,
    `adapters/ holds ${files.join(', ')}; the registry lists ${SOURCE_CODES.join(', ')}`);
});

test('every entry answers the whole adapter contract', () => {
  for (const [code, adapter] of Object.entries(ADAPTERS)) {
    for (const name of CONTRACT) {
      assert.equal(typeof adapter[name], 'function', `${code} exports ${name}`);
    }
  }
});

test('each board counts its own requests, not a shared budget', () => {
  // One `createHttp` per adapter: a counter shared between two boards would let
  // a quiet board spend a busy one's ceiling, and `store.assertRequestsCounted`
  // would then be checking the wrong number.
  const counters = new Set(Object.values(ADAPTERS).map((a) => a.requestCount));
  assert.equal(counters.size, SOURCE_CODES.length);
});

test('a source code is a prefix the store can strip', () => {
  // `store.boardId` strips `^[a-z0-9]+:` off an id. A code with a dash or a
  // colon in it would survive that strip and dedup against nothing.
  for (const code of SOURCE_CODES) assert.match(code, /^[a-z0-9]+$/);
});
