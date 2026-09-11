# The employer watchlist

Back to the [README](../README.md).

Every job board in this repository was measured on one question — does its apply
link reach the employer, or only the board — and the boards added for coverage
all answer *no* (see [habrcareer.md](habrcareer.md)). The place where the answer
is *yes* is not a board at all: it is the employer's own applicant tracking
system, and seven of the common ones publish an unauthenticated list per company.

    GET https://boards-api.greenhouse.io/v1/boards/<slug>/jobs?content=true
    GET https://api.ashbyhq.com/posting-api/job-board/<slug>?includeCompensation=true
    GET https://<slug>.bamboohr.com/careers/list
    GET https://api.lever.co/v0/postings/<slug>?mode=json
    GET https://apply.workable.com/api/v1/widget/accounts/<slug>?details=true
    GET https://<slug>.recruitee.com/api/offers/
    GET https://<careers-host>/jobs.rss?per_page=200          (Teamtailor)

`applyAtEmployer` is `true` for every record from all seven, and it is not a
courtesy: the url addresses the company's own instance. It carries
`applyFrom: 'provider'` to say where that certainty came from — two of the seven
serves its links from the company's own careers domain rather than from its own,
so a later classifier reading hosts must not be able to disagree with these rows
in silence.

The first three were measured when this source was built; the last three on
2026-09-11, in the section below.

## Finding a company's instance name

The slug in a watchlist entry is the company's own instance name on the
provider, and there is one cheap way to find it: **open the employer's careers
page and look at where it goes.** Either the careers link redirects to the
provider's host, and the subdomain is the slug, or the provider's board is served
from the company's own domain, in which case any posting link on the page names
it. One request, and the method is the same for all seven.

**Do not go looking for it by guessing slugs against the providers' APIs.**
Finding one live Recruitee tenant to measure took thirty-odd probes on
2026-09-11 — and every one of those is a request to somebody's API about a
company that is not there. It is impolite, it is slow, and it fails on exactly
the companies whose instance is not named after them. The number is in
[request-budget.md](request-budget.md) because it is worth knowing; the method is
not worth repeating.

## Why this is one source and not a new interface

The difference is real — a board answers "who is hiring", a watchlist answers
"what is open at these companies" — and it turned out to live entirely in the
parameters. Three dialects of one request, one record shape, and `pages` meaning
*how many companies to read* rather than *how many pages to walk*. Nothing
downstream needed anything: not the store, not the dedup key, not the four
tools. A second interface would have bought a second code path for a word.

One thing did change, and it is about ORDER rather than about the key. The dedup
key is `company + title` as everywhere else, and here it matches *better*,
because the ATS record is the original that boards republish. But the store keeps
the row that arrived first, and an ATS copy arriving second was dropped along
with the one thing it was added for.

So a merge now ADDS the way in to the employer to the row it merges into, in
`apply_url`, and rewrites nothing else. Either arrival order ends in one row that
has it. The shape, the two alternatives it was chosen over, and what happens to
rows stored before the column existed are in [dedup.md](dedup.md).

## What each provider states, and what it does not

| | Greenhouse | Ashby | BambooHR |
|---|---|---|---|
| total | `meta.total` | none — its own list length | `meta.totalCount` |
| paging | none: the whole list, one request | none | none |
| search parameter | none | none | none |
| company name | `company_name` | not stated | not stated |
| posting body | `content`, twice escaped | `descriptionPlain` | **none in the list** |
| publication date | `first_published` | `publishedAt` | not stated |
| work mode | not stated | `workplaceType` | `isRemote`, often null |
| salary | not in this payload | `compensation.compensationTierSummary` | not in this payload |
| skills or tags | none | none | none |
| unknown company | **404** | **404** | **302** to its marketing site |

Three consequences, in the order they bite:

- **Redirects are not followed.** A followed 302 does not fail — it parses as a
  page with no postings, which reads as a company with nothing open. `redirect:
  'manual'`, and any 3xx is "no such instance".
- **No provider states a period beside an amount**, so `salaryMinUsd` is null on
  every record here and the figure stays in the label.
- **A query is a local filter.** None of the three offers a search parameter, so
  a query narrows the titles after they arrive, and the answer reports
  `filtered` separately from `found`. A local filter and a board's own answer are
  different facts about a run.

Greenhouse sends the posting body HTML-escaped inside a JSON string, so it
arrives twice encoded: `&lt;p&gt;` has to become `<p>` before it can become
text. BambooHR's list carries no body at all — its per-posting detail endpoint
does, at one request per vacancy, which is a whole budget for one company's
descriptions and is not spent.

## Three more providers, measured 2026-09-11

Measured with `curl` against live instances. The earlier desk survey used a
fetcher that paraphrases a response rather than returning it, which is not a
measurement by this repository's rules - so every figure below was taken again.

