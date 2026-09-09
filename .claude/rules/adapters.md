---
paths:
  - "adapters/**"
  - "params.mjs"
  - "server.mjs"
---

# Adapters

**An adapter translates one board into the shared shape. That is its whole job.** Throttling,
user agents, headers, request counting, guards, text normalisation and shape validation are
not board-specific and do not belong in it.

The shape every adapter returns:

```js
{ id, source, company, title, url, applyAtEmployer, country, locationVerified,
  format, salaryLabel, salaryMinUsd, skills: [], hasRussianRoots, visa, date }
```

`id` carries a source prefix for every source except AgileFluent (`tm:`, `w3:`, `sol:`,
`hc:`, and `ats:<provider>:<company>:`).
AgileFluent ids stay bare: the store already holds them as plain numbers with statuses
attached, and prefixing would orphan every mark. A bare number can never equal `tm:...`, so
they cannot collide.

`applyAtEmployer` is `true` when the url opens the employer's own application, `false` when
it reaches the board and stops there, and `null` where nobody has classified that board's
links. A link is never substituted for another. `locationVerified` is `false` everywhere:
place and work mode are copied from the board and nothing is derived from them.

**What to search for is configuration, not code.** Roles, grades, relocation countries, tag
vocabularies and board taxonomy ids live in `profiles.json` (gitignored;
`profiles.example.json` ships). Nothing personal to one search belongs in the adapters, in
`params.mjs` or in `README.md` — the repo is a general tool, and a hard-coded stack is how
it stops being one.

## What the boards have already taught us

Each cost a debugging session. The measurements behind them are in `notes/`.

- **Boards fail silently in different ways, and tolerance is per parameter.** An unknown
  parameter *name* is accepted and dropped, and the answer is the unfiltered total. An
  unknown *value* is refused loudly on one parameter and answered with a silent zero on the
  next one of the same board. An unknown value *inside a comma list* is dropped without a
  word on one board and refused on another. Never infer one parameter's tolerance from its
  neighbour, or one board's from another: validate locally what a board accepts quietly
- **Take API parameter names from `data-param`, never from `name`.** Both sit on the same
  element; the API reads the first
- **A match is not an assertion.** A word found in a posting's text says nothing until
  something governs it and its polarity is read: `hybrid` described a portfolio, and
  `visa sponsorship` was found inside "no visa sponsorship". Both were live, both flagged
  the opposite of the truth. The vocabulary is the user's; the grammar is ours —
  `notes/signals.md`
- **A filter on a field the board leaves empty is a silent cut.** One board sets `role` on
  about half its postings and `grade` on two thirds, so filtering on either discards the
  rest before anything else runs, and the answer looks like a market. Measure the coverage
  of a field before filtering on it, and say so where a caller will read it
- **A category is not a partition.** A negative result inside one category says nothing
  about the board — a posting whose subject is plainly crypto has been found in `dev` and
  not in `crypto`. When reporting an absence, name the scope
- **Guard every silent success.** Zero parsed while the envelope reports results: throw. A
  page that starts where the previous one started: throw. Both happened, and the second was
  hidden by dedup
- **A number without its conditions is not usable.** `verified` vs `estimated` salary stays
  in the label because a site estimate is not an offer, and a figure whose currency or
  period the board did not state never enters a field named after one
- **Generalising from one sample has failed three times here.** One category, one match, one
  board state. Measure a second case before writing a rule

## The two things still copied per adapter

| duplicated six times | would belong in |
|---|---|
| the `get`/`post` wrapper: count the request, call fetch, classify the status, throw with the source's context | `_shared/http.mjs` |
| the page loop: fetch, parse, guard, accumulate, throttle | `_shared/paginate.mjs` |

Neither is a mechanical copy: statuses differ per source, and each loop stops on a
different signal — `hasMore`, `max_pages`, an empty page, a `count`, `meta.totalPages`, the
end of a watchlist. One board answers **404 past its last page** where the others answer an
empty list, and the watchlist reads one company per request and does not page at all.

**Recorded, and not to be refactored** — see the root `CLAUDE.md`.
