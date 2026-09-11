// The employer watchlist: three providers, one record shape, and the field no
// board here can offer - `applyAtEmployer: true`, asserted for every provider.
//
// The other half is the text: only the employer's own posting carries the
// sentences the signals read, so the seam is tested here, not just the detector.
//
// No network. The fixtures are the providers' shapes with invented postings.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { PROVIDERS, PROVIDER_NAMES, money, normalize, search } from '../adapters/ats.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => JSON.parse(readFileSync(join(HERE, `fixtures/${name}`), 'utf8'));
const raw = (name) => readFileSync(join(HERE, `fixtures/${name}`), 'utf8');
const TEAMTAILOR_FEED = raw('ats-teamtailor.xml');
const PAYLOAD = {
  greenhouse: fixture('ats-greenhouse.json'),
  ashby: fixture('ats-ashby.json'),
  bamboohr: fixture('ats-bamboohr.json'),
  // This provider answers a bare array; the file wraps it only so that it can
  // declare itself synthetic, and `list()` is handed the array itself.
  lever: fixture('ats-lever.json').postings,
  workable: fixture('ats-workable.json'),
  recruitee: fixture('ats-recruitee.json'),
  // The one provider that answers RSS: what `list()` is handed is what its own
  // `parse` hook made, which is the seam worth exercising rather than mocking.
  teamtailor: PROVIDERS.teamtailor.parse(TEAMTAILOR_FEED),
};
const ENTRY = {
  greenhouse: { provider: 'greenhouse', slug: 'gammaco' },
  ashby: { provider: 'ashby', slug: 'deltalabs', name: 'DeltaLabs' },
  bamboohr: { provider: 'bamboohr', slug: 'epsilongroup', name: 'EpsilonGroup' },
  lever: { provider: 'lever', slug: 'zetaworks', name: 'ZetaWorks' },
  // Deliberately unnamed: this provider states the company on its envelope, and
  // the walk is what carries it to the record.
  workable: { provider: 'workable', slug: 'etasystems' },
  recruitee: { provider: 'recruitee', slug: 'thetalabs' },
  // Unnamed for the same reason as workable: this provider states the company
  // on the feed's channel rather than on a posting.
  teamtailor: { provider: 'teamtailor', slug: 'iotaworks' },
};

/** Every provider's records, normalised, with no signals asked for. */
const recordsOf = (provider, signalConfig = {}) =>
  PROVIDERS[provider].list(PAYLOAD[provider])
    .map((raw) => normalize(PROVIDERS[provider].record(raw, ENTRY[provider]), ENTRY[provider], signalConfig));

