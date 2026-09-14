# career.habr.com, and the two boards measured beside it

Back to the [README](../README.md).

Three russian-language boards were measured for the same gap: product companies
that none of the first four sources reaches. They were ranked on one criterion —
**does a card lead to the employer's own application, or only back to the
board** — and then on whether their answer is usable at all.

**All three were probed**, and the two that were not built are written down here
with their reason so that the next person spends the afternoon on something else.
Both reasons are properties of the board rather than of the day, but a board can
change: re-measure before overturning either, and write the new measurement next to
the old one.

| board | reachable | apply link | verdict |
|---|---|---|---|
| career.habr.com | JSON API, anonymous | its own page, always | **built** |
| djinni.co | HTML listing, anonymous, 15 cards a page, HTTP 200 with no challenge | its own page, always | **measured, not built** — a second `false`, and markup rather than an API |
| getmatch.ru, first probe | listing rendered client-side; the postings come from `/api/`, which `robots.txt` **disallows** | not reached | **closed** — the only way in is the one we are asked not to take |
| getmatch.ru, re-measured | posting pages server-rendered and not disallowed; `sitemap.xml` lists them | its own page | **open, not built** — the first verdict was too strong, and 0 backend Node.js postings in 40; see below |

**None of the three satisfies the criterion.** That is the finding, not a
detail: on the ATS question these boards are all `false`, and the place where a
link actually reaches an employer turned out to be the employer's own system —
see [ats.md](ats.md). So the tie was broken on what a card is worth once it is
collected, and career.habr.com wins that on structure: an API rather than
markup, a stated total, and a filled skill list on every posting that has one.

**djinni.co is buildable and was left alone rather than ruled out.** It answers
anonymously, 15 cards a page, and each card carries a truncated description —
which is more than habr's list gives, and the only thing here that would let the
signals run on a board. What it does not do is reach an employer, so it would be
a second `false` bought with an HTML parser. Worth building the day the
descriptions matter more than the structure; not worth building for coverage
alone, which habr already gives with an API.

**getmatch.ru is the one that is actually closed**, and this is the reason not to
try again. Its `/vacancies` page ships no postings at all — the listing is drawn
in the browser — and the endpoint that holds them sits under `Disallow: /api/` in
its `robots.txt`. There is no anonymous, permitted path to the data. That is a
decision by the site, not a gap in the reconnaissance, and it changes only if
their `robots.txt` does.

### getmatch.ru re-measured: a permitted path exists

The paragraph above is right about the listing and the API and wrong in its
conclusion. `/api/` is still disallowed, but reading a posting never needed it.
17 requests, `curl`, anonymous:

- **`robots.txt`** disallows 15 paths - `/api/`, `/employer/`, `/profile/`, `/p/`,
  `/a/` among them - with no `Allow` line. **`/vacancies/` is not one of them**, and
  it declares `Sitemap: https://getmatch.ru/sitemap.xml`
- **Category listings are still client-side.** `/vacancies/backend` carries no
  link shaped `/vacancies/<id>-<slug>`
- **A posting page is rendered on the server** with the posting in it, and a live
  one carries a schema.org `JobPosting` block: `title`, `hiringOrganization`,
  `baseSalary`, `employmentType`, `datePosted`, `description`, `jobLocation`, and on
  some `jobLocationType: TELECOMMUTE`
- **`sitemap.xml` is the discovery path.** One flat file, not an index, 5.6 MB:
  35,179 URLs, of which **31,676 are postings** - plus 2,148 category pages, 1,298
  companies, 49 salary pages. No `lastmod`, and not in id order. Ids run 41 to
  36,202
- **The sitemap is the archive, not the live board.** An archived posting still
  answers 200, says `Вакансия в архиве` and carries **no** `JobPosting` block. On 15
  pages read, the block and the absence of that sentence agreed every time: ids 41,
  30099, 34199, 35599, 35668 archived; 36120, 36202 and eight of the nine sampled
  evenly from the newest 516 ids live
- **The newest ids are mostly live, and ids follow time roughly.** The nine samples
  from ids 35668-36174 were posted over the four weeks before the read, not
  monotonic in id

What it would cost, which is the open question rather than the permission:

- no date filter and no total: `since` could only be applied locally on
  `datePosted`, after the page is read
- discovery is one 5.6 MB read, then **one request per posting**, newest id first.
  About a hundred ids span a week at the density above, against a per-call ceiling
  of 40 requests - so a week is several calls, each starting below the last id read
- `jobLocationType` was present on 2 of 10 live pages; whether its absence means an
  office or merely an unstated format was not measured - answered below: it is not
  where this board states the format

### What it yields for a backend search: not built

Measured before writing an adapter, because the question after "is it permitted"
is "what does it return". 40 pages, evenly spaced over the newest 200 ids of the
sitemap already read (ids 35,980-36,200, posted over the two weeks before the read), with a
backend Node.js profile's `titleExclude` and `countryAllow` applied as the server
would apply them:

