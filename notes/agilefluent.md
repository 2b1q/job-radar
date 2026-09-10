# AgileFluent

Back to the [README](../README.md).

## `salaryMinUsd` is the posting's minimum, not a dollar figure

The board fills one numeric field for every posting and states the currency only
in the label beside it. Counted over the 284 rows one store held, the labels use
**eleven** currency markers:

| marker | distinct labels |
|---|---|
| `$` | 46 |
| `€` | 10 |
| `PLN` | 5 |
| `RUB` | 4 |
| `CAD` | 3 |
| `GBP`, `JPY` | 2 each |
| `INR`, `SGD`, `PEN`, `BYR` | 1 each |

The shape is `<marker><min>–<max>k / <period>`, and `Не указана` where the
posting states nothing.

The measured case: `26090315`, label `JPY8000–16000k / год`, `salaryMinUsd`
**8000000**. `jobs_search` sorts descending on that field, so a yen figure sits
above every dollar salary on the board — and 8 000 000 of anything reads as an
outlier worth opening.

The board is not converting and is not wrong about its own posting: it is
reporting the minimum in the currency the employer quoted. The field name is what
makes it a defect downstream.

**So the label decides.** A figure survives into `salaryMinUsd` only where the
label opens with `$` or `USD`; anything else — including a label the board did
not send at all — leaves the field null and the label carrying the number in the
currency it was written in. Nothing is converted: that rule was never the one
being broken, and a rate-converted figure is the number somebody quotes back six
months later.

The other two adapters already worked this way. TalentMove quotes monthly roubles
and leaves the field null; web3.career fills it only when `baseSalary.currency`
is USD. Two adapters agreeing and a third disagreeing about what one field name
means is worse than any of the three answers.

## `searchQuery` is not a phrase — the first reading was wrong

An earlier note here concluded that this board matched an ordered phrase, and the
adapter refused a multi-word query on the strength of it. **Both were wrong, and
the mistake was in how the measurement was taken:** every number came from a
query sent *inside a preset*, so what was being measured was the intersection.

Measured again, 2026-09-09, the same queries with nothing else in `filters` and
then with `ruroots + month` beside them:

| query | alone | with the preset |
|---|---|---|
| *(none)* | 456071 | 1982 |
| `backend` | 17273 | 298 |
| `node` | 2038 | 23 |
| `node.js` | 4048 | 57 |
| `nodejs` | 704 | 8 |
| `js` | 1052 | 13 |
| `node js` | 115 | **0** |
| `backend node` | 6 | **0** |
| `nodejs backend` | 10 | **0** |
| `backend nodejs` | 10 | **0** |
| `backend node.js` | 111 | 6 |
| `node.js backend` | 60 | 2 |

`nodejs backend` and `backend nodejs` both answer **10**, which an ordered phrase
cannot do. Every zero is in the right-hand column. The board was answering all
along; the preset was removing the answers.

**It is not a literal match either.** Of the six records `backend node` returns,
five were inspected: four carry neither word in their title or their
description, and the titles they do carry are full-stack ones. Whatever the
board is doing, it retrieves by meaning rather than by string — which is also why
`backend node.js` (111) and `node.js backend` (60) differ without either being a
phrase.

So the local refusal is gone. **Refusing a query the board answers is worse than
the silent zero it was meant to prevent:** a zero is visible in the number, while
a refusal reads as a property of the board.

## `roles` crashes one endpoint, and only one

The whole source was dead: every preset answered `/jobs/count -> HTTP 500`,
including `anywhere`, which barely filters. Bisected field by field with
identical headers, 2026-09-09:

| filter | result |
|---|---|
| `{}`, `searchQuery`, `since`, `grades`, `countries_workplaces`, `isRussianRootsOnly`, `isRemoteAnywhereOnly`, `salary_min` | 200 |
| `roles: []` | 200 |
| `roles: ["backend"]`, `["Backend"]`, `[""]` | **500**, an HTML page |
| `roles: "backend"` (a string, not a list) | **500** |
| `role: [...]` (misspelt name) | 200, unfiltered — an unknown NAME is still dropped in silence |

A list of six ordinary role titles was bisected the same way: four answered 200
and two answered 500, which is enough to kill every preset at once, because
`roles` goes into every request. **Some role strings crash this endpoint, and the
board says which only by falling over.**

