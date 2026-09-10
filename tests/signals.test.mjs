// Signals read out of a posting's text. Every case is a pair: the sentence that
// should raise the signal and the one that should not.
//
// The vocabulary is always passed in - no stop list is a default here.
// Text is synthetic, except the E-Verify notice, which is published verbatim.

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

test('a work-arrangement word is not one unless it describes the work', () => {
  // Live false positive: `hybrid` raised on a designer's portfolio. The same
  // rule the language signal uses - a word from its own subject has to govern
  // the match - now applies here too.
  for (const sentence of [
    'Requires a hybrid portfolio of UX and visual craft, and deep intuition for gaming culture',
    'We run a hybrid cloud on AWS and bare metal',
    'You will design on-site power systems for data centres',
  ]) {
    assert.deepEqual(detectSignals(sentence, { onsite: true }), [], sentence);
  }
});

test('an office named as a perk is not an office you must be in', () => {
  // Two live false positives of the same shape: a benefits list mentions the
  // office more often than a requirement does.
  for (const sentence of [
    'In-office meals and snacks are provided every day',
    'In-Office Group Meals, gym reimbursement and a learning budget',
    'Perks include an on-site barista and catered lunches',
  ]) {
    assert.deepEqual(detectSignals(sentence, { onsite: true }), [], sentence);
  }
  // And the requirement in the next sentence still lands.
  const found = detectSignals(
    'In-office meals are provided. This is a hybrid role, three days a week in the office',
    { onsite: true },
  );
  assert.equal(found.length, 1);
  assert.match(found[0].quote, /hybrid role/);
});

test('an arrangement stated without a noun still counts', () => {
  // Where the rule above stops: this names no role and no office and is still an
  // arrangement. A phrase carrying its own subject needs no neighbour to vouch
  // for it. Sentences are invented; the shapes are ones live postings use.
  for (const sentence of [
    'Hybrid in Riverton, MA',
    'Hybrid in Riverton, Fairview, Brookfield, or Oakvale',
    'Two days per week in the office is expected',
  ]) {
    assert.equal(detectSignals(sentence, { onsite: true }).length, 1, sentence);
  }
});

test('a phrase under a negation is kept, and says it is negated', () => {
  // Live false positive, and the worse of the two: the flag said relocation was
  // offered on a posting that ruled it out. "There is none" is a finding.
  const config = { phrases: { relocationOffered: ['visa sponsorship'] } };
  const [denied] = detectSignals('The role is fully remote within one country, with no visa sponsorship', config);
  assert.equal(denied.name, 'relocationOffered');
  assert.equal(denied.polarity, 'negated');
  assert.match(signalNote([denied]), /relocationOffered \(negated\)/);

  const [offered] = detectSignals('We offer visa sponsorship for the right candidate', config);
  assert.equal(offered.polarity, 'affirmed');
  assert.doesNotMatch(signalNote([offered]), /negated/);
});

test('negation is read for every signal, not only for phrases', () => {
  // One rule, or the next signal added gets the defect back.
  const [onsite] = detectSignals('This role is not a hybrid role, we are remote-only', { onsite: true });
  assert.equal(onsite.polarity, 'negated');
  const [lang] = detectSignals('No production experience in Go is required for this role', { languages: ['Go'] });
  assert.equal(lang.polarity, 'negated');
});

test('a negation belonging to another clause does not reach the match', () => {
  const config = { phrases: { relocationOffered: ['visa sponsorship'] } };
  const [found] = detectSignals(
    'There is no dress code and no fixed hours whatsoever here, and we are glad to offer full visa sponsorship',
    config,
  );
  assert.equal(found.polarity, 'affirmed');
});

test('and not where the office is an offer', () => {
  // Each names an office; none asks anybody to come in.
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
  // "X and/or Y" is a choice, not a wall - the case a tag list gets wrong.
  for (const sentence of [
    'You will work with Go and/or Node.js on our services',
    'Experience with Go or TypeScript is welcome',
    'Our stack is Go / Node.js',
  ]) {
    assert.deepEqual(detectSignals(sentence, { languages: ['Go'] }), [], sentence);
  }
});

test('an alternative in one sentence does not hide a requirement in another', () => {
  // Stopping at the first mention would read the friendly sentence, not the binding one.
  const found = detectSignals(
    'Our stack is Go and/or Node.js. Deep production experience in Go is required.',
    { languages: ['Go'] },
  );
  assert.deepEqual(names(found), ['Go']);
  assert.match(found[0].quote, /is required/);
});

test('a language name inside a longer word is not a mention of it', () => {
  // `\b` does not separate Go from Golang.
  assert.deepEqual(detectSignals('We are going to Golang conferences', { languages: ['Go'] }), []);
  // A name whose own characters are not word characters still matches.
  assert.equal(detectSignals('Deep experience in C++ is required', { languages: ['C++'] }).length, 1);
});

test('a language named in passing is not a requirement', () => {
  // Measured in the wild: `Go` raised on "candidates will go through...".
  // A flag that fires on the verb is one a reader learns to ignore.
  for (const sentence of [
    'Candidates will go through a shared interview process',
    'We will go over the roadmap in your first week',
  ]) {
    assert.deepEqual(detectSignals(sentence, { languages: ['Go'] }), [], sentence);
  }
  // What the thing is built in still counts.
  assert.equal(detectSignals('Our backend is written in Go', { languages: ['Go'] }).length, 1);
  assert.equal(detectSignals('You will need solid Rust', { languages: ['Rust'] }).length, 1);
});

test('a hyphenated compound is a different word, not the language', () => {
  // Measured live: `Go` raised on "experienced go-to-market operators".
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