test('every provider in the fixture set is one the adapter knows', () => {
  assert.deepEqual([...PROVIDER_NAMES].sort(),
    ['ashby', 'bamboohr', 'greenhouse', 'lever', 'recruitee', 'teamtailor', 'workable']);
  for (const provider of PROVIDER_NAMES) {
    assert.ok(PAYLOAD[provider], `${provider} has a fixture`);
  }
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

test('a figure enters the USD field only where a currency and a year are both stated', () => {
  // Five of the six providers can never reach it, and the sixth only on the
  // records where it states both. A monthly figure ranked as a yearly one is
  // the whole reason this field is guarded rather than filled.
  for (const provider of ['greenhouse', 'ashby', 'bamboohr', 'workable', 'recruitee', 'teamtailor']) {
    for (const job of recordsOf(provider)) assert.equal(job.salaryMinUsd, null, provider);
  }
  assert.equal(recordsOf('ashby')[0].salaryLabel, '€60K – €80K', 'the figure is still readable');
  assert.equal(recordsOf('greenhouse')[0].salaryLabel, 'not stated');
  assert.equal(recordsOf('workable')[0].salaryLabel, 'not stated', 'this one publishes none at all');

  const [usdYear, otherCurrency, usdMonth, noAmount] = recordsOf('lever');
  assert.equal(usdYear.salaryMinUsd, 150000, 'USD and the provider own word for a year');
  assert.equal(otherCurrency.salaryMinUsd, null, 'a yearly figure in euro is still only a label');
  assert.match(otherCurrency.salaryLabel, /EUR\/per-year-salary/);
  assert.equal(usdMonth.salaryMinUsd, null, 'USD a MONTH must never be sorted against USD a year');
  assert.match(usdMonth.salaryLabel, /USD\/per-month-salary/);
  assert.equal(noAmount.salaryLabel, 'not stated');
  assert.equal(noAmount.salaryMinUsd, null);
});

test('the provider that names both is the only one that can, and money says why', () => {
  // Measured spellings only: a period this provider has never been seen to send
  // is not a period this repository recognises.
  assert.deepEqual(money({ min: 1000, currency: 'USD', interval: 'per-year-salary' }, 'per-year-salary'),
                   { label: '1000-1000 USD/per-year-salary', usd: 1000 });
  assert.equal(money({ min: 1000, currency: 'USD', period: 'year' }).usd, null,
               'a provider whose yearly spelling was never measured passes null and gets null');
  assert.equal(money({ min: 1000, currency: 'USD', interval: 'weekly' }, 'per-year-salary').usd, null);
  assert.deepEqual(money(null), { label: 'not stated', usd: null });
  assert.deepEqual(money({ min: '', currency: 'EUR', period: 'month' }), { label: 'not stated', usd: null });
  assert.match(money({ min: 5, max: 9 }).label, /currency not stated\/period not stated/);
});

test('whether there was anything to read travels with every record', () => {
  // One provider leaves the body off some postings, and a record with no
  // signals over an empty body says nothing about the job.
  const lever = recordsOf('lever', SIGNALS);
  assert.deepEqual(lever.map((j) => j.textAvailable), [true, true, true, false]);
  assert.deepEqual(lever[3].signals, [], 'nothing was read, so nothing was raised');
  assert.equal(lever[3].note, null);
  for (const job of recordsOf('bamboohr')) {
    assert.equal(job.textAvailable, false, 'this provider publishes no body at all');
  }
  for (const job of recordsOf('greenhouse')) assert.equal(job.textAvailable, true);
});

test('the employer claim is recorded as the provider own, never as a host reading', () => {
  // On one provider the link is the company's own careers domain rather than
  // the provider's, so a later classifier reading hosts must be able to see
  // that this row did not come from a host.
  for (const provider of PROVIDER_NAMES) {
    for (const job of recordsOf(provider)) assert.equal(job.applyFrom, 'provider', provider);
  }
  const [hybrid] = recordsOf('recruitee');
  assert.match(hybrid.url, /^https:\/\/jobs\.thetalabs\.example\//,
               'and the link is kept exactly as the provider stated it');
  assert.doesNotMatch(hybrid.url, /recruitee\.com/);
});

test('four date dialects come out as YYYY-MM-DD or as nothing', () => {
  // Epoch milliseconds, `2026-08-19 13:55:09 UTC` that no parser is required to
  // accept, RFC 822 with an offset, and one that already sends the date.
  for (const job of recordsOf('lever')) assert.match(job.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(recordsOf('recruitee').map((j) => j.date), ['2026-08-19', '2026-09-04']);
  assert.deepEqual(recordsOf('teamtailor').map((j) => j.date),
                   ['2026-09-07', '2026-09-02', '2026-09-04']);
  assert.equal(recordsOf('workable')[0].date, '2026-09-02', 'and one already sends the date itself');
  for (const job of recordsOf('bamboohr')) assert.equal(job.date, null, 'stating none is not a date');
});

test('a feed is read as a feed: CDATA, an empty field and a missing one', () => {
  // The three ways an RSS field can be written, and the three different answers
  // they have to produce. A title handed back as `<![CDATA[...]]>` would travel
  // into the dedup key and match nothing.
  const [hybrid, remote, cdata] = recordsOf('teamtailor');
  assert.equal(cdata.title, 'Data Engineer & Analyst', 'unwrapped, and its entity decoded');
  assert.doesNotMatch(cdata.title, /CDATA|&amp;/);
  assert.equal(remote.country, 'Poland', 'an empty <tt:city/> contributes nothing');
  assert.equal(hybrid.country, 'Warsaw, Poland');
  assert.match(hybrid.url, /^https:\/\/careers\.iotaworks\.example\//,
               'the link is on the company own domain and is kept');
  assert.match(hybrid.id, /^ats:teamtailor:iotaworks:c1000000-/, 'the guid, which is not the link');
});

test('a work mode is copied, and the word for "none" is not one', () => {
  assert.deepEqual(recordsOf('lever').map((j) => j.format), ['hybrid', 'remote', 'onsite', null]);
  assert.deepEqual(recordsOf('workable').map((j) => j.format), ['remote', null]);
  assert.deepEqual(recordsOf('recruitee').map((j) => j.format), ['hybrid', 'remote']);
  // `none` is this provider's word for "no remote work", which is not the claim
  // that a job is in an office - so it becomes no claim rather than a derived one.
  assert.deepEqual(recordsOf('teamtailor').map((j) => j.format), ['hybrid', 'remote', null]);
});

test('no provider publishes a skill list, and none is invented', () => {
  for (const provider of PROVIDER_NAMES) {
    for (const job of recordsOf(provider)) assert.deepEqual(job.skills, [], provider);
  }
});

test('a posting body arrives twice-escaped from one provider and is read as text', () => {
  // `&lt;p&gt;` must become `<p>` before it becomes text. Asserted on the body the
  // adapter hands over: the next reader decodes again and would hide the markup.
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
  // Remote, office optional, "Go and/or Node.js". Metadata cannot tell the two apart.
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

// The walk over companies: `pages` means companies here.
function stub(payloads = PAYLOAD) {
  const asked = [];
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    const provider = PROVIDER_NAMES.find((p) => String(url).includes({
      greenhouse: 'greenhouse.io', ashby: 'ashbyhq.com', bamboohr: 'bamboohr.com',
      lever: 'api.lever.co', workable: 'apply.workable.com', recruitee: '.recruitee.com',
      teamtailor: 'teamtailor.com',
    }[p]));
    // One provider is read with `res.text()` and its own parse hook; the rest
    // with `res.json()`. The RSS body REFUSES to be read as JSON, exactly as a
    // real one does - a stub that answered both hid the hook entirely: skipping
    // `parse` broke nothing, because the stub had already parsed it.
    return {
      ok: true, status: 200,
      json: async () => {
        if (provider === 'teamtailor') throw new SyntaxError('Unexpected token < in JSON at position 0');
        return payloads[provider];
      },
      text: async () => TEAMTAILOR_FEED,
    };
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
  assert.equal(out.errors, undefined, 'nothing failed, so nothing is reported');
  assert.deepEqual(out.companies.map((c) => c.slug), ['gammaco', 'deltalabs', 'epsilongroup']);
});

test('the company named on an envelope reaches the record, and the profile still wins', async () => {
  // One provider states the company on the envelope rather than on a posting,
  // so it travels through the walk. What to call an employer is still the
  // reader's business: a name in the profile is not overwritten by the board.
  stub();
  const anonymous = await search({ watchlist: [ENTRY.workable] }, 1);
  assert.equal(anonymous[0].company, 'EtaSystems', 'the envelope, not the slug');

  const named = await search({ watchlist: [{ ...ENTRY.workable, name: 'My own label' }] }, 1);
  assert.equal(named[0].company, 'My own label');
});

test('the RSS provider goes through its parse hook and out the same seam', async () => {
  // The whole point of the hook: one provider speaks a different dialect and
  // nothing past `get()` knows it. Read through `search`, not through `parse`.
  stub();
  const out = await search({ watchlist: [ENTRY.teamtailor], signalConfig: SIGNALS }, 1);
  assert.equal(out.length, 3);
  assert.equal(out.found, 3, 'a feed states no total, so its own length is one');
  assert.equal(out.complete, true);
  assert.equal(out[0].company, 'IotaWorks', 'the channel title, through the same hook as an envelope');
  for (const job of out) assert.equal(job.applyAtEmployer, true);
  assert.deepEqual(out[0].signals.map((s) => s.name).sort(), ['Go', 'onsite', 'usWorkAuthorization']);
  assert.deepEqual(out[1].signals, [], 'office optional, Go and/or Rust');
});

test('a provider with nothing open is an answer, and an unknown one is a failure', async () => {
  // Measured on two of the three new providers: 200 with an empty list means
  // the company answered and has nothing, 404 means the slug is wrong. Reading
  // them alike is how a typo becomes "this employer is not hiring".
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => [] });
  const empty = await search({ watchlist: [ENTRY.lever] }, 1);
  assert.equal(empty.length, 0);
  assert.equal(empty.found, 0);
  assert.equal(empty.errors, undefined, 'a company that answered did not fail');
  assert.equal(empty.complete, true);

  globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
  const missing = await search({ watchlist: [ENTRY.lever] }, 1);
  assert.match(missing.errors[0].message, /has no board "zetaworks"/);
  assert.equal(missing.complete, false);
});

test('a walk cut short says so instead of reading as the whole watchlist', async () => {
  stub();
  const out = await search({ watchlist: WATCHLIST }, 1);
  assert.equal(out.complete, false);
  assert.equal(out.length, 2, 'one company read');
});

test('a query is a local filter here, and the answer says how much it dropped', async () => {
  // No provider offers a search parameter, so a silent narrowing would look like theirs.
  stub();
  const out = await search({ watchlist: [ENTRY.greenhouse], query: 'platform' }, 1);
  assert.equal(out.found, 9, 'still what the employer has open');
  assert.equal(out.length, 1);
  assert.equal(out.filtered, 1);
});

test('an unknown company is reported, not treated as one with nothing open', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
  const out = await search({ watchlist: [ENTRY.greenhouse] }, 1);
  assert.equal(out.length, 0);
  assert.match(out.errors[0].message, /has no board "gammaco"/);
  assert.equal(out.errors[0].slug, 'gammaco');
  assert.equal(out.complete, false, 'a company that did not answer is not a complete read');
});

test('a redirect is an unknown company too, and is never followed', async () => {
  // One provider redirects an unknown subdomain to marketing; followed, that
  // parses as "this company has no openings".
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push(init.redirect);
    return { ok: false, status: 302, json: async () => ({}) };
  };
  const out = await search({ watchlist: [ENTRY.bamboohr] }, 1);
  assert.match(out.errors[0].message, /has no board "epsilongroup"/);
  assert.deepEqual(seen, ['manual']);
});

test('an answer without a list of postings is refused', async () => {
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ meta: { total: 3 } }) });
  const out = await search({ watchlist: [ENTRY.greenhouse] }, 1);
  assert.match(out.errors[0].message, /without a list of postings/);
});

test('one bad company does not cost the ones after it', async () => {
  // The failure this isolation exists for: the first slug in a watchlist had
  // gone stale, and it took the whole source down with it.
  globalThis.fetch = async (url) => (String(url).includes('greenhouse.io')
    ? { ok: false, status: 404, json: async () => ({}) }
    : { ok: true, status: 200, json: async () => PAYLOAD.ashby });
  const out = await search({ watchlist: [ENTRY.greenhouse, ENTRY.ashby] }, 2);
  assert.equal(out.length, 2, 'the second company still answered');
  assert.equal(out.errors.length, 1);
  assert.equal(out.errors[0].slug, 'gammaco');
  assert.deepEqual(out.companies.map((c) => c.slug), ['deltalabs'], 'only the one that answered counts');
  assert.equal(out.found, 2, 'and the total is over the companies that answered');
  assert.equal(out.complete, false);
});
