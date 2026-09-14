# What `country` holds, per source

Back to the [README](../README.md). Why `countryAllow` judges codes only, and what it would
take to reach the other sources.

AgileFluent writes a lower-case ISO-3166 alpha-3 code, or `ww` / `unk` - measurements in
`notes/agilefluent.md`. Every other source writes whatever its board shows. This is the
shape of those values, so that "normalise the free text into a code" is decided from data.

**Scope:** every row stored from these sources at the time, classified
offline - no request. The rows are what earlier searches collected, not a fresh sample of
each board. Values are counted by shape rather than listed, because the raw values are the
cities of a live search.

| source | rows | names one country | remote, no place | macro-region | place, no country | empty |
|---|---|---|---|---|---|---|
| sol | 342 | **212** | 92 | 9 | 2 | 27 |
| w3 | 238 | 2 | 108 | 2 | **126** | 0 |
| ats | 120 | 53 (+5 naming several) | 7 | 31 | 24 | 0 |
| tm | 76 | 6 | 0 | 0 | 4 | **66** |
| hc | 25 | 0 | 0 | 0 | 13 | 12 |

How a value was classified: a comma-, slash- or bracket-separated part equal to a country
name in English or Russian from the runtime's own region table, plus `USA` and `UK`; a
US `City, ST` counts as the United States. `EMEA`, `AMER`, `APJ`, `Europe` and the like
are macro-regions. A bare `Remote` or `Anywhere` names no place.

What it says:

- **sol is where normalisation would pay, and cheaply.** 62% of its rows already name a
  country by name, and the United States is 158 of 342 - the same skew as AgileFluent's
  global remote. A name-to-code table reaches it; no city list is needed
- **w3 would need a gazetteer, not a name table.** Half its rows are a city alone and
  most of the rest are `Remote` or `Anywhere`, which a country cut must keep anyway
- **ats** is a watchlist, so its shares describe whoever chose the employers, not a
  board. A quarter of it is a macro-region, which no code expresses
- **tm and hc** are mostly empty or a city; there is little to cut

Not done, on purpose: a free-text parser. `Remote`, `USA (Remote)` and `<city>, <state>, USA`
parse differently, and a wrong parse is a posting dropped without a word - the failure the
filter counts `countryUnread` to avoid.
