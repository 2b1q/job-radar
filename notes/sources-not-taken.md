# Sources looked at and not taken

Back to the [README](../README.md).

A public tool should be able to say why it does not read a board people expect it
to read. Each entry below was checked, and each says what was checked and when,
so the decision can be revisited rather than inherited.

The repository's own criterion is in [ats.md](ats.md): does the apply link reach
the employer, or only the board. It is not the only reason a source is refused,
and it is not the reason for most of these.

## Refused because `robots.txt` closes the path

| source | path | what it says | date |
|---|---|---|---|
| Remotive | `/api/remote-jobs` | `Disallow: /api/*` **and** `Disallow: /jobs/*` for `*` | 2026-09-11, `curl` |
| Landing.jobs | `/api/v1/jobs` | `Disallow: /api/`, and `/jobs/search` too | 2026-09-11, `curl` |
| cryptojobslist | `/api/jobs` | `Disallow: /api/` | 2026-09-11, `curl` |
| getmatch | listing pages | closed — see [habrcareer.md](habrcareer.md) | earlier |

**Remotive is the awkward one, and the decision is deliberate.** Its API is
publicly documented for programmatic use, with its own terms — at most four reads
a day, attribution, no republishing — and it needs no key. And its `robots.txt`
disallows `/api/*` for every agent. Two instructions from the same publisher
pointing opposite ways.

This repository reads `robots.txt` as the instruction that binds, for one reason
that has nothing to do with which document is more specific: the file is the one
a publisher can change unilaterally and expects to be obeyed without being
renegotiated. A tool that reasons its way past it once will do it again on a site
where the documented API was the stale half. So Remotive is not read, and this
paragraph is the answer to anyone who asks why a remote-jobs tool skips one of
the better-known remote-jobs APIs.

If that reading is ever revisited, the thing to check first is whether
`Disallow: /api/*` still stands — not whether the API still works.

## The two big boards, and what their `robots.txt` actually says

A desk survey said both blanket-block automated readers. Read directly on
2026-09-11, neither does — and both are still refused, for reasons worth stating
accurately rather than conveniently.

**Indeed.** 13 KB of `robots.txt`, and nowhere in it a bare `Disallow: /`. The
`*` group opens with `Allow: /`. What it closes is exactly the part this tool
would read: `/viewjob?` and `/m/viewjob?` — the vacancy page — plus `/rss`,
`/jobs/<country>/`, `/jobs/title` and the localised search paths (`/q-`,
`/praca`, `/empregos`, and so on). Named agents get groups of their own, and the
split is between purposes rather than vendors: a *search and assistant* group
(`Googlebot`, `ChatGPT-User`, `PerplexityBot`, `Claude-User`, `Claude-SearchBot`,
`OAI-SearchBot` among them) is given `Allow: /` and the same Disallow list, while
a *training* group (`GPTBot`, `CCBot`, `anthropic-ai`, `ClaudeBot`, `Bytespider`
and more) gets the same list again. So an agent reading for a person is not
singled out — the vacancy path is closed to everybody, which is all this decision
needs. Its publisher read API closed in 2023 and the site sits behind a
Cloudflare challenge.

**Monster.** 1.6 KB, no bare `Disallow: /`. `Disallow: /jobs/search?` with
`Allow: /jobs/search?q=` in front of it, and every paginated form closed
(`/jobs/search?*page=`). So the first page of a query is permitted and walking
the results is not — which is not a source, it is a sample. The only programmatic
route is a partner Job Search API issued by Monster on request, and even through
it the link is `jobview.monster.com`: a keyed source whose `applyAtEmployer` is
`false`.

Both sites' terms of use were reported by the earlier desk survey to forbid
scraping and data mining outright. **That reading has not been verified here** —
terms pages are rendered client-side and were not fetched — so it is recorded as
somebody else's claim, and the decision above does not rest on it.

## Refused because the link stops at the board

These are ordinary, well-behaved sources. They are simply not what this tool is
for — the README says the point is a way in to the employer, and the rest is for
finding out that a job exists. Their hosts are in `AGGREGATOR_HOSTS`
(`adapters/_shared/apply-link.mjs`) so that a posting linking to one of them is
classified rather than guessed at, whether or not this repo ever reads them.

| source | what it is | where its link goes | `robots.txt`, read 2026-09-11 |
|---|---|---|---|
| superjob.ru | board, RU | its own vacancy page | no blanket block; the barrier is the key — its API wants `X-Api-App-Id` on every request, per the vendor's docs, not re-verified here |
| rabota.ru, zarplata.ru | boards, RU | their own vacancy pages | not read |
| gorodrabot.ru | aggregator of other portals | to the portal it aggregated, which links onward — two hops | `Disallow: /go?id=`, which is the outbound hop itself, and `/*?p=*`, which is the pagination |
| hirify.me | board and aggregator, RU IT | behind a paid tier | `Disallow: /api/*`, plus `/?search*`, `/?sort_by*` and `/?page*` |
| jobs.probablygood.org | curated impact board | to the employer — the one source here whose link is right, and it has no feed and no API to read it from | `Disallow:` with nothing after it: everything allowed |

Adding those six hosts to `AGGREGATOR_HOSTS` reclassified **1 row of 1087** in a
live store, `null` to `false`, and that row carried no `apply_url`, so nothing
stored had to be rewritten. The value is forward-looking: each of them serves
postings under a `jobs.` or `careers.` host of its own, which the careers-page
rule would otherwise read as an employer.

## Refused because there is nothing to read

- **cryptocurrencyjobs.co** — no feed and no API; the site searches through an
  embedded index.
- **Wellfound, Otta / Welcome to the Jungle** — no public API, and anti-bot in
  front of the pages.
- **Hacker News `jobstories`** (the Firebase feed, not the monthly thread) — 31
  ids, no posting text, and the link goes to the incubator's portal rather than
  to the employer. The monthly *Who is hiring* thread is a different source and is
  still a candidate.
