// smoke.mjs - does each adapter still talk to its board? No MCP, no database.
//
//   node smoke.mjs af
//   TM_COOKIE='...' node smoke.mjs tm [category]
//   node smoke.mjs w3 [tag]
//
// The two boards that are addressed by their own taxonomy take it as the second
// argument, and fall back to the first entry the profile names for THAT board -
// a category for one, a listing slug for the other. Neither vocabulary is the
// other's, which is why there is no single default here.
//
// The query comes from the active profile, so this exercises the same path a
// tool call takes rather than a stack somebody hard-coded here once.
import * as agilefluent from './adapters/agilefluent.mjs';
import * as talentmove from './adapters/talentmove.mjs';
import * as web3career from './adapters/web3career.mjs';
import { CATEGORIES, PROFILE, afFilters, skillsFor, tmParams } from './params.mjs';

const which = process.argv[2] || 'af';
const arg = process.argv[3];

const show = async (label, count, jobs) => {
  console.log(`${label}: profile "${PROFILE.name}" from ${PROFILE.source}`);
  console.log('count:', count);
  console.log(`${jobs.length} jobs, first:`, jobs[0]);
};

if (which === 'af') {
  const filters = afFilters({ preset: 'remote', since: 'week' });
  await show('af', await agilefluent.count(filters), await agilefluent.search(filters, 1));
} else if (which === 'tm') {
  if (!process.env.TM_COOKIE) {
    console.warn('TM_COOKIE is empty: this board sometimes answers 401 without a session');
  }
  // The endpoint answers HTTP 400 without a category or a search query, so a
  // preset alone is not a request this board accepts - `node smoke.mjs tm` used
  // to fail on that with or without a session.
  const category = arg || Object.keys(CATEGORIES)[0];
  if (!category) {
    console.error('tm needs a category: node smoke.mjs tm <id|name>, or give the '
      + 'profile a categories map - the endpoint answers 400 without one');
    process.exit(2);
  }
  const params = tmParams({ preset: 'remote', category });
  await show(`tm (category ${category})`, (await talentmove.count(params)).found,
             await talentmove.search(params, 1));
} else if (which === 'w3') {
  // This board is addressed by tag page, not by preset: the slug is its taxonomy,
  // and its own - `PROFILE.skills[0]` used to be whatever the profile listed for
  // any board, which is how this script asked web3.career for /node-js-jobs.
  const tag = arg || skillsFor('w3')[0];
  if (!tag) {
    console.error('w3 needs a tag: node smoke.mjs w3 <slug>, or give the profile '
      + 'a skills list for w3 - the slugs are this board\'s own');
    process.exit(2);
  }
  await show(`w3 (${tag})`, await web3career.count({ tag }), await web3career.search({ tag }, 1));
} else {
  console.error(`unknown board "${which}" - one of: af, tm, w3`);
  process.exit(2);
}
