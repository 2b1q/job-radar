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

// Office presence. English job-ad grammar rather than anybody's preference, which
// is why these are here and the vocabularies are not.
// `ambiguous` marks a trigger that is only a work arrangement in the right
// company: "a hybrid role" against "a hybrid portfolio", "an on-site position"
// against "on-site power systems". Those need a word from their own subject
// nearby; the longer phrases below already carry one.
const ONSITE = [
  { re: /\bhybrid\b/i, ambiguous: true },
  { re: /\bon[\s-]?site\b/i, ambiguous: true },
  { re: /\bin[\s-]office\b/i },
  { re: /\bhybrid\s+(?:in|at|near|within|from)\b/i },
  { re: /\b(?:\d+|one|two|three|four|five)\s*(?:\+\s*)?(?:days?|times?)\s*(?:a|per|each)?\s*week[^.]{0,20}\b(?:in|at|from)\s+(?:the\s+)?office\b/i },
  { re: /\b(?:days?|time)\s+in\s+(?:the\s+)?office\b/i },
  { re: /\brelocat\w+\s+to\b[^.]{0,40}\bis\s+(?:required|mandatory|expected)\b/i },
];

// The same words with any of these in the sentence are an option being offered,
// not a condition being imposed. Measured against the opposite case: a posting
// naming a city and listing countries it hires from is not asking anybody to
// come in, and had to stop matching.
const ONSITE_OPTIONAL = /\b(?:optional|if you (?:prefer|wish|want)|as an option|available|whenever you|when you like|not required|no requirement|fully remote|remote[\s-]first|work from anywhere)\b/i;

// An office named as a perk is not an office you have to be in. Measured twice
// in the wild on the same shape: "In-office meals", "In-Office Group Meals".
// A benefits list mentions the office more often than a requirement does.
const PERK = /\b(?:meals?|snacks?|lunch(?:es)?|dinners?|breakfast|coffee|drinks|perks?|benefits?|stipends?|allowance|gym|parking|budget|reimburse\w*|catered|catering)\b/i;

// "Go and/or Node.js" names an alternative; "strong production experience in Go"
// names a requirement. Only the second is a wall, and telling them apart is the
// point - a title and a tag list agree with neither.
const ALTERNATIVE = /\b(?:and\/or|or)\b|\//;

// A word matches; a sentence asserts. Two checks stand between the two, and both
// are grammar rather than vocabulary, so both live here and neither is
// configurable. Measured cases in notes/signals.md.

// 1. GOVERNED: the match only counts where a word from its own subject stands
//    near it. `Go` needs a requirement; `hybrid` needs a working arrangement.
const CUES = {
  // "strong production experience in Go", not "candidates will go through".
  language: {
    words: /\b(?:experien\w+|expertise|proficien\w+|fluent|knowledge|background|skilled|skills?|strong|solid|deep|advanced|written|built|building|production|primary|main|core|required?|must have|worked)\b/gi,
    mustPrecede: true,
  },
  // "a hybrid role", not "a hybrid portfolio of UX and visual craft".
  onsite: {
    words: /\b(?:offices?|on-?site|in-?person|remote|work(?:ing|place|s)?|presence|week|days?|commut\w+|attend\w+|schedule|relocat\w+|roles?|position|based|hours?)\b/gi,
    mustPrecede: false,
  },
};

// How far a cue may sit from what it governs. Wide enough for "experience
// building scalable backend services in Go", narrow enough that a word at the
// far end of an unrelated sentence does not reach back.
const CUE_WINDOW = 60;

/** Does a word from this subject stand near enough to govern the match? */
function governed(sentence, at, length, kind) {
  const { words, mustPrecede } = CUES[kind];
  const end = at + length;
  words.lastIndex = 0;
  for (let cue = words.exec(sentence); cue; cue = words.exec(sentence)) {
    const cueEnd = cue.index + cue[0].length;
    if (cueEnd <= at && at - cueEnd <= CUE_WINDOW) return true;
    if (mustPrecede) continue;
    // A phrase long enough to carry its own cue - "two days per week in the
    // office" - governs itself. The cue has to be a PART of it: a trigger word
    // that is also a cue word, `on-site`, would otherwise vouch for itself.
    if (cue.index >= at && cueEnd <= end && (cue.index > at || cueEnd < end)) return true;
    if (cue.index >= end && cue.index - end <= CUE_WINDOW) return true;
  }
  return false;
}

