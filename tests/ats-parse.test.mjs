// The employer watchlist: three providers, one record shape, and the one field
// no job board in this repository can offer.
//
// `applyAtEmployer` is true here and it is not a courtesy: the url addresses the
// employer's own instance of their own applicant tracking system. That is what
// the source exists for, so it is asserted for every provider rather than for a
// sample.
//
// The second reason it exists is the text. A board restates a posting; an
// employer publishes it, and the sentences that decide a posting - the work
// authorisation notice, the office requirement, the language of the stack - are
// only in the published version. So the seam is tested here, not just the
// detector: fixture in, signals out.
//
// No network. The fixtures are the providers' own shapes with invented
// companies, invented ids and invented postings.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { PROVIDERS, PROVIDER_NAMES, normalize, search } from '../adapters/ats.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => JSON.parse(readFileSync(join(HERE, `fixtures/${name}`), 'utf8'));
const PAYLOAD = {
  greenhouse: fixture('ats-greenhouse.json'),
  ashby: fixture('ats-ashby.json'),
  bamboohr: fixture('ats-bamboohr.json'),
};
const ENTRY = {
  greenhouse: { provider: 'greenhouse', slug: 'gammaco' },
  ashby: { provider: 'ashby', slug: 'deltalabs', name: 'DeltaLabs' },
  bamboohr: { provider: 'bamboohr', slug: 'epsilongroup', name: 'EpsilonGroup' },
};

/** Every provider's records, normalised, with no signals asked for. */
const recordsOf = (provider, signalConfig = {}) =>
  PROVIDERS[provider].list(PAYLOAD[provider])
    .map((raw) => normalize(PROVIDERS[provider].record(raw, ENTRY[provider]), ENTRY[provider], signalConfig));

test('every provider in the fixture set is one the adapter knows', () => {
  assert.deepEqual(PROVIDER_NAMES.sort(), ['ashby', 'bamboohr', 'greenhouse']);
});

