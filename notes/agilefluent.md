# AgileFluent

Back to the [README](../README.md).

## `salaryMinUsd` is the posting's minimum, not a dollar figure

The board fills one numeric field for every posting and states the currency only
in the label beside it. Counted over the 284 rows one store held, the labels use
**eleven** currency markers:

| marker | distinct labels |
|---|---|
| `$` | 46 |
| `€` | 10 |
| `PLN` | 5 |
| `RUB` | 4 |
| `CAD` | 3 |
| `GBP`, `JPY` | 2 each |
| `INR`, `SGD`, `PEN`, `BYR` | 1 each |

The shape is `<marker><min>–<max>k / <period>`, and `Не указана` where the
posting states nothing.

The measured case: `26090315`, label `JPY8000–16000k / год`, `salaryMinUsd`
**8000000**. `jobs_search` sorts descending on that field, so a yen figure sits
above every dollar salary on the board — and 8 000 000 of anything reads as an
outlier worth opening.

The board is not converting and is not wrong about its own posting: it is
reporting the minimum in the currency the employer quoted. The field name is what
makes it a defect downstream.

**So the label decides.** A figure survives into `salaryMinUsd` only where the
label opens with `$` or `USD`; anything else — including a label the board did
not send at all — leaves the field null and the label carrying the number in the
currency it was written in. Nothing is converted: that rule was never the one
being broken, and a rate-converted figure is the number somebody quotes back six
months later.

The other two adapters already worked this way. TalentMove quotes monthly roubles
and leaves the field null; web3.career fills it only when `baseSalary.currency`
is USD. Two adapters agreeing and a third disagreeing about what one field name
means is worse than any of the three answers.

## `searchQuery` is a phrase, not a set of keywords

The reported symptom was a query that returned nothing with no error — the shape
of failure this repository keeps finding. It is not a broken parameter. Measured
on one preset over a month, single terms first:

| query | total |
|---|---|
| *(no query)* | 1975 |
| `backend` | 296 |
| `c++` | 222 |
| `node.js` | 57 |
| `node` | 23 |
| `js` | 12 |
| `nodejs` | 8 |
| `backend node.js` | 6 |
| `node.js backend` | 2 |
| `backend node` | **0** |
| `node js` | **0** |
| `backend nodejs` | **0** |

Two facts fall out of the bottom half. **Order matters** — `backend node.js` is
6 and `node.js backend` is 2, so the words are not a set. And **`node.js` is one
token** — `backend node` finds none of the six postings that `backend node.js`
finds, though a substring search would find all of them.

So the words must be adjacent and in order: it is a phrase search. A stack typed
into a query — two or three technologies — is a phrase nobody wrote, and the
board answers it with an honest zero that reads as an empty market.

Two things follow, and neither is a fix to the board:

- **A multi-word query is refused locally**, with a sentence saying what the
  board would have done with it. A single term still reaches the board unchanged.
- **`search` now reports the board's own total.** `/jobs/search` states only
  `hasMore`, so `found` came back equal to whatever was collected and a narrowed
  answer could not be told from a short read. The total costs one extra request
  per search, through `/jobs/count`, and it is what makes a zero legible.

An unknown parameter *name* behaves the way it does everywhere else here:
`search`, `query` and `searchQueryXYZ` were each accepted and dropped, and each
answered with the unfiltered 1975.

Separately, `roles` is a closed vocabulary and refuses an unlisted value with
**HTTP 500** rather than with a zero — `roles: ["Backend Developer"]` crashed the
count endpoint, the same way `principal` does in `grades`.

## What is still unmeasured

Whether the board ever sends a figure with no label at all. None of the 284 rows
did — every one carried a label, `Не указана` included — so the case is handled
(no label is no currency, so no figure) rather than observed.

What the `roles` vocabulary actually contains. It is closed and it answers a
wrong value with a 500, which is loud enough to leave to the board; the list
itself has not been read out of anything the site publishes.