// 2. POLARITY: employers write "no visa sponsorship" as readily as they write
//    "visa sponsorship", and a substring match cannot tell them apart. The
//    finding is kept either way - "there is none" is worth the same as "there
//    is" - and carries which one it is.
const NEGATION = /\b(?:no|not|never|without|excluding|nor|cannot|can'?t|won'?t|unable|lacks?|lacking)\b/i;
const NEGATION_WINDOW = 45;

export const AFFIRMED = 'affirmed';
export const NEGATED = 'negated';

/** What the sentence does with the match: asserts it, or denies it. */
function polarity(sentence, at) {
  return NEGATION.test(sentence.slice(Math.max(0, at - NEGATION_WINDOW), at)) ? NEGATED : AFFIRMED;
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
const languageAt = (name) => new RegExp(`(?:^|[^${NOT_A_BOUNDARY}])(${literal(name)})(?:$|[^${NOT_A_BOUNDARY}])`, 'giu');

/** The first sentence where `re` matches under a rule, with its polarity. */
function findIn(lines, re, accept) {
  for (const line of lines) {
    const m = re.exec(line);
    re.lastIndex = 0;
    if (!m || !accept(line, m.index, m[0].length)) continue;
    return { quote: line, polarity: polarity(line, m.index) };
  }
  return null;
}

const always = () => true;

/**
 * Findings in one posting's text.
 *
 * `config` is the caller's vocabulary, and an absent key means that signal is
 * not asked for rather than that it is empty:
 *
 *     phrases   { <name>: [phrase, ...] }  a phrase anywhere in the text
 *     onsite    true                       office presence
 *     languages [name, ...]                a language named as the requirement
 *
 * Returns `[{ signal, name, quote, polarity }]` - at most one finding per name,
 * and `polarity` says whether the sentence asserts it or denies it. A denial is
 * a finding, not a silence: "we do not sponsor visas" is worth as much as the
 * opposite and means something else.
 */
export function detectSignals(text, config = {}) {
  const lines = sentences(text);
  if (!lines.length) return [];
  const found = [];
  const add = (signal, name, hit) => {
    if (hit && !found.some((f) => f.signal === signal && f.name === name)) {
      found.push({ signal, name, quote: hit.quote, polarity: hit.polarity });
    }
  };

  for (const [name, phrases] of Object.entries(config.phrases || {})) {
    for (const phrase of phrases) {
      const hit = findIn(lines, new RegExp(literal(phrase), 'gi'), always);
      if (hit) { add(SIGNALS.phrase, name, hit); break; }
    }
  }

  if (config.onsite) {
    for (const { re, ambiguous } of ONSITE) {
      const hit = findIn(lines, new RegExp(re.source, 'gi'), (line, at, len) => (
        !ONSITE_OPTIONAL.test(line) && !PERK.test(line)
        && (!ambiguous || governed(line, at, len, 'onsite'))
      ));
      if (hit) { add(SIGNALS.onsite, 'onsite', hit); break; }
    }
  }

  for (const language of config.languages || []) {
    // An alternative is not a wall, and neither is a name in passing. Both are
    // passed over rather than ending the search: the same posting often names
    // the language again in the sentence where it means it.
    add(SIGNALS.language, language, findIn(lines, languageAt(language),
      (line, at, len) => !ALTERNATIVE.test(line) && governed(line, at, len, 'language')));
  }
  return found;
}

/**
 * The findings as one line for the store's `note`, quotes included.
 *
 * A denial is labelled rather than dropped, because the unlabelled version of
 * this note once read "relocation offered" off a posting that ruled it out.
 * Trimmed per quote rather than in total: a note whose last finding is cut off
 * is the one somebody would have wanted to read.
 */
export function signalNote(found, quoteLimit = 160) {
  return found
    .map((f) => {
      const quote = f.quote.length > quoteLimit ? `${f.quote.slice(0, quoteLimit - 1)}…` : f.quote;
      return `${f.name}${f.polarity === NEGATED ? ' (negated)' : ''}: "${quote}"`;
    })
    .join(' | ') || null;
}
