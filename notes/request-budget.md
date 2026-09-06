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

**A new run may no longer land there.** Three TalentMove runs sat in the log as
`runs 3, requests 0, unrecorded 3` — on the board whose refusal costs a paid
session, and while the day's volume was running closer to that refusal than
usual. The row was written all the same, and the budget it spent was reported as
zero. A run reaches the log only after a board answered it, so the floor is one
request: a count that is missing or zero is the counter failing, not a free run,
and it is refused rather than stored. The check runs before the store is
touched, because failing after `filterFresh` would mark this run's jobs as seen
without ever returning them.

`unrecorded` stays in the report for the rows that predate the column: "not
counted" and "cost nothing" remain different facts.

**What is still invisible: a call that raises.** The run log is written after the
board answers, so a tool call that throws spends its requests and records
nothing. Measured on one ingest: 7 calls, 6 answered and logged 20 requests
between them, and the seventh — a tag the board does not have — spent 1 request
that appears in no run. The budget therefore reads as a lower bound whenever
something failed, and how to log a failed run without making it look like an
empty one is undecided: a run row with zero found is exactly what a quiet day
produces.

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
| `sol` | 3500 ms | 2500 ms | a JSON API with no observed limit, kept at the pace of the other public board rather than at the pace it would tolerate |

### What jobs.solana.com cost to add

76 requests in one afternoon, no refusal at any point — including 39 inside
twenty minutes while the filters were being mapped, which is the window that
exhausted a different board's patience.

| | requests |
|---|---|
| reconnaissance: robots, the page, the API shape, paging edges, filter tolerance | 34 |
| the first ingest: the whole board, 21 pages of 20 | 21 |
| a second read in `dryRun` to classify every record against the store | 21 |

A page is 20 records and `hitsPerPage` is ignored, so a full read is always 21
requests. **That takes about 95 seconds at this pace, and a default MCP client
gives up at 60.** The run still finishes and still lands in the store — the
client simply never sees the answer, which is how one ingest here produced 342
rows and no visible result. Fewer pages per call, or a longer client timeout.

`MAX_REQUESTS_PER_CALL = 40` bounds one tool call across every page, slug lookup
and enrichment it makes. Hitting it **throws**: a call that returns what it
managed to collect looks like an answer, and a short answer that looks whole is
how "the niche is empty" gets read off a run that simply stopped.
