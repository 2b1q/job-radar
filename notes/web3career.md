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
