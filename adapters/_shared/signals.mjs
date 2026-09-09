// _shared/signals.mjs - the three things a human currently reads a posting to
// find out, pulled out of its text at collection time.
//
// SRP: text in, findings out. No network, no configuration loading, no policy.
// Nothing is ever dropped on a finding: each one carries the sentence it was
// found in, and what to do about it stays with the person reading.
//
// WHAT IS CONFIGURED AND WHAT IS NOT. The vocabulary is the caller's: which
// phrases matter, which languages disqualify a posting, whether office presence
// is worth flagging at all. A list of stop words baked in here would be one
// person's search compiled into a general tool - the failure this repository
// keeps finding. What is NOT configured is the grammar around those words, and
// that is the whole reason this module exists: "office as an option" and "three
// days a week in the office" are the same noun and opposite facts, and so are
// "Go and/or Node.js" and "strong production experience in Go".
//
// The text these run on comes from whoever wrote the posting, so a finding is
// evidence to read, never a decision to act on.

import { strip } from './text.mjs';

/** Every signal this module can raise. */
const SIGNALS = { phrase: 'phrase', onsite: 'onsite', language: 'language' };

// A sentence is the unit of quotation. Anything shorter loses the qualifier that
// decides the meaning, and anything longer quotes a paragraph at somebody who
// asked for a reason.
const SENTENCE = /[^.!?\n•;]+/g;

/** The posting's text as sentences, tags and entities already gone. */
function sentences(text) {
  return (strip(text).match(SENTENCE) || [])
    .map((s) => s.trim())
    .filter((s) => s.length > 2);
}

// Office presence, and the qualifiers that turn it into an offer rather than a
// requirement. English job-ad grammar rather than anybody's preference, which is
// why these are here and the vocabularies are not.
const ONSITE = [
  /\bhybrid\b/i,
  /\b(?:\d+|one|two|three|four|five)\s*(?:\+\s*)?(?:days?|times?)\s*(?:a|per|each)?\s*week[^.]{0,20}\b(?:in|at|from)\s+(?:the\s+)?office\b/i,
  /\b(?:days?|time)\s+in\s+(?:the\s+)?office\b/i,
  /\bon[\s-]?site\b/i,
  /\bin[\s-]office\b/i,
  /\brelocat\w+\s+to\b[^.]{0,40}\bis\s+(?:required|mandatory|expected)\b/i,
];

// The same words with any of these in the sentence are an option being offered,
// not a condition being imposed. Measured against the opposite case: a posting
// naming a city and listing countries it hires from is not asking anybody to
// come in, and had to stop matching.
const ONSITE_OPTIONAL = /\b(?:optional|if you (?:prefer|wish|want)|as an option|available|whenever you|when you like|not required|no requirement|fully remote|remote[\s-]first|work from anywhere)\b/i;

// "Go and/or Node.js" names an alternative; "strong production experience in Go"
// names a requirement. Only the second is a wall, and telling them apart is the
// point - a title and a tag list agree with neither.
const ALTERNATIVE = /\b(?:and\/or|or)\b|\//;

// And the name has to be where a requirement puts it. Measured in the wild: a
// posting saying "candidates will go through a shared interview process
// designed to assess the core skills" raised `Go` twice over - once on the verb,
// and again when the sentence was merely required to contain a requirement word,
// which "skills" at the far end of it satisfied.
//
// So the cue has to come BEFORE the name and CLOSE to it. That is the shape of
// the construction being looked for - "strong production experience in Go",
// "our backend is written in Go" - rather than a bag of words that any long
// sentence eventually contains.
const REQUIREMENT_CUE = /\b(?:experien\w+|expertise|proficien\w+|fluent|knowledge|background|skilled|skills?|strong|solid|deep|advanced|written|built|building|production|primary|main|core|required?|must have|worked)\b/gi;

