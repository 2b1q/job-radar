// adapters/index.mjs - the boards this server speaks to, by source code.
// SRP: a registry, nothing else. Adding a board is one import and one entry
// here; `params.mjs` validates the profile against these codes and `server.mjs`
// derives its schema and its dispatch table from them.
//
// It lives here rather than in `server.mjs` because the profile is checked
// against the codes before any tool is registered, and `server.mjs` starts the
// stdio transport on import - so nothing a test needs can be reached through it.

import * as agilefluent from './agilefluent.mjs';
import * as ats from './ats.mjs';
import * as habrcareer from './habrcareer.mjs';
import * as solana from './solana.mjs';
import * as talentmove from './talentmove.mjs';
import * as web3career from './web3career.mjs';

/** Source code -> adapter module. A table, not state, hence frozen. */
export const ADAPTERS = Object.freeze({
  af: agilefluent,
  tm: talentmove,
  w3: web3career,
  sol: solana,
  hc: habrcareer,
  ats,
});

/** Insertion order, and the order the tool descriptions list the boards in. */
export const SOURCE_CODES = Object.keys(ADAPTERS);