test('every record leads to the employer own system, on every provider', () => {
  for (const provider of PROVIDER_NAMES) {
    for (const job of recordsOf(provider)) {
      assert.equal(job.applyAtEmployer, true, `${provider} ${job.id}`);
      assert.match(job.url, /^https:\/\//, `${provider} ${job.id}`);
    }
  }
});

test('the shape matches the other adapters exactly, on every provider', () => {
  const shape = ['id', 'source', 'company', 'title', 'url', 'applyAtEmployer', 'country',
                 'locationVerified', 'format', 'salaryLabel', 'salaryMinUsd', 'skills',
                 'hasRussianRoots', 'visa', 'date'];
  for (const provider of PROVIDER_NAMES) {
    const [job] = recordsOf(provider);
    for (const key of shape) assert.ok(key in job, `${provider} is missing ${key}`);
    assert.equal(job.source, 'ats');
    assert.equal(job.provider, provider);
    assert.equal(job.locationVerified, false, 'the employer stating a place is still a claim');
  }
});

test('ids carry the provider and the company, so two instances cannot collide', () => {
  assert.equal(recordsOf('greenhouse')[0].id, 'ats:gh:gammaco:7000001');
  assert.equal(recordsOf('bamboohr')[0].id, 'ats:bamboo:epsilongroup:101');
  assert.match(recordsOf('ashby')[0].id, /^ats:ashby:deltalabs:/);
});

test('the company is the provider name where it has one, and the watchlist name otherwise', () => {
  assert.equal(recordsOf('greenhouse')[0].company, 'GammaCo', 'this provider names it');
  assert.equal(recordsOf('ashby')[0].company, 'DeltaLabs', 'these two do not, so the profile does');
  assert.equal(recordsOf('bamboohr')[0].company, 'EpsilonGroup');
});

test('no provider states a period beside an amount, so nothing enters the USD field', () => {
  for (const provider of PROVIDER_NAMES) {
    for (const job of recordsOf(provider)) assert.equal(job.salaryMinUsd, null, provider);
  }
  assert.equal(recordsOf('ashby')[0].salaryLabel, '€60K – €80K', 'the figure is still readable');
  assert.equal(recordsOf('greenhouse')[0].salaryLabel, 'not stated');
});

test('no provider publishes a skill list, and none is invented', () => {
  for (const provider of PROVIDER_NAMES) {
    for (const job of recordsOf(provider)) assert.deepEqual(job.skills, [], provider);
  }
});

test('a posting body arrives twice-escaped from one provider and is read as text', () => {
  // `&lt;p&gt;` has to become `<p>` before it can become text, so this provider
  // needs a pass the other two do not. Asserted on the body the adapter hands
  // over rather than on the quote: whoever reads the text next decodes it once
  // more, which would hide a body still full of markup here.
  const [raw] = PROVIDERS.greenhouse.list(PAYLOAD.greenhouse);
  const { text } = PROVIDERS.greenhouse.record(raw, ENTRY.greenhouse);
  assert.doesNotMatch(text, /[<>]|&lt;|&gt;|&amp;/);
  assert.match(text, /^We are hiring a backend engineer\./);
});

// The seam: the employer's own text through the detector and into the record.
const SIGNALS = {
  phrases: { usWorkAuthorization: ['This employer participates in E-Verify'] },
  onsite: true,
  languages: ['Go', 'Scala'],
};

test('the three signals come out of a real posting body, quoted', () => {
  const [walled] = recordsOf('greenhouse', SIGNALS);
  assert.deepEqual(walled.signals.map((s) => s.name).sort(), ['Go', 'onsite', 'usWorkAuthorization']);
  assert.match(walled.note, /usWorkAuthorization: "This employer participates in E-Verify/);
  assert.match(walled.note, /onsite: "/);
  assert.match(walled.note, /Go: "Strong production experience in Go/);
});

test('the posting next to it raises none of them, on the same three settings', () => {
  // Remote, office optional, and "Go and/or Node.js". Metadata cannot tell these
  // two postings apart; the text can.
  const open = recordsOf('greenhouse', SIGNALS)[1];
  assert.deepEqual(open.signals, []);
  assert.equal(open.note, null);
});

test('a hybrid posting is raised and a remote one beside it is not', () => {
  const [remote, hybrid] = recordsOf('ashby', SIGNALS);
  assert.deepEqual(remote.signals, [], 'office open, attendance optional, Go and/or Rust');
  assert.deepEqual(hybrid.signals.map((s) => s.name).sort(), ['Scala', 'onsite']);
});

test('a provider that publishes no body raises nothing rather than guessing', () => {
  for (const job of recordsOf('bamboohr', SIGNALS)) {
    assert.deepEqual(job.signals, []);
    assert.equal(job.note, null);
  }
});

// The walk over companies. `pages` means companies here, and the totals have to
// keep saying which is which.
function stub(payloads = PAYLOAD) {
  const asked = [];
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    const provider = PROVIDER_NAMES.find((p) => String(url).includes(
      { greenhouse: 'greenhouse.io', ashby: 'ashbyhq.com', bamboohr: 'bamboohr.com' }[p]));
    return { ok: true, status: 200, json: async () => payloads[provider] };
  };
  return asked;
}

const WATCHLIST = [ENTRY.greenhouse, ENTRY.ashby, ENTRY.bamboohr];

test('what the watched employers have open travels beside what was collected', async () => {
  stub();
  const out = await search({ watchlist: WATCHLIST }, 3);
  assert.equal(out.found, 9 + 2 + 4, 'two providers state a total; the third is its own list');
  assert.equal(out.length, 6);
  assert.equal(out.complete, true);
});

test('a walk cut short says so instead of reading as the whole watchlist', async () => {
  stub();
  const out = await search({ watchlist: WATCHLIST }, 1);
  assert.equal(out.complete, false);
  assert.equal(out.length, 2, 'one company read');
});

test('a query is a local filter here, and the answer says how much it dropped', async () => {
  // No provider offers a search parameter, so a query that silently narrowed the
  // result would be the board's own answer in shape and nobody's in fact.
  stub();
  const out = await search({ watchlist: [ENTRY.greenhouse], query: 'platform' }, 1);
  assert.equal(out.found, 9, 'still what the employer has open');
  assert.equal(out.length, 1);
  assert.equal(out.filtered, 1);
});

test('an unknown company is an error, not an employer with nothing open', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
  await assert.rejects(() => search({ watchlist: [ENTRY.greenhouse] }, 1), /has no board "gammaco"/);
});

test('a redirect is an unknown company too, and is never followed', async () => {
  // One provider answers an unknown subdomain with a redirect to its own
  // marketing site. Followed, that parses as "this company has no openings".
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push(init.redirect);
    return { ok: false, status: 302, json: async () => ({}) };
  };
  await assert.rejects(() => search({ watchlist: [ENTRY.bamboohr] }, 1), /has no board "epsilongroup"/);
  assert.deepEqual(seen, ['manual']);
});

test('an answer without a list of postings is refused', async () => {
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ meta: { total: 3 } }) });
  await assert.rejects(() => search({ watchlist: [ENTRY.greenhouse] }, 1), /without a list of postings/);
});
