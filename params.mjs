// params.mjs - a request becomes board parameters (SRP: pure mapping, no I/O).
//
// Separated from server.mjs so it can be imported by a test: server.mjs starts
// the stdio transport at module load and never returns, so anything reachable
// only through it is unreachable to a test. The same split as the adapters -
// what is pure gets its own file, and that is usually where the interesting
// mistakes live anyway.

import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Two board vocabularies that belong to their adapters and are checked here,
// because a wrong value in the profile is cheaper to refuse at load than to
// discover halfway through a run that has already spent requests.
import { PROVIDER_NAMES } from './adapters/ats.mjs';
import { QUALIFICATIONS as HC_QUALIFICATIONS } from './adapters/habrcareer.mjs';
// The boards this server speaks to, so that a source code is written once.
import { SOURCE_CODES } from './adapters/index.mjs';

// What to look for is configuration, not code. Roles, grades, the countries you
// would move to and the tag vocabularies you care about live in profiles.json,
// which is gitignored; profiles.example.json ships as the template. Hard-coding
// one person's stack into the adapters is how a general tool quietly becomes
// somebody's private script.
const HERE = dirname(fileURLToPath(import.meta.url));

// There is no fallback to the shipped example, on purpose. Falling back would
// run somebody else's search under your name and answer plausibly - the failure
// this repo keeps finding elsewhere. Missing configuration is an error with an
// instruction in it.
function loadProfile() {
  const file = process.env.JOBS_PROFILES || 'profiles.json';
  let data;
  try {
    data = JSON.parse(readFileSync(join(HERE, file), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`no search profile: ${file} is missing. Copy the template `
        + 'and edit it - `cp profiles.example.json profiles.json` - or point '
        + 'JOBS_PROFILES at another file. It holds the roles, grades, countries '
        + 'and tag vocabularies to search for, and there is no sensible default '
        + 'for those');
    }
    throw new Error(`${file} is not readable as JSON: ${err.message}`);
  }
  const key = process.env.JOBS_PROFILE || data.active || 'default';
  const profile = data.profiles?.[key];
  if (!profile) {
    const known = Object.keys(data.profiles || {}).join(', ') || 'none';
    throw new Error(`${file} has no profile "${key}". Defined: ${known}. Set `
      + 'JOBS_PROFILE to one of them, or change `active` in the file');
  }
  return { name: key, source: file, ...profile };
}

/** Where the profile is read from, so a reload can stat it. */
const profilePath = () => join(HERE, process.env.JOBS_PROFILES || 'profiles.json');

// Everything below is derived from the profile, so a reload has to rebuild all
// of it at once. `let` rather than `const` because these are exported and read
// live: a client keeps one server process for days, and the profile is edited
// far more often than the server is restarted.
export let PROFILE;
export let CATEGORIES;
export let TAG_GROUPS;
let ROLES, GRADES, RELOCATION_COUNTRIES, SKILLS, AF_PRESETS;

const loadState = { mtimeMs: null, key: null, at: null, error: null };

function adopt(profile, mtimeMs) {
  PROFILE = profile;
  ROLES = profile.roles || [];
  GRADES = profile.grades || [];
  RELOCATION_COUNTRIES = profile.relocationCountries || [];
  SKILLS = skillsBySource(profile.skills, profile.source);
  CATEGORIES = profile.categories || {};
  TAG_GROUPS = profile.tagGroups || {};
  AF_PRESETS = {
    remote: { countries_workplaces: [{ workplaces: ['remote'] }] },
    ruroots: { countries_workplaces: [{ workplaces: ['remote'] }], isRussianRootsOnly: true },
    countries: { countries_workplaces: [{ countries: RELOCATION_COUNTRIES }] },
    anywhere: { isRemoteAnywhereOnly: true },
  };
  loadState.mtimeMs = mtimeMs;
  loadState.key = process.env.JOBS_PROFILE || '';
  loadState.at = new Date().toISOString();
}

