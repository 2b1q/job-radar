# TalentMove: filters, tolerances and traps

How this board's query language was worked out, and every way it was found to
fail quietly. Back to the [README](../README.md).

> **Measured on** the live board over one session, anonymously except where
> noted. Counts move as postings come and go; the behaviours do not.

## The filter vocabulary

Read off the public category page markup (the `*_filter[]` inputs) and the public
WordPress REST taxonomies. No session was involved, and none is needed to repeat
it.

| filter | values |
|---|---|
| `format` | `hybrid`, `office`, `fully-remote` |
| `seniority` | `junior`, `middle`, `senior`, `head`, `c-level` |
| `employment` | `full-time`, `part-time` |
| `skills` | slugs, comma separated in one parameter (see below) |
| `date` | `today`, `7days`, `30days` — one value, not a list |
| `category` | a `job_category` **term id**, not a slug |

Term ids worth having: crypto `903`, ai `1649`, dev `7`, backend `38359`,
devops `38465`, frontend `38448`, fullstack `38462`, data `38467`, qa `38466`,
gamedev `1389`. The full list is one request:
`/wp-json/wp/v2/job_category?per_page=100&_fields=id,slug,name,count`.

All three are confirmed to work as bare query parameters, by measurement rather
than by reading the markup — and the markup would have misled you. See the method
below.

### Confirming a filter without guessing

**Compare `found_posts` with and without the parameter.** If it moves, the
parameter took; if it is identical, the board accepted the name and discarded it.

An earlier version of this note compared `found_posts` against the parameter's
own bucket in `filter_counts` instead, and that form does not hold. On category
38359 the two agree exactly — `found 141`, `fully-remote 141`. On category 1649
they do not: `found 736` against a `fully-remote` bucket of 699, with the buckets
summing to 874. The number matches neither the bucket nor the sum, and why is
unknown. So the buckets are useful for **choosing** a probe — they say roughly
what to expect — and unreliable as the test itself.

The difference form does not depend on what the buckets mean, which is why it
survives the anomaly.

Measured on `category=38359&format=fully-remote`, where `found_posts` is 141
unfiltered and the buckets read `seniority.senior 87`, `employment.part-time 6`:

| parameter | found_posts | verdict |
|---|---|---|
| `seniority=senior` | 87 | applied |
| `employment=part-time` | 6 | applied |
| `seniority_filter[]=senior` — the name in the page markup | 141 | **ignored in silence** |
| `nonsense=whatever` | 141 | ignored, as a control |

The third row is why this is worth doing rather than reading off the HTML: the
board's own form uses `seniority_filter[]`, the API wants `seniority`, and the
wrong one is accepted and discarded without a word. The fourth is the control
that makes the third readable — silence is how this API treats *any* name it does
not know, not a quirk of one parameter.

Two requests per parameter, and it works for any filter added later.

## Searching by stack instead of by category

Categories are a coarse axis — `ai` is nearly empty, `backend` skews to Python and
Go — while the board fills skill tags on every card. Skills cut across categories,
which makes them the axis worth using.

Vocabulary comes from `/wp-json/tm/v1/search-skills`, which needs no session and
returns `{results: [{value, label}]}`. The `value` is the slug: `node-js`,
`typescript`, `nestjs`.

It takes **`q` and `category` together**. `q` alone answers
`{"error":"Category ID or search query is required"}` - a message that names the
one thing it does accept alone, and does not. `category` alone answers
`{"results":[]}`, which reads as "no such skill" rather than "you asked wrong".
The results are a prefix search, so `q=Go` returns Golang, Google Ads and
Governance alongside `go`: the slug is the one whose label matches exactly, and
taking the first result filters on something nobody asked for.

That endpoint reads a nonce from the page into a variable and **never sends it**
— only `Content-Type` goes on the wire. Nothing to store, which is the right
outcome: a WordPress nonce lives about a day and expires without a sound.

Measured on `category=7` (dev), unfiltered `found_posts` 7403:

| query | found |
|---|---|
| `skills=nestjs` | 37 |
| `skills=node-js` | 383 |
| `skills=typescript` | 724 |
| `skills=node-js,typescript` | **932** |
| `skills=zzz-not-a-skill` | **0** |
| `skills=Node.js` — the label, not the slug | 383 |

