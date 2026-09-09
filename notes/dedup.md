# Dedup across boards

Why one store, what the second key does, and where it stops working. Back to the
[README](../README.md).

## Why one store and not a repository per board

Both boards republish the same Greenhouse and Lever postings, so a vacancy shows
up twice unless something joins them. Two keys do that:

- **`id`** catches the same board offering the same posting again
- **`dup_key`** — normalised `company` + `title` — catches the *other* board
  offering it. Ids are minted per board: one posting arrives as `26043677`
  from AgileFluent and as `tm:266351` from TalentMove, and by id alone those are
  two vacancies. That is not hypothetical; it is how the second copy came back
  marked `new` while the first already carried `applied`

The key is an **exact** match on normalised strings — lowercased, punctuation
stripped, whitespace collapsed — and never fuzzy. The two mistakes are not
equally priced: a false merge hides a live vacancy and says nothing, while a
duplicate row is one line a human sees and dismisses.

**Entities are decoded before the key is built.** One board left `&amp;` in a
title and another did not, so the same posting keyed as
`...backend blockchain` and `...backend amp blockchain` and sat in the store
twice. The key is derived data, so it is recomputed on start when the derivation
changes rather than left as whatever an older version produced.

**Titles are translated per board, and that the key cannot survive.** The same
posting reads `Founding CTO / Technical Lead – Messenger & Stablecoin Payments`
on one board and a Russian rewrite of the same title on the other. Company
plus title cannot match across a translation, so cross-board dedup works for
verbatim republication — the Greenhouse and Lever case, which is most of it — and
not for a board that rewrites. Measured: 1 of 60 web3.career postings was already
known.

**No company, no key.** TalentMove leaves `company` null on some cards, and a
key built from the title alone would collapse every "Backend Developer" on the
board into one row. Those fall back to id-only dedup, which is what they had.

A skipped duplicate never touches the row already stored: it may carry a status
somebody set by hand.

## Recovering the employer from the other board

**No company, no key** is where dedup was weakest, because it is exactly the
board that republishes without attribution that leaves the field blank. The link
back is in the url: a republishing board puts the original posting's id at the
tail of the link it publishes.

    af 26043677  company named
                 url .../lead-senior-backend-developer-typescript-nodejs-remote-020926-266351/
    tm:266351    company null

So a missing company is looked up in the store before the key is built — no
request, the join is already on disk — and written back with `company_from`
naming the row it came from. A derived value that cannot say where it came from
is the quiet answer this repo keeps finding; `jobs_search` returns the same fact
as `companyFrom`.

Measured on a 345-row store: **20** TalentMove rows carried no company, **1** was
recoverable: `tm:265588` from `af 25989739`. The other 19 have no
row on the other side of the link, and 10 AgileFluent rows link to TalentMove
altogether. The mechanism is worth more than that number going forward, since it
runs on every insert: it needs both copies to be in the store, and the store had
been collecting the two boards for one day.

Two constraints, both from the data:

- **the id has to sit at the tail of the url.** `%-266351%` also matches a url
  with that number in the middle, which is a different posting
- **"unknown" is not a name.** AgileFluent writes the literal string for 20 of
  its rows. Copying it across would build the key `unknown|backend developer`,
  and the next unnamed Backend Developer would merge into it — a false merge that
  hides a live vacancy, bought for a cosmetic improvement

## A leading space was never the problem

TalentMove renders the employer as `@` plus the name, and where the name is
wrapped in a tag, stripping the tag leaves the space behind: the store holds
one row whose company begins with a space where another board would write the
same name without one. Checked in the key rather than in the code — the two
spellings through `dupKey` —
and the keys are identical, because `normKey` drops everything that is not a
letter or a digit. So it was cosmetic, and it is fixed in the parser rather than
in `normKey`: the normaliser hiding a board's dirt is how the dirt reaches
everything that does not normalise.

## What a skipped duplicate now says, and what it was worth

A cross-board merge was the only thing here that happened in complete silence:
the second board's copy did not come back, which is the whole point of one
store, and nothing recorded that it had ever happened. `filterFresh` now hangs
the reason on the array it returns and `jobs_search` reports it as `skipped`:
`seen` for this board offering an id already stored, `merged` for a posting
already there under another board's id, named pair by pair.

Measured on the first real web3.career ingest — 6 tags, 270 postings collected,
183 stored:

| | |
|---|---|
| already seen under the same id | 81 (tags overlap heavily; `typescript` after `node` was 38 of 45) |
| merged into another web3.career row | 2 postings, republished on that board under two ids |
| merged into an AgileFluent row | **1** |
| merged into a TalentMove row | 0 |

