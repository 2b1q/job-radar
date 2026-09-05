# job-radar — one MCP server over several job boards

Job boards each have their own query language, their own idea of a tag, and their
own way of failing quietly. This puts one MCP interface in front of several of
them and keeps a single store of what has already been seen and what was done
with it.

The store is the core, adapters are replaceable, and what to search for is
configuration: roles, grades, tag vocabularies and board taxonomy ids live in
`profiles.json`, never in the code.

## Tools

| tool | what it does |
|---|---|
| `jobs_count` | how many postings match, without fetching them |
| `jobs_search` | fetch, deduplicate against everything seen before, return the new ones |
| `jobs_mark_status` | record `applied`, `rejected`, `interview`, `skip` or `new`, with a note |
| `jobs_stats` | what the store holds, and what recent runs cost in requests |

## Boards

The code is what you pass as `source` to every tool; the board is what answers.

| code | board | prerequisites | what to expect |
|---|---|---|---|
| `af` | AgileFluent — `jobboard.agilefluent.ru` | none | answers `429` under load; the adapter waits and retries once |
| `tm` | TalentMove — `talent-move.ru` | **paid subscription**, its session cookie in `TM_COOKIE`; without one the board answers `401` | never names the employer: the apply button opens a signup popup and `hiringOrganization` is blank, so the company behind an unnamed posting cannot be reached from here — unless another board republished it, in which case the name is recovered from the store ([notes](notes/dedup.md)) |
| `w3` | web3.career — `web3.career` | none, public | addressed by tag page, and the slugs are not derivable: `/node-jobs` exists, `/nodejs-jobs` and `/node-js-jobs` are 404. `robots.txt` disallows `/metrics*` ([notes](notes/web3career.md)) |

How much a board tolerates being asked is a number, and numbers live in
[notes/request-budget.md](notes/request-budget.md).

Adding a board is one adapter plus one line in `SOURCES`. An adapter translates
one board into the shared shape and does nothing else — throttling, user agents,
request budget, guards and text normalisation live in `adapters/_shared/`.

## Install

    pnpm install
    pnpm test                       # offline, no network, no model
    cp profiles.example.json profiles.json

Node 22.5+ (for `node:sqlite`). The store is created on first run as `jobs.db`
beside the server; `JOBS_DB_PATH` moves it.

Registering the server with an MCP client: [SETUP.md](SETUP.md).

    node --experimental-sqlite server.mjs     # MCP over stdio
    node smoke.mjs af                         # one board, no MCP, no store

## Profiles

`profiles.json` holds named profiles; `active` picks the default and
`JOBS_PROFILE` overrides it for a run. `profiles.example.json` ships three
unrelated examples as a schema.

```json
{
  "active": "dba",
  "profiles": {
    "dba": {
      "roles": ["Database Administrator"],
      "grades": ["middle", "senior"],
      "relocationCountries": ["deu", "nld"],
      "skills": { "default": ["postgresql"], "w3": ["postgres"] },
      "categories": { "data": 38467 },
      "tagGroups": { "rdbms": ["PostgreSQL", "Oracle", "MySQL"] }
    }
  }
}
```

`skills` are board tag slugs, and vocabularies are not portable: the same
technology is spelled differently on each board, and the wrong slug comes back as
zero results or a `/404` page rather than as an error. So they are named per
source, `default` covering the boards without a list of their own; a plain list
still means every board. A board with its own list does not also get the default
— that is what makes a slug sent to the wrong board a refusal at the boundary.

`categories` names board taxonomy ids so a query reads `category: "data"` rather
than a number. `tagGroups` are sets for the intersection filter: a board query
can only *union* tags, so asking for two of them widens the result and an
intersection has to be a second query. Each group is an OR, because one idea is
usually spread over several interchangeable tags.

## What a job looks like

```js
{ id, source, company, title, url, country, format,
  salaryLabel, salaryMinUsd, skills: [], hasRussianRoots, visa, date }
```

Ids carry a source prefix (`tm:`, `w3:`) so two boards cannot collide.
`salaryMinUsd` is filled only where a board states USD; it is never converted.

Boards that know more add fields rather than reshaping the record: TalentMove
adds `salaryKind` (`verified` or `estimated`), `salaryValue` (the figure alone,
in thousands of roubles a month) and `salarySuspect` when a figure claimed to
come from the posting sits far below the rest of its slice; web3.career adds
`salaryEstimated`. The store adds `companyFrom` when it filled in an employer
the board left blank. Treat anything beyond the block above as optional.

## Deduplication

Boards republish the same postings, so a vacancy appears several times unless
something joins them. What a search skipped travels with its answer, under
`skipped`: `seen` is the same board offering an id already stored, `merged`
names each posting that was already there under another board's id. The id catches the same board offering the same posting
again; a normalised `company + title` catches a different board offering it.
Exact match, never fuzzy, and no key at all when the company is missing — a false
merge hides a live vacancy in silence, while a duplicate costs one row somebody
sees and dismisses. A skipped duplicate never touches the row already stored: it
may carry a status set by hand.

No company, no key — which is weakest exactly where a board never names the
employer. So a missing company is read off the row on the other side of the link:
a republished posting carries the original id at the tail of its url. The
recovered name says where it came from, in `company_from`, rather than simply
appearing ([notes](notes/dedup.md)).

## Known limits

- **A listing card is a summary.** Boards truncate the tag list on a card, so a
  match on a card is trustworthy and a miss is not. Narrow with the board's own
  filter wherever it has one.
- **A category is not a partition.** An empty result inside one category says
  nothing about the board.
- **Salaries are not comparable across boards** and are never converted: one
  board quotes monthly roubles, another annual USD, and one of them labels its
  own estimate as if it came from the posting. `salaryMinUsd` holds a figure only
  where the board states USD — a board that fills the same field with yen gets it
  dropped, and the label keeps the number.
- **The total number of requests is what a board meters.** A tool call is capped
  by `MAX_REQUESTS_PER_CALL` and throws when it would return a partial answer.
- **A wrong filter value is usually silent.** Parameters are validated locally
  before they are sent, because the board will not complain.

## Notes

The measurements behind all of the above, per board:
[agilefluent](notes/agilefluent.md) · [talentmove](notes/talentmove.md) ·
[web3career](notes/web3career.md) · [dedup](notes/dedup.md) ·
[request budget](notes/request-budget.md).

## License

MIT — see [LICENSE](LICENSE).
