# The employer watchlist

Back to the [README](../README.md).

Every job board in this repository was measured on one question — does its apply
link reach the employer, or only the board — and the boards added for coverage
all answer *no* (see [habrcareer.md](habrcareer.md)). The place where the answer
is *yes* is not a board at all: it is the employer's own applicant tracking
system, and three of the common ones publish an unauthenticated list per company.

    GET https://boards-api.greenhouse.io/v1/boards/<slug>/jobs?content=true
    GET https://api.ashbyhq.com/posting-api/job-board/<slug>?includeCompensation=true
    GET https://<slug>.bamboohr.com/careers/list

`applyAtEmployer` is `true` for every record from all three, and it is not a
courtesy: the url addresses the company's own instance.

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

Whether any of the three rate limits an anonymous reader, and at what. A
watchlist read is one request per company rather than a walk, so the totals are
small — but small is not the same as measured, and the pace is set at the public
boards' rather than at what these hosts would tolerate.