/**
 * Re-read the profile when the file or the chosen profile has changed.
 *
 * A broken edit keeps the profile that was working and carries the message out
 * with the answer: the alternative is a server that dies on a stray comma, in a
 * client that will not restart it.
 */
function refresh() {
  let mtimeMs;
  try {
    mtimeMs = statSync(profilePath()).mtimeMs;
  } catch {
    return;   // gone or unreadable: keep what is already loaded
  }
  if (mtimeMs === loadState.mtimeMs && (process.env.JOBS_PROFILE || '') === loadState.key) return;
  try {
    adopt(loadProfile(), mtimeMs);
    loadState.error = null;
  } catch (err) {
    loadState.mtimeMs = mtimeMs;   // do not retry the same broken file every call
    loadState.error = err.message;
  }
}

/** What is loaded, from where, and what the last reload made of it. */
export function profileStatus() {
  refresh();
  return {
    path: profilePath(),
    profile: PROFILE?.name ?? null,
    mtime: loadState.mtimeMs ? new Date(loadState.mtimeMs).toISOString() : null,
    loadedAt: loadState.at,
    ...(loadState.error ? { error: loadState.error } : {}),
  };
}


/** One list of slugs, checked entry by entry. */
function skillList(value, where, file) {
  if (!Array.isArray(value)) {
    throw new Error(`${file}: skills${where} must be a list of board slugs, not `
      + `${typeof value}. Slugs are per board - see profiles.example.json`);
  }
  return value.map((slug) => {
    if (typeof slug !== 'string' || !slug.trim()) {
      throw new Error(`${file}: skills${where} holds ${JSON.stringify(slug)}, which `
        + 'is not a slug. An empty value is not "no filter": boards answer an '
        + 'empty parameter with zero results');
    }
    return slug.trim();
  });
}

/**
 * Skills are board vocabulary, and board vocabularies are not portable. The same
 * technology is spelled differently on each: `node-js` is a slug somewhere and
 * `/node-js-jobs` is a 404 on web3.career, while an unknown member of a comma
 * list is dropped by TalentMove without a word. One shared list therefore
 * pretended the data travelled when it does not - a general shape over
 * board-specific data, which is the failure this repository keeps finding.
 *
 * So `skills` is per source, with `default` for the boards that have no list of
 * their own:
 *
 *     "skills": ["postgresql"]                        // every board
 *     "skills": { "default": ["node-js"], "w3": ["node"] }
 *
 * A board with its own list does NOT also get the default: that separation is
 * what lets a slug written for one board and sent to another be refused here
 * instead of 404ing halfway through a run.
 */
function skillsBySource(skills, file) {
  if (skills === undefined || skills === null) return { default: [] };
  if (Array.isArray(skills)) return { default: skillList(skills, '', file) };
  if (typeof skills !== 'object') return { default: skillList(skills, '', file) };

  const out = {};
  for (const [key, value] of Object.entries(skills)) {
    // Checked at load, because a misspelled source key is silence twice over:
    // the key is ignored, the board quietly gets the default vocabulary, and the
    // first sign of it is a 404 in the middle of a run.
    if (key !== 'default' && !SOURCE_CODES.includes(key)) {
      throw new Error(`${file}: skills."${key}" is not a board. Skills are named `
        + `per source - ${SOURCE_CODES.join(', ')} - plus "default" for the rest. `
        + 'A key nobody reads would leave that board on the default vocabulary '
        + 'and fail as a wrong slug much later');
    }
    const list = skillList(value, `.${key}`, file);
    if (!list.length) {
      throw new Error(`${file}: skills.${key} is empty. Remove the key to fall `
        + 'back to the default list, or name the slugs this board uses - an '
        + 'empty list here reads as "this board has no vocabulary"');
    }
    out[key] = list;
  }
  return out;
}

