// _shared/text.mjs - string handling every adapter needs and none of them owns.
//
// One `normKey`, deliberately. Three implementations of "normalise a string for
// comparison" grew independently - tag matching, title alignment, and the
// store's dedup key - and had already drifted: two removed separators
// (`node.js` -> `nodejs`) while the third replaced them with a space
// (`node js`). Nothing failed loudly. Dedup would simply have stopped matching
// across boards and said nothing, which is the failure class this repo keeps
// finding.
//
// Unifying on the separator-removing form was measured before it was done: on a
// 344-row store both forms produce 31 duplicate groups and zero new merges, so
// the change is a no-op on real data and strictly better in principle - it pairs
// "Back-End Engineer" with "Backend Engineer", which two boards will spell
// differently for the same posting.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/** Undo the handful of HTML entities that reach us through titles and tags. */
export const decode = (s) => String(s ?? '').replace(/&(#?\w+);/g, (m, e) => ENTITIES[e] ?? m);

/** Tags out, entities decoded, whitespace collapsed. Human-readable text. */
export const strip = (s) => decode(String(s ?? '').replace(/<[^>]+>/g, ' '))
  .replace(/\s+/g, ' ')
  .trim();

/**
 * The comparison key: lower case, entities decoded, everything that is not a
 * letter or a digit removed. Exact equality on this, never a substring or a
 * distance - a false merge hides a live vacancy in silence, while a duplicate
 * costs one row somebody sees and dismisses.
 */
export const normKey = (s) => strip(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