### The valid values are recoverable, from the answers rather than the schema

The board publishes no list, but every record carries a `role`, and that field is
the accepted title **lowercased with only the FIRST space turned into `_`**.
Harvested over 200 records, 48 distinct values, and the mangling shows itself
wherever a title runs past two words:

    software_architect        head_of marketing         full_stack engineer
    site_reliability engineer (sre)                     data_engineer
    senior_/ group product manager                      typescript_developer

So the derivation runs backwards: first `_` to a space, restore the casing.
Twelve values derived that way were tried and **twelve answered 200**:

| derived from | value sent | count |
|---|---|---|
| `software_engineer` | `Software Engineer` | 9431 |
| `full_stack engineer` | `Full Stack Engineer` | 6065 |
| `data_engineer` | `Data Engineer` | 5321 |
| `backend_engineer` | `Backend Engineer` | 3164 |
| `devops_engineer` | `DevOps Engineer` | 2650 |
| `site_reliability engineer (sre)` | `Site Reliability Engineer (SRE)` | 1040 |
| `cloud_architect` | `Cloud Architect` | 476 |
| `typescript_developer` | `TypeScript Developer` | 8 |

**The comparison is exact.** Same value, four spellings, all 500:

| sent | result |
|---|---|
| `Backend Engineer` | 200, 3164 |
| `backend engineer` | 500 |
| `BACKEND ENGINEER` | 500 |
| `Backend  Engineer` (two spaces) | 500 |
| `" Backend Engineer"` (leading space) | 500 |

A snake_case value is not accepted either — `solution_architect`,
`founding_engineer` and friends all 500. The response field only *looks* like an
internal id; it is a mangled display title, and the filter wants the title.

### `roles` silently loses half the board

`role` came back as **`unknown` on 108 of 200** sampled records. The field is
optional and most of the corpus has no role assigned at all, so **any non-empty
`roles` discards more than half of the board before any other filter runs** —
without saying so, because there is nothing in the answer to say it with.

That is not a bug to fix. It is a property of the source, and it is why the tool
description names it: the next person to see a `roles` field will fill it in.

## `grades` is the same filter with the same hole

Asked the same way. The schema declares a closed enum — `intern, junior, middle,
senior, lead, principal` — and one of the six still crashes:

| filters | result |
|---|---|
| `grades: ["intern"]` | 200, 15700 |
| `grades: ["junior"]` | 200, 35560 |
| `grades: ["middle"]` | 200, 100155 |
| `grades: ["senior"]` | 200, 125851 |
| `grades: ["lead"]` | 200, 29446 |
| `grades: ["principal"]` | **500** |

`principal` is in the board's own schema and crashes anyway — the same shape as
`roles`, where the schema is not what the query can survive.

The coverage question has a cleaner answer here than for roles, because the enum
is closed and the union can be asked for directly:

| | records | share of the board |
|---|---|---|
| whole board | 456811 | 100% |
| the five grades that answer, as a union | 306707 | 67% |
| **carrying none of them** | **150104** | **33%** |
| `grades: ["senior","lead"]` | 155296 | 34% |

And the `grade` field over the same 200 records: `unknown` **100**, senior 44,
middle 15, junior 14, director 8, lead 5, head 5, intern 4, c-level 4, vp 1.

Two things in that line. Half the sample has no grade — the same hole as `roles`.
And `director`, `head`, `c-level` and `vp` are values the field carries that the
filter enum cannot express, so those records are unreachable through `grades` no
matter what is asked for.

**So both filters cut silently, and they cut different thirds.** Sent together
they compose, and the answer looks like a market rather than like a filter.

The board's own filter schema declares `roles` as `z.array(z.string())` with **no
vocabulary at all**, so this is not a refusal — the value passes validation and
the query behind it falls over. There is no list to check against locally, and
the board publishes none.

**The endpoints disagree.** The same body that answers 500 from `/jobs/count`
answers 200 from `/jobs/search`:

| filters | `/jobs/count` | `/jobs/search` |
|---|---|---|
| `roles: ["backend"]` | 500 | 200, 5 records |
| `roles: ["Backend"]` | 500 | 200, 5 records |
| one crashing value beside one working value | 500 | 200, 5 records |