// How far a cue may sit from the name it governs. Wide enough for "experience
// building scalable backend services in Go", narrow enough that a cue at the far
// end of an unrelated sentence does not reach back.
const CUE_WINDOW = 60;

/** Is this name, at this position, the object of a requirement? */
function isRequired(sentence, at) {
  REQUIREMENT_CUE.lastIndex = 0;
  for (let cue = REQUIREMENT_CUE.exec(sentence); cue; cue = REQUIREMENT_CUE.exec(sentence)) {
    const gap = at - (cue.index + cue[0].length);
    if (gap >= 0 && gap <= CUE_WINDOW) return true;
  }
  return false;
}

/** A regex-safe literal, so a configured phrase like "C++" is matched as text. */
const literal = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// What may NOT touch a language name for it to count as a mention of it:
// another letter or digit, the characters that are part of a language's own name
// (`C++`, `C#`, `F#`), and a hyphen. The hyphen is the one measured in the wild:
// a live run raised `Go` on "experienced go-to-market operators", which is the
// kind of finding that teaches a reader to ignore the flag.
//
// It costs "Go-based services", which is the cheaper mistake by a distance: a
// posting that requires the language says so plainly somewhere, every sentence
// is looked at, and a missed flag still leaves a human reading the posting.
const NOT_A_BOUNDARY = '\\p{L}\\p{N}+#\\-';

/**
 * A configured language named as a whole word. `\b` is wrong here - it does not
 * separate "Go" from "Golang" any better than it separates "C" from "C++",
 * which has no word character to end on at all.
 */
const languageAt = (name) => new RegExp(`(?:^|[^${NOT_A_BOUNDARY}])${literal(name)}(?:$|[^${NOT_A_BOUNDARY}])`, 'iu');

/**
 * Findings in one posting's text.
 *
 * `config` is the caller's vocabulary, and an absent key means that signal is
 * not asked for rather than that it is empty:
 *
 *     phrases   { <name>: [phrase, ...] }  a phrase anywhere in the text
 *     onsite    true                       office presence, qualifiers honoured
 *     languages [name, ...]                a language named as the requirement
 *
 * Returns `[{ signal, name, quote }]` - at most one finding per name, because a
 * second sentence saying the same thing adds a quote and no information.
 */
export function detectSignals(text, config = {}) {
  const lines = sentences(text);
  if (!lines.length) return [];
  const found = [];
  const add = (signal, name, quote) => {
    if (!found.some((f) => f.signal === signal && f.name === name)) found.push({ signal, name, quote });
  };

  for (const [name, phrases] of Object.entries(config.phrases || {})) {
    for (const phrase of phrases) {
      const re = new RegExp(literal(phrase), 'i');
      const hit = lines.find((s) => re.test(s));
      if (hit) { add(SIGNALS.phrase, name, hit); break; }
    }
  }

  if (config.onsite) {
    const hit = lines.find((s) => !ONSITE_OPTIONAL.test(s) && ONSITE.some((re) => re.test(s)));
    if (hit) add(SIGNALS.onsite, 'onsite', hit);
  }

  for (const language of config.languages || []) {
    const re = languageAt(language);
    // An alternative is not a wall, and neither is a name in passing. Both are
    // passed over rather than ending the search, because the same posting often
    // names the language again in the sentence where it means it.
    const hit = lines.find((s) => {
      const at = s.search(re);
      return at !== -1 && !ALTERNATIVE.test(s) && isRequired(s, at);
    });
    if (hit) add(SIGNALS.language, language, hit);
  }
  return found;
}

/**
 * The findings as one line for the store's `note`, quotes included.
 *
 * Trimmed per quote rather than in total: a note whose last finding is cut off
 * is the one somebody would have wanted to read.
 */
export function signalNote(found, quoteLimit = 160) {
  return found
    .map((f) => `${f.name}: "${f.quote.length > quoteLimit ? `${f.quote.slice(0, quoteLimit - 1)}…` : f.quote}"`)
    .join(' | ') || null;
}
