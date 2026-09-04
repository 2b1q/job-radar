// The per-call request ceiling.
//
// Throttling bounds the rate; nothing bounded the total, and the total is what a
// board meters. One tool call that pages deeply and then enriches can spend
// dozens of requests with every single one of them looking reasonable.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createHttp, MAX_REQUESTS_PER_CALL } from '../adapters/_shared/http.mjs';

const http = () => createHttp({ throttleMs: 1, jitterMs: 1 });

test('without a call open, nothing is capped', () => {
  const h = http();
  for (let i = 0; i < MAX_REQUESTS_PER_CALL * 2; i++) h.countRequest();
  assert.equal(h.requestCount(), MAX_REQUESTS_PER_CALL * 2);
});

// It throws rather than returning what it has: a short answer that looks whole
// is how "the niche is empty" gets read off a run that simply stopped.
test('a call that exceeds its budget throws, and names itself', () => {
  const h = http();
  h.beginCall('jobs_search on tm', 3);
  h.countRequest(); h.countRequest(); h.countRequest();
  assert.throws(() => h.countRequest(), /jobs_search on tm.*ceiling of 3/s);
});

test('the total keeps counting across calls, because the board counts it too', () => {
  const h = http();
  h.beginCall('first', 2);
  h.countRequest(); h.countRequest();
  assert.equal(h.endCall(), 2);
  h.beginCall('second', 2);
  h.countRequest();
  assert.equal(h.requestCount(), 3);
});

test('a fresh call starts from zero, not from where the last one stopped', () => {
  const h = http();
  h.beginCall('first', 2);
  h.countRequest(); h.countRequest();
  h.beginCall('second', 2);
  assert.doesNotThrow(() => { h.countRequest(); h.countRequest(); });
});