One cross-board catch out of 270 is in line with the earlier measurement of 1 in
60, and it is the honest size of the effect: the boards overlap where a posting
is a verbatim republication of the same ATS listing, and web3.career mostly is
not that.

## Six postings the store already held twice

Counted after the ingest: **6** pairs of rows share a `dup_key` across af and tm
— the same posting under both ids, sitting there because the key did not exist
yet when the second copy arrived. Nothing merges them retroactively and nothing
should: a row may carry a status somebody set by hand, and deleting it to tidy
the count is the one loss this store cannot undo. What the key does now is keep
a *seventh* copy out.

One of the six is a pair the key could only see after the employer was recovered
from the other board — the recovery worked, and the two rows are now known to be
one posting.

## The key on a third pair of boards

A fourth source, read whole: 411 records collected, **342 stored, 69 merged into
a row that was already there, 0 unexplained.** Which is also the first test of
`dup_key` on a pair of boards it was not built against.

| merged into | postings |
|---|---|
| web3.career | 53 |
| AgileFluent | 1 |
| the same board, under a second id | 15 |

The 53 are the two boards carrying the same startup listings, and they merged on
exactly the key the design expects — normalised company plus title, no fuzz, both
boards spelling the posting the same way because both copied it from the same ATS.
It is a much higher hit rate than the 1-in-60 measured between the boards that
translate their titles, and the reason is the same one: **the key survives
republication and does not survive translation.**

The 15 self-merges are the board republishing its own postings under a second id
- a company relisting, and `count: 411` includes both copies. The id index cannot
see those; the key can, which is the first time the second key has earned its
keep inside one source rather than across two.

## What a merge now adds to the row it merges into

A merge drops the copy that arrived second, which is right for a title, a
salary and a location — two sources merely restating the same posting. It was
wrong for exactly one field.

Only some sources carry a link that leaves for the employer's own application:
`ats` for every record, `sol` for most, and no board in this repository for any.
When such a copy arrived second it was dropped whole, and the store kept a row
pointing back at a board. The link lived in that one call's answer and left with
it, so the day after a run nothing could be asked of the store about it — which
is the only reason a source of employer-side links is worth reading at all.

**So the row gains a field rather than losing the copy.** `apply_url` holds the
way in to the employer, `apply_from` names the record it came from:

| | `apply_url` | `apply_from` |
|---|---|---|
| the row's own source carries the link | its own url | null |
| a merge recovered it from another copy | that copy's url | that copy's id |
| nothing offers one | null | null |

### Why this shape and not one of the other two

**Replacing `url`** was the obvious move and is the one the repository forbids:
*a link is never substituted for another*. The board url is what the board
published, `jobs_mark_status` and a human's bookmarks point at it, and swapping
it under them to gain a second link loses a first.

**A boolean beside `url`** would say that a way in exists and not where it is,
which leaves the reader exactly where they started — opening the posting to find
out.

The pair is not a new idea here either. It is `company`/`company_from`, which
already recovers an employer name a board did not state and records which record
it came from, for the same reason: **a value that arrived from somewhere else has
to say so.** One pattern used twice, rather than a second one invented.

Two rules the write follows. It only ever fills an empty column — `AND apply_url
IS NULL` is in the statement, so two sources offering a link is not a reason to
prefer the newer, and a link somebody has already followed is not swapped under
them. And it writes nothing else: the same merge that adds the link leaves the
title, the source, the skills and any hand-set status exactly as they were.

The order the two copies arrive in no longer changes the outcome. The board copy
first and the employer copy second recovers the link on the merge; the employer
copy first stores it as the row's own; either way there is one row and it has the
way in.

### What happens to rows that were already in the store

**Nothing, and deliberately.** The two columns are added by the same idempotent
migration as the others, and every existing row gets NULL.

They are not backfilled, because the store cannot honestly compute the value.
Whether a stored url reaches the employer is the adapter's judgement — for one
board it is a hostname comparison, for another it is *always false*, for a third
*nobody has ever checked* — and reproducing that here would put a copy of four
adapters' rules in the persistence layer, where they would drift.

So NULL means **"not recorded"**, not "does not reach the employer", the same
distinction `runs.requests` makes for runs written before it was counted. A row
stored before this existed gains the link the first time another source offers
the same posting, which is the path that matters: the rows worth recovering are
the ones an ATS copy will merge into. The rest keep a link back to their board,
which is what they always had.

`jobs_stats` reports `withApplyAtEmployer` per source, counting only rows that
actually carry one — so the gap is visible rather than implied.