/** The slugs this profile uses on one board, falling back to the shared list. */
export function skillsFor(source) {
  refresh();
  return SKILLS[source] ?? SKILLS.default ?? [];
}

/**
 * Refuse a slug this profile wrote for a different board.
 *
 * What is valid on a board is the board's business and cannot be listed here - a
 * local whitelist would go stale the day a tag is added. What CAN be known
 * locally is that the caller is using another board's word: that is a
 * configuration mistake with an address, and it is the one that produced
 * `/node-js-jobs -> /404` in the middle of a run.
 */
function assertBoardSkills(source, slugs) {
  const mine = new Set(skillsFor(source));
  const elsewhere = new Set(Object.entries(SKILLS)
    .filter(([key]) => key !== source)
    .flatMap(([, list]) => list));
  for (const slug of slugs) {
    if (mine.has(slug) || !elsewhere.has(slug)) continue;
    const known = skillsFor(source);
    throw new Error(`${source}: "${slug}" is this profile's slug for another `
      + `board, not for ${source}. Board vocabularies are not portable, and the `
      + 'wrong one does not come back as an error from the board - it comes back '
      + `as a 404 page or as an empty answer. ${source} uses `
      + `[${known.join(', ')}] in profile "${PROFILE.name}"; add the slug to `
      + `skills.${source} in ${PROFILE.source} if the board really has it`);
  }
}

// TalentMove has its own vocabulary - taxonomy ids and slugs, not presets -
// and mapping it here keeps the tool surface identical across boards. The
// vocabulary itself, and what the board does with a wrong value, is measured in
// notes/talentmove.md.
//
// Two presets are stubs, and that is a finding rather than a gap: the board's
// `location` taxonomy is free text per posting, not a country dimension, and
// nothing in it expresses hiring through an EOR. Approximating either would
// return almost nothing and miss the rest in silence, so the country cut happens
// downstream, on each card's own location field.
const TM_PRESETS = {
  remote: { format: 'fully-remote' },
  anywhere: {},                      // every format, not a synonym for remote
  countries: { format: 'fully-remote' },   // stub: see above
  ruroots: { format: 'fully-remote' },     // stub: see above
};

// A multi-word `searchQuery` was refused here as an ordered phrase. Measured on
// clean filters that was wrong - the zeros were the preset's intersection - so
// the refusal is gone. notes/agilefluent.md.
function afFilters({ preset = 'remote', since = 'week', query, minSalary }) {
  refresh();
  const filters = { roles: ROLES, grades: GRADES, since, ...AF_PRESETS[preset] };
  // `" "` is not a query; the board's schema caps the field at 255.
  const term = query === undefined || query === null ? '' : String(query).trim();
  if (term) filters.searchQuery = term.slice(0, 255);
  if (minSalary) filters.salary_min = Number(minSalary);
  return filters;
}

// `skills` takes slugs from the board's own vocabulary endpoint, comma
// separated. The comma is a UNION: listing a whole stack widens the search
// rather than narrowing it, so an intersection is a second query, not a longer
// list. An unknown slug answers zero - loud - while an unknown parameter NAME is
// accepted and dropped - silent.
//
// `date` is the exception that has to be guarded here: an unrecognised value is
// dropped in silence and the answer comes back as the unfiltered total, which is
// the worst shape a wrong answer can take. The list is closed; there is no
// `14days`. Numbers in notes/talentmove.md.
const TM_DATES = new Set(['today', '7days', '30days']);

