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
five were inspected: four carry neither word in their title or their description,
and the titles are `Full Stack Engineer`, `Fullstack Engineer`,
`Computer Scientist I (Full Stack Growth Engineer)`. Whatever it is — the store
backup left beside this work is named `pre-vectors` — it retrieves by meaning
rather than by string, which also explains why `backend node.js` (111) and
`node.js backend` (60) differ without either being a phrase.

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

A profile's own list was bisected the same way: four of its six values answered
200 and two answered 500, which is what had killed every preset at once. The two
are not reproduced here — they are somebody's search, and the board fact is the
one above: **some role strings crash this endpoint and the board says which only
by falling over.**

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

Whether `grades: ["principal"]` still crashes. The schema now lists it as a legal
value, and the comment in the adapter saying it returns 500 predates that; it has
not been re-measured.
