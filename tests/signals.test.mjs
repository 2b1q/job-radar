// The three things a human currently opens a posting to find out.
//
// Each of them is a sentence away from its opposite - "hybrid" from "office
// optional", "strong production experience in Go" from "Go and/or Node.js" -
// and a title or a tag list settles none of them. So the unit under test is the
// grammar, and every case here is a pair: the sentence that should raise the
// signal and the sentence that should not.
//
// The vocabulary is the caller's, which is why every call passes its own. No
// list of stop words is asserted as a default anywhere: a default here would be
// one person's search compiled into the repository.
//
// Text is synthetic. No sentence below is copied from anybody's posting except
// the E-Verify notice, which is boilerplate US employers publish verbatim.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { detectSignals, signalNote } from '../adapters/_shared/signals.mjs';

const names = (found) => found.map((f) => f.name).sort();

test('nothing is asked for, so nothing is raised', () => {
  const text = 'Hybrid role in Berlin. Strong production experience in Go required.';
  assert.deepEqual(detectSignals(text, {}), []);
});

test('a configured phrase is raised, and the sentence around it comes back', () => {
  const config = { phrases: { usWorkAuthorization: ['This employer participates in E-Verify'] } };
  const [found] = detectSignals(
    'We are hiring. This employer participates in E-Verify and will provide the federal '
    + 'government with your Form I-9 information to confirm work authorization. Apply today.',
    config,
  );
  assert.equal(found.signal, 'phrase');
  assert.equal(found.name, 'usWorkAuthorization');
  assert.match(found.quote, /^This employer participates in E-Verify/);
  assert.doesNotMatch(found.quote, /Apply today/, 'the quote is the sentence, not the page');
});

test('a phrase nobody configured is not a signal', () => {
  const config = { phrases: { usWorkAuthorization: ['E-Verify'] } };
  assert.deepEqual(detectSignals('We sponsor visas for the right candidate.', config), []);
});

test('office presence is raised where it is required', () => {
  for (const sentence of [
    'This is a hybrid role based in Warsaw',
    'You will be in the office three days a week in the office with the team',
    'Two days per week in the office is expected',
    'This is an on-site position',
    'Relocation to Berlin is required',
  ]) {
    assert.equal(detectSignals(sentence, { onsite: true }).length, 1, sentence);
  }
});

test('and not where the office is an offer', () => {
  // The distinction the whole detector exists for. Every one of these names an
  // office and none of them asks anybody to come in.
  for (const sentence of [
    'An office in Lisbon is available and coming in is optional',
    'We are a remote-first company with an on-site option if you prefer',
    'We hire from Portugal, Spain and Poland',
    'Working from the office is not required',
  ]) {
    assert.deepEqual(detectSignals(sentence, { onsite: true }), [], sentence);
  }
});

test('a language stated as the requirement is raised', () => {
  const found = detectSignals(
    'Strong production experience in Go is required. You will own our services.',
    { languages: ['Go', 'Rust'] },
  );
  assert.deepEqual(names(found), ['Go']);
  assert.match(found[0].quote, /Strong production experience in Go/);
});

test('a language offered as an alternative is not', () => {
  // "X and/or Y" is a choice, not a wall, and this is the case that a title and
  // a tag list get wrong: both would report the language either way.
  for (const sentence of [
    'You will work with Go and/or Node.js on our services',
    'Experience with Go or TypeScript is welcome',
    'Our stack is Go / Node.js',
  ]) {
    assert.deepEqual(detectSignals(sentence, { languages: ['Go'] }), [], sentence);
  }
});

test('an alternative in one sentence does not hide a requirement in another', () => {
  // Postings do both, and stopping at the first mention would read the friendly
  // sentence and miss the binding one.
  const found = detectSignals(
    'Our stack is Go and/or Node.js. Deep production experience in Go is required.',
    { languages: ['Go'] },
  );
  assert.deepEqual(names(found), ['Go']);
  assert.match(found[0].quote, /is required/);
});

test('a language name inside a longer word is not a mention of it', () => {
  // `\b` does not separate Go from Golang, and a repository that reported one as
  // the other would be flagging the wrong postings for the right reason.
  assert.deepEqual(detectSignals('We are going to Golang conferences', { languages: ['Go'] }), []);
  // And a name whose own characters are not word characters still matches.
  assert.equal(detectSignals('Deep experience in C++ is required', { languages: ['C++'] }).length, 1);
});

test('a language named in passing is not a requirement', () => {
  // Measured in the wild before it was fixed: `Go` raised on "candidates will go
  // through a shared interview process". A flag that fires on the verb is one a
  // reader learns to ignore, which costs more than the flag was worth.
  for (const sentence of [
    'Candidates will go through a shared interview process',
    'We will go over the roadmap in your first week',
  ]) {
    assert.deepEqual(detectSignals(sentence, { languages: ['Go'] }), [], sentence);
  }
  // And what the thing is built in still counts, even without the word
  // "experience" anywhere near it.
  assert.equal(detectSignals('Our backend is written in Go', { languages: ['Go'] }).length, 1);
  assert.equal(detectSignals('You will need solid Rust', { languages: ['Rust'] }).length, 1);
});

test('a hyphenated compound is a different word, not the language', () => {
  // Measured on a live run before it was fixed: `Go` raised on "experienced
  // go-to-market operators", on a posting with no Go in it anywhere.
  for (const sentence of [
    'Experienced go-to-market operators who have scaled a product',
    'A hands-on role with a go-live date in March',
  ]) {
    assert.deepEqual(detectSignals(sentence, { languages: ['Go'] }), [], sentence);
  }
});

test('one finding per name, however many times the posting says it', () => {
  const found = detectSignals(
    'This is a hybrid role. Hybrid means two days in the office. Hybrid, again.',
    { onsite: true },
  );
  assert.equal(found.length, 1);
});

test('the note quotes every finding and trims each quote, not the note', () => {
  const long = `Strong production experience in Rust is required for ${'x'.repeat(300)}`;
  const found = detectSignals(`This is a hybrid role. ${long}`, { onsite: true, languages: ['Rust'] });
  const note = signalNote(found, 40);
  assert.match(note, /onsite: "/);
  assert.match(note, /Rust: "/, 'the last finding survives the trim');
  for (const quote of note.match(/"([^"]*)"/g)) assert.ok(quote.length <= 42, quote);
});

test('no text is no findings rather than an error', () => {
  assert.deepEqual(detectSignals('', { onsite: true, languages: ['Go'] }), []);
  assert.deepEqual(detectSignals(null, { onsite: true }), []);
  assert.equal(signalNote([]), null);
});