## How this board fails, and the rule that follows

The same wrong input is loud or silent depending on **which parameter** it is.
This is the single most useful thing to know about the API, because one half of
it produces a large, plausible, wrong number.

| what is wrong | what happens |
|---|---|
| the parameter **name** — `seniority_filter[]` instead of `seniority` | accepted and dropped; the unfiltered total comes back |
| a value of `skills`, `seniority` or `format` | `found_posts` 0 — obviously wrong |
| a value of **`date`** | accepted and dropped; **the unfiltered total comes back** |
| an unknown **`category`** id, e.g. `999999` | `found_posts` 0 — honest |
| a **malformed** `category`, e.g. `7abc` | read as `7`; **a full answer from a different filter** |
| the paging parameter — `page` instead of `pg` | ignored; **page 1 comes back every time** |
| an unknown **member of a `skills` list** — `node-js,zzz` | dropped in silence; the list narrows to what was recognised |
| an unknown `skills` value **on its own** — `zzz` | `found_posts` 0 — loud |
| `category=0`, or a slug instead of an id | HTTP 400, treated as no category at all |

Measured on `category=7&skills=node-js`, where the unfiltered answer is 383:
`date=30days` gives 105, `7days` gives 18, `today` gives 0 — and `7d`, `week`
and `nonsense` each give **383**. A plausible typo in the freshness filter
returns every posting on the board and looks like good news.

The two `skills` rows are the same input treated two ways, and the pair is worth
sitting with: `skills=node-js` returns 104, `skills=node-js,zzz-not-a-skill`
returns 104 as well, while `skills=zzz-not-a-skill` alone returns 0. A typo in a
one-term query announces itself; the same typo as the second of three terms does
not, and quietly narrows the search to something nobody asked for.

`7abc` is the worst of the eight: not an empty result but a complete one from a
filter nobody asked for, and no number in the response says so.

The paging row is the one that actually bit. The adapter sent `page`; the board
reads `pg` and answers every request with the first page. Nothing downstream
noticed, because the store deduplicated the repeats — a four page search reported
"80 found, 20 new" and read as dedup earning its keep. Two silent failures
covering for each other is why `search()` now refuses a page that starts where a
previous one started: the data never says "this is the same page again", so the
adapter has to.

So two things are checked in `params.mjs` before the request leaves. `date`
against the board's own button values, because there is no other way to know.
`category` **by shape only** — a positive integer, nothing else — because an id
that is merely unknown answers 0 for itself, while a whitelist of 58 ids would go
stale the day a category is added. Everything else is left to the board: a zero
answers itself.

**Two vocabularies, and the lookup is category-scoped.** `search-skills` answers
within the category you pass it: `graphql` and `data-engineering` come back empty
under `category=903` and exist perfectly well under `category=7` (17 and 107
postings). "Not in this category" is not "not on this board", and reading it as
the latter throws away a working slug.

**The rule, now that it is measured rather than guessed:** take parameter names
from `data-param` in the markup, never from `name`. Both sit on the same element
— `data-param="employment"` next to `name="employment_filter[]"` — and only the
first is what the API reads. And check each parameter's tolerance separately:
what one rejects loudly, another accepts and discards.

### About the skills list itself

Three things follow, and two of them are counterintuitive:

- **the comma is a union, not an intersection.** 932 exceeds either term alone, so
  listing a whole stack *widens* the search. Narrow with `seniority` or
  `category`, never by adding skills
- **an unknown value returns 0, not the unfiltered total** — the opposite of how
  this API treats an unknown parameter *name*. A typo in a value is loud, a typo
  in a name is silent
- **the label normalises to the slug** — `Node.js` and `node-js` both return 383.
  Convenient, and not worth relying on: the slug is what the vocabulary endpoint
  hands you

**A category is not a partition, and a negative result inside one proves nothing
about the board.** A posting tagged DeFi, titled "Senior Software Engineer for
Data Products", sits in `dev` (7) and **not** in `crypto` (903) — verified by
looking for its id in both. An empty result in 903 therefore says the
intersection was empty in that category, not on the board. Widen the anchor before concluding an absence,
and say which category a negative result belongs to.

