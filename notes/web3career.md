# web3.career: structured data, and a board that mangles its own titles

Back to the [README](../README.md).

## Reconnaissance

The third board, and the only one that hands over machine-readable data: every
job page and every listing page carries `schema.org/JobPosting` in JSON-LD,
embedded for Google Jobs. That is a contract with a third party rather than a
private layout, so it survives redesigns that would break a class-name parser.
The markup is the fallback, not the source.

**Reconnaissance, before any code was written** — half the work on the previous
board went into discovering that a parameter was not called what the markup said:

| | |
|---|---|
| `robots.txt` | allows everything except `/metrics*`, declares a sitemap |
| JSON-LD | on job pages (12 blocks: the job plus related ones) and on listings (15, one per row) |
| listings | `/{tag}-jobs`. `/node-jobs` and `/typescript-jobs` work; `/nodejs-jobs` and `/node-js-jobs` both 302 to `/404` — the slug is not derivable |
| paging | `?page=N`, and page 2 genuinely differs from page 1 |
| sitemap | an index of four sub-sitemaps |
| session | none needed; every read is anonymous |

Two things the structured data does **not** carry, so they come from the row: the
job **id and url**, and the **tags** (`occupationalCategory` exists and is always
empty). Whether a salary is the board's own estimate is marked by a star in the
markup, the same distinction the other board makes.

### The board mangles its own titles

The row for `Platform Engineer, Core Systems` renders as **`Platm Engineer Core
Systems`** — it deletes the substring `for` wherever it occurs, inside words
included. So the JSON-LD title is authoritative and the rendered one is only good
for checking alignment.

That matters beyond cosmetics: publishing the rendered title would put a typo in
every shortlist and break the dedup key against the other boards.

### Pairing, and why it is checked

The JSON-LD blocks sit in one run at the foot of the page, not inside the rows,
and carry no id. The only link is order — so order is verified rather than
trusted. A silent misalignment would give every job its neighbour's id, and
therefore its url and its dedup key, while the output looked perfectly healthy.

The check is that the rendered title is a **subsequence** of the structured one.
Mangling only ever removes characters, so that tolerates whatever the board
decides to delete next while still catching a genuine misalignment. Requiring
equality would refuse every page; requiring nothing would mispair in silence.

### Salaries are in USD, and are not converted

`salaryMinUsd` is filled from `baseSalary` when the currency is USD, which is
always so far. TalentMove quotes roubles and leaves the field null; converting at
some rate would invent a number that somebody would later quote as real.

`jobs_search` sorts on that field, so its answer now reports `sortedBy`: either
`salaryMinUsd`, or `none - no record on this board carries a USD figure`, or how
many records lack one and sit at the end. A sort on a key half the corpus does
not have is worse than no sort, because records sink for the wrong reason.

## The slug is not derivable, and a wrong one fails the whole call

`/{tag}-jobs` is the address, and the tag is the board's own spelling of a
technology. Re-measured: `/typescript-jobs` answers 200, `/node-jobs` answers
200, `/node-js-jobs` redirects to `/404`, which answers 200 with no rows on it.
(The redirect was a 302 when the board was first mapped and is a 301 now; the
destination is what matters.)

Measured across one ingest, `/{tag}-jobs` for `node`, `typescript`, `backend`,
`defi`, `evm` and `solana` all answer with rows; **`payments` does not exist** and
redirects to `/404` like the rest. There is no rule in which of those the board
has: `defi` and `evm` are listings while `payments` is not, and nothing about the
words says so.

That matters more than a 404 usually would, because a profile's `skills` are
board tag slugs and the same technology is spelled differently on each board. A
profile whose first skill is `node-js` — a perfectly good slug elsewhere — makes
every web3.career call raise

    w3: /node-js-jobs?page=1 does not exist - tag slugs are not derivable,
    check the listing links on the site

and a raised call stores nothing and logs no run. That is the adapter behaving
correctly: the alternative is a page of nothing read as an empty niche.

That is a configuration mistake, so it is now refused as one: `skills` in a
profile is per board, and a slug this profile wrote for another board is turned
down by name before the request goes out. What cannot be checked locally is
whether this board HAS a given slug - `payments` above is the case, and a
whitelist of the ones it does have would go stale the day a tag is added.

It is one sufficient explanation for a store that held 284 AgileFluent rows, 61
TalentMove rows and no web3.career row at all while the adapter was written,
tested and working. The run log cannot tell it from the other one: a `dryRun`
search writes no run either, and there was no web3.career run of any kind to
read. Both were reproduced — the slug above raises, and the first run with a slug
this board knows put 30 rows in the store for 2 requests.

## Listing tags are truncated here too

The same defect as the other board, with a tighter cut: a listing row carries
**exactly 3 tags** while the job page carries 6 to 10.

| posting | listing | page |
|---|---|---|
| `153621` | evm, ethereum, backend | + crypto, defi, engineer, node, solana, typescript, part time |
| `153618` | engineer, blockchain, crypto | + kubernetes, node, rust, solana |
| `102994` | engineer, reliability, blockchain | + golang, kubernetes, node |

The hidden tags include `typescript` and `node` - precisely what a language
filter would look for. It costs nothing here, because this board is queried
through `/{tag}-jobs`, and that runs against the full tag list; it would cost
everything to a filter written against the rows.
