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

/**
 * Undo the HTML entities that reach us through titles and tags, to a fixed
 * point: one board escapes its envelope twice, so `&amp;amp;` arrives where
 * `&` was meant and a single pass leaves `&amp;` in the title. That title then
 * builds a dup_key no other board can meet.
 */
export function decode(s) {
  let out = String(s ?? '');
  for (let pass = 0; pass < 4; pass++) {
    const next = out.replace(/&(#?\w+);/g, (m, e) => ENTITIES[e] ?? m);
    if (next === out) return out;
    out = next;
  }
  return out;
}

// A closing block tag is a sentence boundary; a space is not. Greenhouse sends
// a posting as HTML, and flattening `</li>` to a space glued a list of bullets
// into one "sentence", so a quote ran from an office requirement straight into
// the next heading.
const BLOCK_END = /<\/(?:p|li|ul|ol|h[1-6]|div|section|tr|td|blockquote)\s*>|<br\s*\/?>/gi;

/**
 * Tags out, entities decoded, whitespace collapsed. Human-readable text.
 *
 * Newlines survive: `sentences()` in `_shared/signals.mjs` splits on them, and
 * they are the only trace a list leaves once the tags are gone.
 */
export const strip = (s) => decode(String(s ?? '').replace(BLOCK_END, '\n').replace(/<[^>]+>/g, ' '))
  .replace(/[ \t\u00a0]+/g, ' ')
  .replace(/\s*\n\s*/g, '\n')
  .trim();

/**
 * The comparison key: lower case, entities decoded, everything that is not a
 * letter or a digit removed. Exact equality on this, never a substring or a
 * distance - a false merge hides a live vacancy in silence, while a duplicate
 * costs one row somebody sees and dismisses.
 */
export const normKey = (s) => strip(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