| | of 40 |
|---|---|
| live (`JobPosting` present; the marker again agreed on every page) | 39 |
| title survives `titleExclude` | 21 |
| **Node.js or TypeScript in the title or the stack, among those** | **1**, and it is a QA automation role |
| states remote work, among those | 8 |

Node.js or TypeScript appears on 2 of the 39 live postings at all - that QA role and
a frontend-focused fullstack one the title filter dropped. **Zero backend postings
on that stack**, so the adapter is not written. Re-measure before reopening it; a
board's mix moves.

Three things the sample showed about the board, independent of the profile:

- **The format lives in the page's own chips, not in the JSON-LD.** A remote chip
  on 19 of 39 live pages, `jobLocationType: TELECOMMUTE` on 3. Reading only the
  structured block would have reported the format as mostly unknown
- **24 of 39 titles are in Russian**, and 17 of the 21 that survived are. An
  English `titleExclude` does not read them, so on this board the count that passes
  the title filter overstates what a person would keep. The same held for the
  sources already connected - `notes/titles.md`
- `countryAllow` cut nothing: the place is free text here, so every record counted
  as `countryUnread`

If an adapter is ever written, two constraints follow from the above. The window
walks ids downward across calls, like the watchlist, because a week is about a
hundred pages. And a cached sitemap reports its age in the answer, as `build.mtime`
and `profile.mtime` do - a cache is state that goes stale in silence.

### Refused: calibrating salaries from the archive

The sitemap lists 31,676 postings, almost all archived, and many archived pages
still carry a salary. That is a tempting corpus for what a role actually pays on
this market. **Not done, and not to be:** it is some thirty thousand requests to
one site for statistics rather than for postings anybody could apply to - the
impolite scan this repository avoids everywhere else. A figure from an archived
posting is also a past offer, not a present one.

## What the API answers

    GET /api/frontend/vacancies?type=all&sort=date&page=1
    -> { "list": [ ... ], "meta": { "totalResults": 1252, "perPage": 25,
                                    "currentPage": 1, "totalPages": 41 } }

`robots.txt` disallows account and response paths — `/vacancies/*/responses`,
`/profile`, `/suggest`, `/v1` — and not this one.

## Parameter tolerance, measured on one anonymous listing

Both silences this repository keeps finding are here, on the same board:

| request | total | what it means |
|---|---|---|
| no filters | 1252 | the baseline |
| `totallyBogusParam=42` | 1252 | an unknown NAME is accepted and dropped |
| `qid[]=999` | 0 | an unknown VALUE is a silent zero |
| `qid[]=2` | 0 | and 2 is a gap in the board's own ids, not a typo |
| `skills[]=999999` | 0 | same, on the other multi-value filter |
| `skills[]=nodejs` | 0 | a slug where a term id belongs looks identical to it |
| `qid[]=4` | 275 | |
| `qid[]=4&qid[]=5` | 523 | several values are a UNION |
| `remote=true` | 419 | |
| `q=node.js` | 82 | free text |
| `q=node.js&remote=true` | 51 | and it composes |
| `q=` | 1252 | an empty query is ignored rather than answered with zero |
| `with_salary=true` | 192 | |
| `type=suitable` | 1004 | personalised, and a different answer to a caller with no session |

So `qid` is checked locally against the board's own five ids, and `skills` is
checked for being an id at all. Neither list is whitelisted beyond that: a local
copy of the board's skill taxonomy would go stale the day a skill is added.

**The parameter names are the board's own**, read out of the filter schema its
`/vacancies` page ships — the same schema that states the qualification ids as
`1, 3, 4, 5, 6` and the currencies as `RUR, EUR, USD, UAH, KZT`.

## Paging, and the one place this board is louder than the others

`page`, one based, 25 records whatever else is asked for. `meta.totalPages`
states the last one. **A page past it is HTTP 404**, not an empty list — which
is the opposite of the silent end-of-results every other board here has, and it
is why the walk honours `totalPages` instead of discovering the edge.

## A salary with an amount, a currency, and no period

The record carries `salary: { from, to, currency, formatted }` and states no
period anywhere — no field for it, and nothing in `formatted` either. Currency
arrives lower case (`rur`).

So `salaryMinUsd` is never filled here. A monthly figure read as an annual one
would sort this board's postings among two other boards' annual salaries and be
quoted back later; the number stays in the label with the only conditions the
board actually gave it. Same bargain as TalentMove, for a different reason.

## What the board does not state

`hasRussianRoots` and `visa` are `false` on every record, meaning *not stated
here* rather than *no*. The board has neither dimension. `country` holds the
board's own word for the place — a city from its city taxonomy, not a country —
and `locationVerified` is `false` like everywhere else.

## What is still unmeasured

Whether `sort` has values beyond `date` that change what the first page holds,
and whether a posting can carry an employer's own link in a field the list does
not expose. Both would be measured against a second case before any rule is
drawn from them; generalising from one sample has failed three times here.
