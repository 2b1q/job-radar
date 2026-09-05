// The TalentMove card parser, pinned against a fixture.
//
// This is the most fragile thing in the repo: the board renders cards server
// side, and a class rename would leave the parser returning nothing while the
// envelope cheerfully reports results. That reads as "no new jobs", which is the
// failure we keep hunting - the one that does not look like a failure.
//
// No network. Run: node --test tests/
//
// The fixture is SYNTHETIC and says so in its own first field. It pins the
// parser against the envelope shape we believe in, which is strictly less than
// pinning it against the shape the board actually sends; swap in a real,
// scrubbed envelope once one can be captured with a session.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseCards } from '../adapters/talentmove.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const envelope = JSON.parse(readFileSync(join(HERE, 'fixtures/tm-envelope.json'), 'utf8'));
const jobs = parseCards(envelope.html, envelope.found_posts);

const articles = (html) => (html.match(/<article class="card-job">/g) || []).length;

test('every article in the html becomes a job', () => {
  assert.equal(jobs.length, articles(envelope.html));
  assert.equal(jobs.length, envelope.found_posts);
});

test('ids are namespaced to the board', () => {
  // Deliberately only this board: AgileFluent ids stay bare, because 284 rows
  // in the store carry statuses under them and a prefix would orphan every one.
  for (const j of jobs) assert.match(j.id, /^tm:\d+$/);
  assert.equal(new Set(jobs.map((j) => j.id)).size, jobs.length, 'ids are unique');
});

test('company loses the leading @', () => {
  for (const j of jobs) {
    assert.ok(j.company, 'company is present');
    assert.ok(!j.company.startsWith('@'), `still prefixed: ${j.company}`);
  }
});

test('url comes out unescaped', () => {
  // The envelope carries escaped slashes; a job url with a backslash in it is a
  // link that does not open.
  for (const j of jobs) {
    assert.ok(!j.url.includes('\\'), `escaped url survived: ${j.url}`);
    assert.match(j.url, /^https:\/\//);
  }
});

test('skills are filled from the tags', () => {
  const withTags = jobs.filter((j) => j.skills.length);
  assert.ok(withTags.length >= 2, 'the fixture has tagged cards and they parse');
  for (const j of withTags) for (const s of j.skills) assert.ok(s.length, 'no empty skill');
});

test('an estimate is not a salary, and the label says which', () => {
  const verified = jobs.find((j) => j.salaryLabel.includes('from posting'));
  const estimated = jobs.find((j) => j.salaryLabel.includes('site estimate'));
  assert.ok(verified, 'a verified figure is labelled as coming from the posting');
  assert.ok(estimated, "the site's own estimate is labelled as an estimate");
  assert.notEqual(verified.id, estimated.id);
});

test('a card without a salary says so rather than inventing one', () => {
  const none = jobs.filter((j) => j.salaryLabel === 'not stated');
  assert.equal(none.length, 1);
});

test('location and format are carried through', () => {
  for (const j of jobs) {
    assert.ok(j.country, 'country is present');
    assert.ok(j.format, 'format is present');
  }
});

test('results with nothing parsed is an error, not an empty page', () => {
  // The guard that turns a silent layout change into a loud one.
  assert.throws(() => parseCards('<div>nothing here</div>', 12), /markup changed/);
});

test('the guard fires on a renamed class, not just on empty html', () => {
  // Teeth. Same envelope, one class renamed the way a redesign would rename it:
  // if this passed, a layout change would read as "no new jobs".
  const renamed = envelope.html.replaceAll('<article class="card-job">',
                                           '<article class="card-vacancy">');
  assert.equal(articles(renamed), 0, 'the fixture really was mutated');
  assert.throws(() => parseCards(renamed, envelope.found_posts), /markup changed/);
});

test('a renamed link class is caught too', () => {
  // The article survives the split but the card yields nothing, which is the
  // subtler half of the same failure.
  const renamed = envelope.html.replaceAll('class="card-job__link"', 'class="job-link"');
  assert.throws(() => parseCards(renamed, envelope.found_posts), /markup changed/);
});

test('an empty page really is empty', () => {
  // found_posts 0 with no cards is the legitimate case and must not throw, or
  // every quiet day becomes an incident.
  assert.deepEqual(parseCards('', 0), []);
});

test('one broken card does not lose the others', () => {
  const broken = '<article class="card-job">no link at all</article>' + envelope.html;
  assert.equal(parseCards(broken, envelope.found_posts).length, jobs.length);
});

test('a company wrapped in a tag does not arrive with a space in front', () => {
  // What the board actually sends for some employers: the name inside a link.
  // `strip` turns the tag into a space, and removing only the `@` left a value
  // with a space in front of the name. The keys survived it - see
  // store-dedup - but the value a human reads should not have to.
  const wrapped = envelope.html.replaceAll(
    '>@ExampleCo<', '>@<a href="/company/exampleco">ExampleCo</a><');
  const [first] = parseCards(wrapped, envelope.found_posts);
  assert.equal(first.company, 'ExampleCo');
});

test('a company that is only a handle marker is no company', () => {
  const empty = envelope.html.replaceAll('>@ExampleCo<', '>@<');
  const [first] = parseCards(empty, envelope.found_posts);
  assert.equal(first.company, null, 'an empty string is not a name');
});
