// _shared/guards.mjs - the two silences worth turning into errors.
//
// Both were real. A layout change left a parser returning nothing while the
// envelope reported results, and it read as "no new jobs". A paging parameter
// the board ignored returned page one every time, and the store's dedup
// swallowed the repeats so a four-page run reported "80 found, 20 new" and
// looked healthy. Neither announces itself in the data, so the adapter has to.

/** Results promised, nothing parsed: the markup moved. */
export function assertParsed(parsedCount, reportedTotal, what) {
  if (reportedTotal > 0 && parsedCount === 0) {
    throw new Error(`${what}: the source reports results but nothing parsed - `
      + 'the markup changed');
  }
}

/**
 * Remembers the first id of each page. A page that starts where an earlier one
 * started is that page again, and nothing in the response says so.
 */
export function pageRepeatGuard(what) {
  const seen = new Set();
  return (firstId, page) => {
    if (firstId == null) return;
    if (seen.has(firstId)) {
      throw new Error(`${what}: page ${page} repeats a page already fetched `
        + `(${firstId}) - the paging parameter is being ignored`);
    }
    seen.add(firstId);
  };
}