function tmParams({ preset = 'remote', category, skills, date }) {
  refresh();
  const params = { ...TM_PRESETS[preset] };
  // Shape-checked, not whitelisted. Measured tolerances differ per value:
  //   999999  -> found 0, an honest "no such category"
  //   0, crypto (a slug) -> HTTP 400, treated as no category at all
  //   7abc    -> found 7400, i.e. coerced to 7 and the rest dropped in silence
  // The last is the dangerous one: not an empty answer but a full one from a
  // DIFFERENT filter. So a malformed id is refused here, while an id that is
  // merely unknown is left to the board - a zero answers for itself, and a
  // whitelist of 58 ids would go stale the day a category is added.
  if (category !== undefined && category !== null && category !== '') {
    // A name from the profile, or a raw id. Names keep a query readable and keep
    // board taxonomy ids out of it, which matters because they are per board.
    const id = String(CATEGORIES[String(category).trim()] ?? category).trim();
    if (!/^[1-9]\d*$/.test(id)) {
      throw new Error(`tm: category must be a job_category term id - "${id}" is `
        + 'not one, and the board would silently read a prefix of it as a '
        + 'different category');
    }
    params.category = id;
  }
  // Set only when something survives the trim. A truthy input can normalise to
  // nothing - ' , ' does - and an empty `skills=` is an unknown value, which this
  // board answers with zero results rather than by ignoring it. Sending no
  // parameter and sending an empty one are opposite requests.
  const list = (Array.isArray(skills) ? skills : String(skills ?? '').split(','))
    .map((s) => s.trim()).filter(Boolean);
  assertBoardSkills('tm', list);
  if (list.length) params.skills = list.join(',');
  if (date) {
    if (!TM_DATES.has(date)) {
      throw new Error(`tm: date must be one of ${[...TM_DATES].join(', ')} - `
        + `"${date}" would be ignored by the board and return everything`);
    }
    params.date = date;
  }
  return params;
}

/**
 * web3.career is addressed by tag page rather than by preset, so `skills` names
 * the listing slug and only the first one can be asked for at a time. Resolved
 * in one place because both tools need it, and validated here because a slug
 * from another board's vocabulary is a redirect to /404 rather than an error.
 */
export function w3Tag(skills) {
  refresh();
  const tag = (Array.isArray(skills) ? skills[0] : String(skills ?? '').split(',')[0] || null);
  const slug = tag ? String(tag).trim() : null;
  if (!slug) return null;   // no tag is the whole board, which is a real query
  assertBoardSkills('w3', [slug]);
  return slug;
}

// jobs.solana.com narrows by work mode and by free text, and by nothing else
// this repository can use. Two presets are stubs and that is a measurement, not
// a gap: `locations` is accepted and dropped by the API - the answer comes back
// as the unfiltered total - and nothing in it expresses hiring through an EOR.
// The country cut therefore happens downstream, on each record's own location,
// which is also the field this board is least to be believed about.
const SOL_PRESETS = {
  remote: { workMode: 'remote' },
  anywhere: {},                 // both work modes, which is the board's default
  countries: {},                // stub: no location filter exists here
  ruroots: {},                  // stub: the board has no such dimension
};

/**
 * jobs.solana.com is addressed by free text, and the text narrows with every
 * word added - "rust" 76, "typescript" 69, "rust solana" 62 - so it takes ONE
 * term. An explicit `query` wins over the profile's vocabulary; whatever is left
 * over is reported rather than quietly dropped, because a query narrowed to the
 * first word of a list is a different question from the one that was asked.
 */
export function solParams({ preset = 'remote', query, skills }) {
  refresh();
  const list = (Array.isArray(skills) ? skills : String(skills ?? '').split(','))
    .map((s) => s.trim()).filter(Boolean);
  assertBoardSkills('sol', list);
  const term = query ? String(query).trim() : (list[0] || '');
  return {
    ...SOL_PRESETS[preset],
    query: term,
    // Everything the board was not asked about, so the caller can see it.
    ignored: query ? list : list.slice(1),
  };
}

/**
 * Resolve a tag requirement: a group name from the profile expands to its set,
 * anything else is passed through as a literal tag.
 */
