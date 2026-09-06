# jobs.solana.com: a JSON API, and a link that reaches the employer

Back to the [README](../README.md).

## Why this board is here

Not because it is another aggregator. Because its apply link leaves the board.

Measured over the whole board, 411 records: **378 open the employer's own system —
Ashby, Greenhouse, Lever, Gem, a company's own careers domain — 33 open a form the
board hosts itself, and 0 have no link at all.**

web3.career does the opposite: every `/i/...` link redirects back to
web3.career and the employer sits behind a signup, so a company found there has
to be identified by name before it can be reached at all. That difference is the
reason this source exists, and `applyAtEmployer` is where it is written down.

The 33 are not broken. The board hosts the form and the application still
arrives; it is a different thing from an ATS link, and the difference is what a
caller is choosing between. Substituting the board's own page for a missing
outbound link — quietly, so it looks like an apply url — is the failure this
field exists to prevent.

## Reconnaissance, before any code

| | |
|---|---|
| platform | Getro (`x-powered-by: Getro`, and the footer of the apply form says so) |
| `robots.txt` | one line, a sitemap. Nothing is disallowed |
| API | **yes** — `POST https://api.getro.com/api/v2/collections/858/search/jobs` |
| network id | `858`, read out of the board's own page state (`__NEXT_DATA__ → network.id`), not guessed |
| body | `{"page": 0, "query": "", "filters": {}}` |
| envelope | `{"results": {"count": 411, "jobs": [ … ]}}` |
| fallback | the page is Next.js and embeds the same 20 records in `__NEXT_DATA__`, camelCased. If the API ever closes, the markup is not the fallback — that is |

**The API answers 406 to a request that does not ask for JSON.** No body, no
explanation. An `accept: application/json` header is the whole difference, and
that cost one confused request to find.

### Paging

`page` is **zero based**. `hitsPerPage` is accepted and ignored: 5 or 100, a page
is 20 records either way, so the whole board is 21 requests.

The end of the walk is not guesswork: a page past the last answers `jobs: []`
with `count` unchanged, so the total says how much there was and the collected
length says how much was read. 411 records → page 20 holds 11, page 21 and page
999 hold none.

Order is newest first by `created_at`, checked across 60 records. Nothing relies
on it.

### Filters, and what each one does when it is wrong

The repository rule is that tolerance is per parameter and does not travel
between boards. It does not travel *inside* this one either:

| filter | wrong value |
|---|---|
| `work_mode` | **HTTP 422**, and it names what it wanted: `Only on_site and remote are allowed as work mode options` |
| `seniority` | **HTTP 422**, `value not allowed` |
| `job_functions` | **`count: 0`, silently.** The name is read, the value is not, and an empty answer looks exactly like an empty niche |
| `locations`, `skills`, `remote`, and any name the API does not know | accepted, dropped, and the answer is the unfiltered 411 |

Two of the three real filters refuse a bad value out loud, and the third answers
zero. So `work_mode` is used, `seniority` could be, and **`job_functions` is not
exposed**: a filter whose failure mode is a plausible empty result is the one
thing this repository will not put behind a tool call.

`query` is free text and works. It **narrows** with every word added — `rust` 76,
`typescript` 69, `rust solana` 62 — so it takes one term rather than a stack, and
the terms the caller did not get to use come back in the answer as
`ignoredSkills`.

**There is no date filter.** `created_at`, `posted_after` and everything else
tried is accepted and dropped, so `since` cannot be expressed here and is not
approximated. Every record carries `created_at`, so a caller can cut by date
after the fact.

### The vocabulary the records use

`work_mode`: `remote`, `on_site`, and **null** — 6 of 60 records have no work mode
at all, and no filter value reaches those.

`seniority`: `entry_level`, `mid_senior`, `senior`, `director`, `vice_president`,
`cxo`, and null. Note `lead` is not among them, so the profile's grades do not map
onto this board one for one.

`source` on a record is `career_page` or `admin_portal`. In a 60-record sample the
board-hosted links were exactly the `admin_portal` ones — a perfect correlation
that is **not** used: one sample has been enough to be wrong three times here, and
the url's host is direct evidence where `source` is a proxy for it.

## Money

`compensation_amount_min_cents` with `compensation_currency` and
`compensation_period`. 17 of 60 records carry a figure, all of them USD a year.

`salaryMinUsd` is filled only when the board says **USD** *and* the period is
**year**: the field is compared against annual figures from two other boards, and
`period_not_defined` next to a number is the "number without its conditions" this
repository refuses to store. Euros and undefined periods stay in the label, where
the conditions travel with them.

## Location, and why nothing is derived from it

The board states `locations` and `work_mode`. Both are copied and neither is
believed: `locationVerified` is `false` on every record here, as it is on every
record from every other board.

That is not caution for its own sake. Three postings have been measured saying one
thing and meaning another — a `remote` that was an office five days a week in
another country, a `Remote` that was a hybrid, a country code on a posting whose
own text said it operates in over 25 countries. The board's claim is worth
storing; the claim that the board is right is not ours to make.

## What one read costs

The whole board is 21 requests at 20 records a page. At this repository's pace for
a public board — 3.5 s plus up to 2.5 s of jitter — that is about 95 seconds, and
**a default MCP client gives up at 60**: the run finishes and lands in the store,
but the client sees a timeout and no answer. Ask for fewer pages per call, or
raise the client's timeout, if the answer matters as much as the store.

No refusal has been seen at any point: 76 requests in one afternoon, including 39
inside twenty minutes while mapping the filters.