**An anchor is required.** `skills` alone returns 400 — the endpoint wants a
`category` or a `search` before it will filter by anything else, so a search
across the whole board by stack is not possible in one call. Anchor on `dev` (7)
for a backend stack, or iterate over the top-level categories.

A caveat on the counts, again: `search-skills` reports 18 for `nestjs` while
filtering returns 37. Same family as the `filter_counts` anomaly on category 1649
— the counters are useful for choosing a probe and unreliable as an answer.

## Two things that do not exist, and why the presets say so

**No country filter.** There is a `location` taxonomy, but it is free text per
posting rather than a country dimension: `Serbia` carries 3 postings while
`Novi Sad, Serbia` and `Cyprus / Georgia` are separate terms, and Croatia,
Slovenia and Slovakia have no term at all. Filtering on it would return almost
nothing and miss the rest in silence, so the country cut belongs downstream, on
each card's own location field.

**No "russian-speaking founders" or EOR filter.** Nothing in the markup
expresses it. The `ruroots` preset stays a stub rather than an approximation.

### `x-wp-nonce`

A neighbouring endpoint sends one; `filtered-jobs` does not need it. If some
future endpoint does, read it off the page at startup — **never store it**. A
WordPress nonce lives about a day and expires without a sound, leaving an error
that looks like a ban.

## Two taxonomies, one row of tags

- A card prints industry and skills in one strip - first tag `job-tags__tag--industry`, the rest `job_tag-*` - and `skills` filters **only the second**; there is no industry parameter (`industry=`, `industries=` are accepted and dropped, 486 against a 486 baseline).
- So a theme that is an industry is invisible to the query and visible on the card: a complete `skills=ai,llm,ml,machine-learning` answer (47 of 47) omitted `tm:262185`, whose card and page both say AI.
- An intersection is therefore two board-side queries intersected on ids, with the card kept as a second route - the board can only union, and a card is a fact for what it prints and proof of nothing for what it omits.

## Card tags are truncated, and by how much

Twenty cards from category 903, each compared against its own job page:

| | |
|---|---|
| truncated | **20 of 20** |
| tags on the card | 3 or 4 |
| tags on the page | 5 to 7 |

False negatives for a client-side filter, by tag group, counted against the
postings that truly match on the page:

| group | true matches | found on cards | false negatives |
|---|---|---|---|
| infra | 3 | 1 | **2 (67%)** |
| crypto | 18 | 17 | 1 (6%) |
| data | 1 | 1 | 0 |
| ai | 0 | 0 | — |

The two infra misses were `tm:266531` and `tm:266197`, whose cards show
Crypto/API/Backend and nothing infrastructural at all - and both were returned by
the board's own `skills` query. That is the whole argument for pushing a group
into the query rather than filtering cards.

## Vacancy pages do not expose the employer's link

Every posting's "Перейти к вакансии" button is `href="#"` with
`data-fancybox data-src="#popup-signup"`. There is no outbound URL in the page at
all, on any posting checked. The board is a discovery layer, not a route to the
employer: the ATS domain - normally the cheapest way to name an unnamed company -
is behind registration.

## The board needs a category, and `query` never reached it

`jobs_count { source: tm, query: "node" }` came back **HTTP 400** with the
board's own sentence about needing "a category or a search query" — while the
caller had passed a query. `tmParams` never took `query`, so it was dropped
between the schema and the request, and the board's complaint read as nonsense.

Refused here now, before the request: a `tm` call with no category names the
categories the profile actually offers, and a `query` is refused outright rather
than silently dropped. The refusal lives at the tool boundary, not in
`tmParams`, which is a pure mapping and is documented as one.

## The envelope escapes twice

A title containing an ampersand arrives here as `Backend &amp; Blockchain` —
the entity, in the text — while another board holds the same posting as
`Backend & Blockchain`. `decode()` ran one pass, so `&amp;amp;` became `&amp;`
and stopped there, and the two titles built dedup keys that could never meet.
`decode()` now runs to a fixed point.

Two stored titles carry an entity. Separately, **41 tm titles carry a ` для …`
tail** the other boards do not use — enough that stripping it before the dedup
key is worth measuring, and not enough to do blind. Not done.