export function resolveTags(wanted) {
  refresh();
  const list = Array.isArray(wanted) ? wanted : String(wanted ?? '').split(',');
  return list.flatMap((w) => {
    const key = String(w).trim();
    if (!key) return [];
    return TAG_GROUPS[key] ?? [key];
  });
}

// career.habr.com narrows by free text, by qualification and by work mode, and
// by nothing else this repository can use. Two presets are stubs and that is a
// measurement rather than a gap: the board's place dimension is its own city
// taxonomy, not a country list, and it has no notion of where a company has its
// roots. The country cut therefore happens downstream, on each record's own
// location.
const HC_PRESETS = {
  remote: { remote: true },
  anywhere: {},                 // both, which is the board's default
  countries: {},                // stub: a city taxonomy is not a country filter
  ruroots: {},                  // stub: the board has no such dimension
};

/**
 * The board's qualification ids, resolved from the profile's own grade words.
 *
 * A closed list, checked here, because this board answers a value it does not
 * have with a silent zero - `qid=2` returns 0 exactly like `qid=999`, and the
 * gap at 2 is the board's own. That is the shape of wrong answer this repository
 * keeps finding, and it costs a request to discover remotely and nothing to
 * refuse locally.
 */
function hcQualifications(grades) {
  return grades.map((grade) => {
    const id = HC_QUALIFICATIONS[String(grade).trim().toLowerCase()];
    if (id) return id;
    throw new Error(`hc: "${grade}" is not a grade this board has. It knows `
      + `${Object.keys(HC_QUALIFICATIONS).join(', ')}, and answers anything else `
      + 'with zero results rather than with an error');
  });
}

/**
 * career.habr.com takes free text, a qualification set and a work mode.
 *
 * `skills` here are the board's numeric term ids, not the slugs that appear in a
 * skill's own href: `skills[]=nodejs` answers zero as readily as an id the board
 * does not have. Shape-checked rather than whitelisted, for the same reason the
 * other board's category ids are - a local list of term ids would go stale the
 * day a skill is added, while a value that is not an id at all is a mistake with
 * an address.
 */
export function hcParams({ preset = 'remote', query, skills, grades = GRADES }) {
  refresh();
  const list = (Array.isArray(skills) ? skills : String(skills ?? '').split(','))
    .map((s) => s.trim()).filter(Boolean);
  assertBoardSkills('hc', list);
  for (const id of list) {
    if (!/^[1-9]\d*$/.test(id)) {
      throw new Error(`hc: skills are this board's numeric term ids - "${id}" is `
        + 'not one, and the board answers an unknown skill value with zero '
        + 'results rather than by ignoring it');
    }
  }
  return {
    ...HC_PRESETS[preset],
    query: query ? String(query).trim() : '',
    qids: hcQualifications(grades),
    skills: list,
  };
}

/**
 * The employers to watch, from the profile.
 *
 * A watchlist is somebody's shortlist of companies, so it lives in the gitignored
 * profile like every other thing this repository refuses to hard-code. Validated
 * at load, because a misspelled provider is silence twice over: the entry would
 * reach the adapter and fail in the middle of a run, after the other companies
 * had already been read and paid for.
 */
export function watchlist() {
  refresh();
  const entries = PROFILE.watchlist ?? [];
  if (!Array.isArray(entries)) {
    throw new Error(`${PROFILE.source}: watchlist must be a list of `
      + `{ provider, slug } entries - see profiles.example.json`);
  }
  return entries.map((entry, i) => {
    const provider = String(entry?.provider ?? '').trim();
    const slug = String(entry?.slug ?? '').trim();
    if (!PROVIDER_NAMES.includes(provider)) {
      throw new Error(`${PROFILE.source}: watchlist[${i}].provider is `
        + `"${provider}", which is not one of ${PROVIDER_NAMES.join(', ')}`);
    }
    // The slug is a hostname component on one provider and a path component on
    // the others, so anything outside this set is not a company's instance name.
    if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(slug)) {
      throw new Error(`${PROFILE.source}: watchlist[${i}].slug is "${slug}", `
        + "which is not an instance name - it is the company's own subdomain or "
        + 'board path, letters, digits and hyphens');
    }
    return { provider, slug, ...(entry.name ? { name: String(entry.name).trim() } : {}) };
  });
}