| | Lever | Workable | Recruitee |
|---|---|---|---|
| endpoint | `api.lever.co/v0/postings/<slug>?mode=json` | `apply.workable.com/api/v1/widget/accounts/<slug>?details=true` | `<slug>.recruitee.com/api/offers/` |
| envelope | a bare array | `{ name, description, jobs[] }` | `{ offers[] }` |
| total | none — its own list length | none | none |
| paging | `limit` and `skip`, both honoured | none: the whole list, one request | none |
| search parameter | none | none | none |
| company name | not stated — the slug is it | `name`, on the envelope | `company_name` |
| posting body | `descriptionPlain`, **9 of 13** | `description` HTML, 140 of 140 | `description` HTML, 12 of 12 |
| publication date | `createdAt`, epoch ms | `published_on`, `YYYY-MM-DD`, 140 of 140 | `published_at`, `2026-08-19 13:55:09 UTC` |
| work mode | `workplaceType`: remote / hybrid / onsite / unspecified | `telecommuting`, boolean | `remote`, `hybrid`, `on_site` — three booleans |
| salary | `salaryRange { min, max, currency, interval }` on 4 of 13 | **no field at all** | `salary { min, max, period, currency }` on 12 of 12 |
| skills or tags | none | none | `tags`, empty on all 12 |
| unknown company | **404** `{"ok":false,"error":"Document not found"}` | **404** `Not Found` | **404** `{"error":"Not Found"}` |
| open positions: none | **200** `[]`, on two instances | not seen | **200** `{"offers":[]}` |

Scope: Lever on the vendor's demo instance (13 postings) plus two live instances
with nothing open; Workable on two live instances, 51 and 89 postings; Recruitee
on one live tenant with 12 and one with none. All three are in `PROVIDERS` as of
this note; the paragraphs below are what the adapter was written against.

What each row costs the adapter, in the order it matters:

- **All three tell "no such company" apart from "this company has nothing
  open".** That is the question the whole walk turns on: a 404 belongs in
  `errors`, a 200 with an empty list is a company that answered. The three
  current providers answer 404, 404 and a 302 to marketing; these three are 404
  with a body, and the empty case is a plain empty list.
- **Lever is the first provider that can fill `salaryMinUsd` honestly.** It is
  the only one measured here that names a currency AND a period beside the
  amount — `currency: "USD"`, `interval: "per-year-salary"`. Recruitee names both
  too, but the figure was monthly and in euro on all 12, so it stays a label.
  Workable publishes no compensation at all.
- **Lever leaves the body off a third of its records** — 4 of 13 carried no
  `descriptionPlain`. A silent signal there means "nothing to read", not "no
  requirement", and the answer must not let those look alike.
- **A Recruitee link leaves `recruitee.com` entirely.** Both `careers_url` and
  `careers_apply_url` were on the company's own domain on 12 of 12. Inside this
  source `applyAtEmployer` is `true` by construction, so nothing breaks — but the
  host is not the evidence here, and `_shared/apply-link.mjs` would call that
  domain an employer careers page only if it happens to start with `jobs.` or
  `careers.`.
- **Recruitee's date is not ISO.** `2026-08-19 13:55:09 UTC` — the first ten
  characters are the date, and the rest has to be dropped rather than parsed.
- **Workable answers big.** 644 KB for 89 postings and 296 KB for 51, in one
  request, and `details=true` is what carries the bodies. One request per company
  either way, but the bytes are a different order from the three current
  providers.
- **`robots.txt`**: Lever `Allow: /` with `Crawl-delay: 1`. Workable allows
  everything, and states `Content-Signal: search=yes, ai-input=yes, ai-train=no`
  — reading a posting to answer a person's question is the `ai-input` it permits.
  A Recruitee tenant redirects `/robots.txt` to the company's own careers domain,
  where `/api/offers/` is not disallowed.

Still unmeasured on these three: whether Lever's default caps a large instance
(the demo has 13 postings, so `limit` was never forced); a second populated Lever
instance, so the record shape rests on the vendor's demo; Workable's empty-list
case; and the rate limit of all three.

## Teamtailor, measured 2026-09-11 — and the two measurements that removed code

The seventh provider is the first that does not answer JSON:

    GET https://<careers-host>/jobs.rss?per_page=200

`<careers-host>` is `<slug>.teamtailor.com`, or the company's own domain where it
points one at the provider. **Both spellings answer**, so a watchlist entry may
carry either and the adapter takes a slug with a dot in it as the host itself.

| | Teamtailor |
|---|---|
| envelope | RSS 2.0, `xmlns:tt`; the channel's `<title>` is the COMPANY |
| total | none — the feed's own item count |
| paging | `per_page` accepted; never exercised past 17 items, so the documented default of 100 is **unverified** |
| identity | `<guid>`, a UUID, and NOT the link |
| link | absolute, on the careers host — the company's own domain on one of the two instances |
| publication date | `<pubDate>`, RFC 822 with an offset, 28 of 28 |
| posting body | `<description>`, HTML escaped as entities inside the XML text, 28 of 28 |
| work mode | `<remoteStatus>`, unprefixed beside the namespaced `tt:` fields: `fully`, `hybrid`, `none` |
| location | `tt:city`, `tt:country`, and a nested `tt:location` this adapter does not read |
| salary | none |
| unknown instance | **404**, with an HTML body |

Scope: two live instances, 11 and 17 postings.

