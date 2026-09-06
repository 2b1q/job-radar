// params.mjs - a request becomes board parameters (SRP: pure mapping, no I/O).
//
// Separated from server.mjs so it can be imported by a test: server.mjs starts
// the stdio transport at module load and never returns, so anything reachable
// only through it is unreachable to a test. The same split as the adapters -
// what is pure gets its own file, and that is usually where the interesting
// mistakes live anyway.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

export const PROFILE = loadProfile();

const ROLES = PROFILE.roles || [];
const GRADES = PROFILE.grades || [];
const RELOCATION_COUNTRIES = PROFILE.relocationCountries || [];

/**
 * The boards this server speaks to. Kept here rather than in `server.mjs`
 * because the profile is validated against it before any adapter is wired up.
 */
export const SOURCE_CODES = ['af', 'tm', 'w3', 'sol'];

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

const SKILLS = skillsBySource(PROFILE.skills, PROFILE.source);

/** The slugs this profile uses on one board, falling back to the shared list. */
export function skillsFor(source) {
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

/** Named shortcuts for board taxonomy ids, so a query reads `crypto`, not `903`. */
export const CATEGORIES = PROFILE.categories || {};

/** Tag sets for the client-side intersection filter. Each group is an OR. */
export const TAG_GROUPS = PROFILE.tagGroups || {};

const AF_PRESETS = {
  remote: { countries_workplaces: [{ workplaces: ['remote'] }] },
  ruroots: { countries_workplaces: [{ workplaces: ['remote'] }], isRussianRootsOnly: true },
  countries: { countries_workplaces: [{ countries: RELOCATION_COUNTRIES }] },
  anywhere: { isRemoteAnywhereOnly: true },
};

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

function afFilters({ preset = 'remote', since = 'week', query, minSalary }) {
  const filters = { roles: ROLES, grades: GRADES, since, ...AF_PRESETS[preset] };
  if (query) filters.searchQuery = String(query).slice(0, 255);
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
  const list = Array.isArray(wanted) ? wanted : String(wanted ?? '').split(',');
  return list.flatMap((w) => {
    const key = String(w).trim();
    if (!key) return [];
    return TAG_GROUPS[key] ?? [key];
  });
}

export { ROLES, GRADES, RELOCATION_COUNTRIES, AF_PRESETS, TM_PRESETS, TM_DATES, afFilters, tmParams };