/**
 * What to look for in a posting's text, from the profile.
 *
 * Which phrases and which languages disqualify a posting is one person's search;
 * the grammar that tells "office as an option" from "three days in the office"
 * is not. Only the first half is configured, and an absent key means the signal
 * was not asked for rather than that its list is empty.
 */
export function signalConfig() {
  refresh();
  const raw = PROFILE.signals;
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${PROFILE.source}: signals must be an object with any of `
      + 'phrases, onsite and languages - see profiles.example.json');
  }
  const config = {};
  if (raw.phrases !== undefined) {
    if (typeof raw.phrases !== 'object' || Array.isArray(raw.phrases)) {
      throw new Error(`${PROFILE.source}: signals.phrases maps a name you choose `
        + 'to the phrases that raise it, e.g. { "workAuthorization": ["E-Verify"] }');
    }
    config.phrases = {};
    for (const [name, phrases] of Object.entries(raw.phrases)) {
      if (!Array.isArray(phrases) || !phrases.length || phrases.some((p) => typeof p !== 'string' || !p.trim())) {
        throw new Error(`${PROFILE.source}: signals.phrases.${name} must be a `
          + 'non-empty list of phrases to look for');
      }
      config.phrases[name] = phrases.map((p) => p.trim());
    }
  }
  if (raw.onsite !== undefined) config.onsite = !!raw.onsite;
  if (raw.languages !== undefined) {
    if (!Array.isArray(raw.languages) || raw.languages.some((l) => typeof l !== 'string' || !l.trim())) {
      throw new Error(`${PROFILE.source}: signals.languages must be a list of `
        + 'language names, e.g. ["Go", "Rust"]');
    }
    config.languages = raw.languages.map((l) => l.trim());
  }
  return config;
}

// Last, because everything it derives is defined above it.
adopt(loadProfile(), (() => { try { return statSync(profilePath()).mtimeMs; } catch { return null; } })());

export { TM_PRESETS, TM_DATES, afFilters, tmParams };

// How far back each `since` reaches, in days. The boards that have a date filter
// apply it themselves; this is for the one source that carries dates and has no
// filter, so the cut happens here or not at all.
const SINCE_DAYS = { '24h': 1, '3d': 3, week: 7, '2w': 14, month: 31 };

/**
 * Titles to drop, and optionally the only ones to keep.
 *
 * A board that cannot filter by role - because filtering by role throws away
 * most of it - returns everything, and most of everything is somebody else's
 * job. The list is a profile's own regexes rather than a judgement in code: a
 * person reads it and edits it in a minute, and it is theirs to disagree with.
 *
 * Compiled at load so a bad pattern is a configuration error with an address,
 * not a run that quietly matches nothing.
 */
function patterns(value, key) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error(`${PROFILE.source}: ${key} must be a list of regular expressions`);
  }
  return value.map((p) => {
    try {
      return new RegExp(p, 'i');
    } catch (err) {
      throw new Error(`${PROFILE.source}: ${key} has a pattern that is not a regular `
        + `expression - ${JSON.stringify(p)}: ${err.message}`);
    }
  });
}

export function titleFilter() {
  refresh();
  return {
    exclude: patterns(PROFILE.titleExclude, 'titleExclude'),
    include: patterns(PROFILE.titleInclude, 'titleInclude'),
  };
}

/** The oldest date a `since` admits, as `YYYY-MM-DD`, or null for no cut. */
export function sinceCutoff(since) {
  const days = SINCE_DAYS[since];
  if (!days) return null;
  return new Date(Date.now() - days * 86400e3).toISOString().slice(0, 10);
}