Two measurements each deleted a knob that was about to be written:

- **`accept: application/json` is ignored** — the feed answers `application/rss+xml`
  regardless. So no per-provider `accept` header exists: the adapter sends what
  it has always sent.
- **A company on its own careers domain is still answered at the provider host,
  with no redirect.** That mattered more than it sounds: `redirect: 'manual'` is
  how an unknown BambooHR instance is told apart from an empty one, and a
  Teamtailor instance that 301'd to a custom domain would have been reported as
  "no such company" for every employer who owns their careers URL. Measured 200
  at both hosts, directly.

`none` in `remoteStatus` becomes **no claim**, not `onsite`. The feed states
there is no remote work; that a job is therefore in an office is a derivation,
and derivations are what `locationVerified: false` exists to refuse.

The XML itself is read by `_shared/xml.mjs`, which is a feed reader and not a
parser — what it deliberately cannot do is listed in its own header. CDATA is
unwrapped there even though neither measured feed uses it: a title handed back as
`<![CDATA[...]]>` would go into a dedup key and match nothing, in silence.

## Personio: deferred, and why that is the finding

Personio publishes the same kind of per-company XML —
`https://<slug>.jobs.personio.de/xml?language=en` — and **its feed carries no URL
for the posting.** The vacancy page has to be assembled from the id by the
vendor's convention.

That is not a cost to weigh against the work; it is a different kind of risk.
Every other provider here hands over a link the employer published. A constructed
link that is wrong does not fail loudly — it produces a record carrying
`applyAtEmployer: true`, which is the single promise this source exists to make,
pointing at a 404. A provider without a link is worse than no provider.

So it waits for two live instances where the convention is confirmed, found the
honest way described above rather than by probing slugs. If two cannot be found
in a reasonable number of tries, that is a refusal to record in
[sources-not-taken.md](sources-not-taken.md) beside Remotive — an answer, not a
failure.

## The signals, and why they live here

The three things a human currently opens a posting to read — a work
authorisation requirement, an office-presence requirement, and which backend
language the requirements actually name — are only in the posting's own text. So
the signals are raised wherever there is text: here, on the two providers of
three that publish a body, and on AgileFluent, which summarises every posting.

The difference between the two is worth keeping in view. An employer publishes
the posting; a board summarises it, and a summary keeps an office requirement and
drops a legal notice — measured, 0 work-authorisation hits over 150 AgileFluent
records. See [agilefluent.md](agilefluent.md).

Which phrases and which languages matter is configured in the profile, because
that is the reader's own business. What is NOT configured is the grammar, because that
is the part a title and a tag list get wrong:

| raises it | does not |
|---|---|
| `This is a hybrid role based in Warsaw` | `An office in Lisbon is available and coming in is optional` |
| `Two days per week in the office is expected` | `We hire from Portugal, Spain and Poland` |
| `Strong production experience in Go is required` | `You will work with Go and/or Node.js` |

Nothing is dropped for a signal. The finding carries the sentence it was found
in, and the decision stays with the person reading it.

What each rule costs, on 276 postings from these two providers and on 200 from a
board, is in [signals.md](signals.md) — along with the two defects a live run
found in it.

## What is still unmeasured

Whether any of the seven rate limits an anonymous reader, and at what. A
watchlist read is one request per company rather than a walk, so the totals are
small — but small is not the same as measured, and the pace is set at the public
boards' rather than at what these hosts would tolerate.

What a LARGE instance does, on every provider that states no total: none of them
pages, so a company with a thousand postings either sends all of them or sends
some of them, and nothing measured so far says which. The largest instance read
here had 89. Teamtailor's `per_page` is the one parameter that would answer it,
and it was accepted without ever being needed.

## One bad slug used to end the whole run

`get()` throws on 404 and on a redirect, and the walk had no `catch`. A watchlist
is a list of *independent* employers, so a slug that has gone stale says nothing
about the next one — but the first failure discarded every company already read
and never reached the rest. A company that renames its board instance takes the
source down until somebody edits the profile.

Now a failure costs only its own company: it lands in `errors: [{provider, slug,
message}]`, `found` counts the companies that answered, `companies` lists them,
and `complete` is false while any of them failed.

## The window walks itself

`slice(0, maxCompanies)` always read the same head. One call fits eight to ten
companies inside a 60-second client timeout, so on a longer watchlist the tail
was reachable only by reordering the profile and restarting.

The store now keeps `ats_reads(provider, slug, read_at)` and each call reads the
`pages` companies **read longest ago**, never-read first, ties in profile order.
A fresh watchlist walks top to bottom; after that every call moves the window
itself and the order in the profile stops mattering. Companies are stamped
whether or not they answered, so a slug that 404s every time cannot hold the
window still.

`watchlist: { size, read }` says how much of the list this call covered.

## `since`, applied here because no provider offers it

Greenhouse states `first_published` and Ashby `publishedAt`; BambooHR's list
states no date at all. So the cut is local: `dateFiltered` counts what it
dropped, and a posting with **no** date is kept and counted in `undated` rather
than dropped on a guess.
