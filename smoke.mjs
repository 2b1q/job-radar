// smoke.mjs - does each adapter still talk to its board? No MCP, no database.
//
//   node smoke.mjs af
//   TM_COOKIE='...' node smoke.mjs tm
//   node smoke.mjs w3 solidity
//
// The query comes from the active profile, so this exercises the same path a
// tool call takes rather than a stack somebody hard-coded here once.
import * as agilefluent from './adapters/agilefluent.mjs';
import * as talentmove from './adapters/talentmove.mjs';
import * as web3career from './adapters/web3career.mjs';
import { PROFILE, afFilters, tmParams } from './params.mjs';

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
  const params = tmParams({ preset: 'remote' });
  await show('tm', (await talentmove.count(params)).found, await talentmove.search(params, 1));
} else if (which === 'w3') {
  // This board is addressed by tag page, not by preset: the slug is its taxonomy.
  const tag = arg || PROFILE.skills?.[0];
  if (!tag) {
    console.error('w3 needs a tag: node smoke.mjs w3 <slug>, or give the profile a skill');
    process.exit(2);
  }
  await show(`w3 (${tag})`, await web3career.count({ tag }), await web3career.search({ tag }, 1));
} else {
  console.error(`unknown board "${which}" - one of: af, tm, w3`);
  process.exit(2);
}
