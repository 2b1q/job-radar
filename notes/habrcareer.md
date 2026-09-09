# career.habr.com, and the two boards measured beside it

Back to the [README](../README.md).

Three russian-language boards were measured for the same gap: product companies
that none of the first four sources reaches. They were ranked on one criterion —
**does a card lead to the employer's own application, or only back to the
board** — and then on whether their answer is usable at all.

**All three were probed on 2026-09-09**, and the two that were not built are
written down here with their reason so that the next person spends the afternoon
on something else. Both reasons are properties of the board rather than of the
day, but a board can change: re-measure before overturning either, and put the
new date next to the old one.

| board | measured | reachable | apply link | verdict |
|---|---|---|---|---|
| career.habr.com | 2026-09-09 | JSON API, anonymous | its own page, always | **built** |
| djinni.co | 2026-09-09 | HTML listing, anonymous, 15 cards a page, HTTP 200 with no challenge | its own page, always | **measured, not built** — a second `false`, and markup rather than an API |
| getmatch.ru | 2026-09-09 | listing rendered client-side; the postings come from `/api/`, which `robots.txt` **disallows** | not reached | **closed** — the only way in is the one we are asked not to take |

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

## What the API answers

    GET /api/frontend/vacancies?type=all&sort=date&page=1
    -> { "list": [ ... ], "meta": { "totalResults": 1252, "perPage": 25,
                                    "currentPage": 1, "totalPages": 41 } }

`robots.txt` disallows account and response paths — `/vacancies/*/responses`,
`/profile`, `/suggest`, `/v1` — and not this one.

## Parameter tolerance, measured on one anonymous listing, 2026-09-09

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
