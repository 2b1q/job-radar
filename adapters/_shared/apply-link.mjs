// _shared/apply-link.mjs - where a link goes, read from its host alone.
//
// One board carries the employer's own link in its record and says nothing about
// it, so every posting arrived as `applyAtEmployer: null` - "nobody checked" -
// while most of them pointed straight at an applicant tracking system. What the
// hosts actually were, counted, is in notes/agilefluent.md.
//
// A hostname is evidence, not proof, which is why the answer has three values
// and the unrecognised ones stay `null` rather than being guessed either way.

/** Hosts that ARE an applicant tracking system: the employer's own front door. */
const ATS_HOSTS = [
  'ashbyhq.com', 'greenhouse.io', 'lever.co', 'workable.com', 'bamboohr.com',
  'smartrecruiters.com', 'teamtailor.com', 'gem.com', 'myworkdayjobs.com',
  'workday.com', 'recruitee.com', 'personio.de', 'jobvite.com', 'breezy.hr',
  'applytojob.com', 'rippling.com', 'ashby.hq',
];

/**
 * Hosts that are somebody else's listing: an aggregator, or a board like ours.
 * The last two lines are boards looked at and not taken - a `jobs.` subdomain on
 * one of them would otherwise read as a careers page. notes/sources-not-taken.md.
 */
const AGGREGATOR_HOSTS = [
  'linkedin.com', 'hh.ru', 'getmatch.ru', 'jobgether.com', 'indeed.com',
  'glassdoor.com', 'talent-move.ru', 'web3.career', 'djinni.co', 'career.habr.com',
  'wellfound.com', 'angel.co', 'otta.com',
  'monster.com', 'superjob.ru', 'gorodrabot.ru', 'hirify.me', 'rabota.ru',
  'zarplata.ru',
];

// A subdomain a company puts its own careers page on. `careers.acme.com` is the
// employer; `careers.linkedin.com` would not reach here, because the
// aggregator list is checked first.
const OWN_CAREERS = /^(careers?|jobs?|apply|work|join|hiring)\./i;

const endsWith = (host, list) => list.some((h) => host === h || host.endsWith(`.${h}`));

/**
 * `true` the link opens the employer's own application, `false` it reaches
 * somebody else's listing, `null` nobody can tell from the host.
 *
 * Null is the important one: a messenger link, a shortener or a company's plain
 * marketing page are all real cases here, and calling any of them `false` would
 * be the same invention as calling them `true`.
 */
export function leadsToEmployer(url) {
  let host;
  try {
    host = new URL(String(url)).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return null;
  }
  if (endsWith(host, AGGREGATOR_HOSTS)) return false;
  if (endsWith(host, ATS_HOSTS)) return true;
  if (OWN_CAREERS.test(host)) return true;
  return null;
}
