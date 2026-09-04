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