That is why `search` no longer dies when `count` does: the source was fully
healthy on the endpoint that returns the jobs, and the coupling introduced for
`found` was killing it. The total is reported as `null` with `foundUnavailable`
carrying the reason.

## Nothing is wrong with the headers, and no cookie is needed

The working request that was reported alongside the bug carried a browser set
including a DDoS-Guard `__ddg1_` cookie, so the transport was suspected too.
Measured by removing one header at a time from a body known to work:

| request | result |
|---|---|
| full browser set | 200 |
| no `Origin` / no `Referer` / neither | 200 |
| no `User-Agent` | 200 |
| no `Accept` | 200 |
| `Content-Type` alone | 200 |
| the adapter's own rotating UA, five draws | 200 × 5 |

**No cookie was sent in any of them.** The `__ddg1_` cookie is set by a browser
session and is not required; nothing needs to move to the environment, and there
is no new secret to configure.

## What the record carries, and what the adapter reads

Measured over 150 records:

| field | presence | used |
|---|---|---|
| `description` | 150/150, 192–928 chars, median 486 | **yes, since this change** |
| `badges` | 5/50 sampled, `{label, type}` | no — see below |
| `skills` | 0/150 | already known empty |
| `role`, `grade`, `city`, `industry`, `englishLevel`, `language`, `isReferral` | present | no |

**`description` corrects a claim made elsewhere in this repository** — that
signals can only be raised where the source publishes a posting body, "which
today is `ats`". This board publishes one for every record. Asked for
`onsite`, a work-authorisation phrase and five backend languages, signals fire on
**30 of 150**: `onsite` 28, a language 2, work authorisation 0.

The zero is the caveat worth keeping: this is the board's *summary*, not the
employer's text, so boilerplate-shaped signals — the E-Verify notice is the
example — will never appear in it. An office requirement survives summarising;
a legal notice does not.

**`badges` are not worth reading.** The vocabulary seen over 50 records is
`visa`, `referral` and `remote_anywhere`, and it is not established as complete.
Two of the three duplicate flat fields the adapter already reads (`visa`,
`isReferral`); the third, `remote_anywhere`, is the only new bit and the board
also exposes it as a filter. Not enough to add a field for.

## What is still unmeasured

Whether the board ever sends a figure with no label at all. None of the 284 rows
did — every one carried a label, `Не указана` included — so the case is handled
(no label is no currency, so no figure) rather than observed.

What `searchQuery` actually matches on. It is not a phrase and not a literal
term; beyond that this note only knows what it is *not*. Whether `roles` has any
working values outside the four the profile happens to hold, and whether the
board would publish them, is also unknown — the schema imposes no vocabulary, so
there is nothing to read.

Whether the 48 role ids seen over 200 records are the whole vocabulary. They are
what a sample of the corpus happened to carry, and the derivation was confirmed
on twelve of them; a value the sample missed can still only be found by trying it.

Whether `roles` and `grades` drop the same records or different ones. Each was
measured against the whole board, never against the other.

## The links were classified all along, just not by us

Every record arrived as `applyAtEmployer: null` — "nobody checked" — while the
`url` field mostly pointed straight at an applicant tracking system. Counted over
the 384 stored rows from this board:

| where the link goes | rows |
|---|---|
| an ATS host (Lever 37, Ashby 30, Greenhouse 33, SmartRecruiters 5) | 116 |
| a company careers subdomain | 6 |
| an aggregator (LinkedIn 192, hh.ru 20, this repo's other boards 12) | 226 |
| nothing the host settles — a messenger link, a plain domain | 36 |

A hostname is evidence, not proof, so the answer has three values and the last
group stays `null`. The rule is in `adapters/_shared/apply-link.mjs`; aggregators
are checked before the `careers.`/`jobs.` shape, so `jobs.linkedin.com` stays
false.

Backfilled over the stored rows as well, because rows already collected are
`seen` and would never be read again: **this board went from 4 rows with a
recorded way in to 117**, and 349 across all sources. Derived rather than
stated, so those rows carry `apply_from = 'host'`.

## `preset: remote` is not strict

Measured on one page of 50 under `countries_workplaces: [{workplaces:
['remote']}]`, `since: month`: **48 remote and 2 hybrid**. The board's own
workplace filter admits hybrid postings, so `format` is worth reading even when
the preset says remote. Not corrected here — the field is what the board said.
