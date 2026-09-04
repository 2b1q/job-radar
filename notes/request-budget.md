# The request budget

Why every run counts its own HTTP requests. Back to the [README](../README.md).

## What is metered is the total, not the rate

Throttling with jitter bounds the *rate*. Nothing bounded the *total*, and the
total is what a board meters: roughly thirty requests in an hour while mapping
the filters was enough to start collecting `401 rest_forbidden` on categories
that had answered anonymously minutes earlier.

So each run records how many HTTP requests it cost, in `runs.requests`, and
`stats()` reports the last 24 hours per source:

    "requestsLast24h": [{ "source": "af", "runs": 6, "requests": 2, "unrecorded": 5 }]

`unrecorded` travels with the sum deliberately. Runs written before the column
existed hold NULL, and folding those into zero would present an incomplete total
as a complete one — 2 read as the whole budget when five runs simply were not
counted.

This does not explain what the board limits on, and it is not meant to. It turns
an invisible budget into a measured one, which is what was missing when thirty
requests exhausted it without anybody noticing.

## What the board has actually done, twice

| session | requests | outcome |
|---|---|---|
| mapping the filters | ~30 in an hour | **401 `rest_forbidden`**, on categories that had answered anonymously minutes earlier |
| measuring truncation and re-running vectors | ~150 | no refusal at any point |

Two observations, and they disagree. No rule is drawn from them: what the board
meters, over what window, and whether the account changes it are all unknown. The
pace is set by the worse of the two anyway, because the account behind this board
is paid for by the user and losing it costs more than any answer is worth.

Current timings, and the ceiling:

| | throttle | jitter | why |
|---|---|---|---|
| `tm` | 5000 ms | 4000 ms | the paid session lives here |
| `af` | 3500 ms | 2500 ms | |
| `w3` | 3500 ms | 2500 ms | |

`MAX_REQUESTS_PER_CALL = 40` bounds one tool call across every page, slug lookup
and enrichment it makes. Hitting it **throws**: a call that returns what it
managed to collect looks like an answer, and a short answer that looks whole is
how "the niche is empty" gets read off a run that simply stopped.
