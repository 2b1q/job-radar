# Claude Project Guide — job-radar

## What this repo is

MCP server over several job boards. Three adapters (AgileFluent, TalentMove, web3.career),
one shared dedup store, stdio protocol glue. Node 22.5+, no build step, no TypeScript,
`node:sqlite` for state. Package manager: **pnpm**.

The responsibility of this repo is not "talk to a board". It is **find what has not been seen
and remember what was done with it**. The store is the core; adapters are replaceable.

## Key principles

- DRY, KISS, YAGNI, SRP. SOLID where it improves boundaries and testability
- Make every change as small as possible; touch only what the task needs
- No dead code, no speculative abstractions, no temporary fixes
- Prefer an existing repo pattern over a new one
- Do not refactor or reformat outside the task scope

## Commands

| Task | Command |
|---|---|
| Install | `pnpm install` |
| Run MCP | `node --experimental-sqlite server.mjs` |
| Tests | `pnpm test` (`node --test`; the flag is in `package.json`) |
| Smoke, one board | `node smoke.mjs af` · `TM_COOKIE=... node smoke.mjs tm` · `node smoke.mjs w3` |
| Store state | `node --experimental-sqlite -e "import('./store.mjs').then(s=>console.log(s.stats()))"` |

Check `package.json` before guessing a command. Run tests only when asked.

## Not this repo's business

What to search for is configuration. Roles, grades, relocation countries, tag
vocabularies and board taxonomy ids live in `profiles.json` (gitignored;
`profiles.example.json` ships). Nothing personal to one search belongs in the
adapters, in `params.mjs` or in `README.md` — the repo is a general tool, and a
hard-coded stack is how it stops being one.

The same line runs through the prose. A measurement about a board is knowledge and
stays: *`tm:262185` carries the tag on its card and on its page, yet `skills=ai` does
not return it.* A fact about one person's search is not and goes: which vacancy was a
priority, what was applied to and when, which countries someone would move to. The id
in the first sentence is evidence for a claim about the board; the same id in a
shortlist is somebody's private business.

**This is verified by running, not by reading.** Copy what `git status --porcelain
-uall` lists into an empty directory — no `profiles.json`, no store, no
`node_modules` — then install, run the tests, and start the server there. Tests that
need the personal config, or a server that answers emptily without it instead of
saying what to copy from `profiles.example.json`, are the defect. Finish with a grep
for the owner's own vocabulary: names, employers, cities, the companies from a live
search. Expected empty; report whatever is not.

## Architecture

```
server.mjs        protocol glue only. Adding a board = one line in SOURCES
params.mjs        query -> board parameters, plus local validation of values the board accepts silently
adapters/*.mjs    ONE board each: its transport dialect and its parsing. Nothing else
adapters/_shared/ everything every adapter needs and none of them owns
store.mjs         SQLite: seen ids, dup_key, statuses, run log, request budget
```

**An adapter translates one board into the shared shape. That is its whole job.** Throttling,
user agents, headers, request counting, guards, text normalisation and shape validation are not
board-specific and do not belong in it.

### The shape every adapter returns

```js
{ id, source, company, title, url, country, format,
  salaryLabel, salaryMinUsd, skills: [], hasRussianRoots, visa, date }
```

`id` carries a source prefix for every board except AgileFluent (`tm:`, `w3:`). AgileFluent ids stay
bare: the store holds 284 rows keyed by the plain number with statuses attached, and prefixing them
would orphan every mark. A bare number can never equal `tm:...`, so they cannot collide.

## DRY: what must move to `_shared`

Today all three adapters carry their own copy of the same code. That is the standing debt:

| duplicated now | belongs in |
|---|---|
| `THROTTLE_MS`, `JITTER_MS`, `sleep`, `throttle` | `_shared/http.mjs` |
| `UA_POOL` / `USER_AGENTS`, `pick`, `browserHeaders` | `_shared/http.mjs` |
| `requests` counter and `requestCount()` | `_shared/http.mjs` |
| `get` / `post` wrappers and status classification | `_shared/http.mjs` |
| `strip`, `decode`, HTML entity handling | `_shared/text.mjs` |
| `tagKey`, `titleKey`, and the store's dup-key normaliser | `_shared/text.mjs`, **one** `normKey` |
| zero-parse guard, page-repeat guard | `_shared/guards.mjs` |
| the page loop: fetch, parse, guard, throttle | `_shared/paginate.mjs` |

**`normKey` is the urgent one.** Three implementations of "normalise a string for comparison" exist:
tag matching, title matching, and `dup_key`. If they drift, dedup stops matching and says nothing.
Silent divergence, which is the failure class this repo keeps finding.

Rule going forward: a third adapter needing something means it was never adapter-specific.
Two copies are a smell, three are a defect.

## Hard-won rules — do not rediscover these

Each cost a debugging session. `README.md` holds the measurements.

- **Boards fail silently in different ways, and tolerance is per parameter.** An unknown parameter
  *name* is accepted and dropped (full result set). An unknown single *value* returns zero. An unknown
  value *inside a comma list* is dropped silently. `date` accepts a plausible typo and returns
  everything. Never infer one parameter's tolerance from its neighbour: validate locally what the
  board accepts quietly
- **Take API parameter names from `data-param`, never from `name`.** Both sit on the same element;
  the API reads the first
- **A category is not a partition.** A negative result inside one category says nothing about the
  board — a posting whose subject is plainly crypto has been found in `dev` and not in `crypto`.
  When reporting an absence, name the scope
- **Guard every silent success.** Zero parsed while the envelope reports results: throw. A page that
  starts where the previous one started: throw. Both happened, and the second was hidden by dedup
- **A number without its conditions is not usable.** `verified` vs `estimated` salary is kept in the
  label because a site estimate is not an offer, and `verified` has been wrong (three 68K outliers)
- **Generalising from one sample has failed three times here.** One category, one match, one board
  state. Measure a second case before writing a rule

## Conventions

- **The repository is English, end to end.** Code, comments, identifiers, log
  messages, docs, config examples and commit messages. The boards it reads are
  not, and neither is the user; the repository that serves them is. Reproduce a
  non-English string only where it must be verbatim — a tag value, a probe query,
  a sample chunk — and quote it as data rather than writing prose around it
- Comments and identifiers in **English**. Comments only where the code is not self-evident, and only
  the non-obvious *why* — never a retelling of *what*. One or two lines, no essays
- Functions do one thing, named by intent; prefer early returns over nesting
- `Set`/`Map` for membership, not repeated `.find()`
- Exported constants for domain values, not raw string literals
- Validate at the boundary (zod in `server.mjs`), keep parsing pure and testable
- Parsing functions must be importable without side effects. `server.mjs` starts a stdio transport on
  import, so anything a test needs lives outside it — that is why `params.mjs` exists
- Never swallow an error: rethrow with the request context (board, category, page)

## Documentation: three files, three jobs

- **`README.md`** — for someone who has never seen the repository. What it is, how to
  install and configure it, the tools it exposes, the shared shape, the dedup rule,
  known limits. Nothing else. Roughly a hundred lines is the budget, and it is a
  budget, not a target
- **`notes/*.md`** — every measurement, probe, dead end and board quirk, with the
  number and the conditions that produced it. This is where a fact goes when it is
  true but nobody needs it to use the tool
- **`CLAUDE.md`** — how to work in this repository. Not what the tool does

Rules that keep them from merging back together:

- A number belongs in `notes`. A README that quotes a measurement will be wrong within
  a month and nobody will notice
- If a paragraph answers neither "how do I use this" nor "what will break", it is a
  note, not a README section
- Say a thing in one file. A sentence repeated in two drifts into two different claims
- No project history, no rationale essays, no selling the tool to its reader

## Testing

- Offline: fixtures only, no network in tests
- Fixtures are synthetic or sanitised, and declare which they are
- **Every guard is verified by breaking the code it guards, not the fixture.** A test that has never
  failed proves nothing
- A skipped test must be visible: print how many were skipped and why. `OK (skipped=12)` is not `OK`
- Cover the seam, not each side of it: feed one module's output straight into its consumer

## Security

- `TM_COOKIE` is a live account session, not a setting. Environment only, never the repository
- Never commit `.env`, `*_TOKEN`, `*_SECRET`, `*_COOKIE`, `*.db`, `*.bak`
- Before staging: `git status --porcelain -uall` and read it

## Do not break

- **renaming the project renames nothing that holds state outside the repo.** The store file
  stays `jobs.db`: it holds the search history, statuses included, and a new filename is an
  empty database rather than a migration - the same class of loss as prefixing AgileFluent ids
- **the tools stay `jobs_count`, `jobs_search`, `jobs_mark_status`, `jobs_stats`.** Client
  configs and existing skills call them by name; renaming breaks those silently, and the gain
  is cosmetic
- do not prefix AgileFluent ids
- do not give a board its own store: cross-board dedup is the point
- do not convert one currency into another for sorting; an invented number gets quoted later
- do not patch a vendored file; fix it upstream and re-copy

## Git

**The end of a task is a staged working tree, never a commit.** Whoever asked for the work
reviews it and commits it themselves; a commit made for them removes that review.

Order, and none of it is optional:

1. tests pass — `pnpm test`, and say how many ran and how many were skipped
2. `git status --porcelain -uall` and read it, line by line. `-uall` because a directory
   collapses to one line and hides what is inside it
3. scan for what must never be published, and report the scan, not the conclusion:
   credential-shaped strings (cookie, nonce, bearer, key, secret), home directory paths,
   personal names and email addresses, and the store or the personal `profiles.json`
4. only then `git add` the reviewed files, by name — never `git add .`, which stages
   whatever the scan has not seen
5. `git diff --staged`, show it, stop

Do not commit, amend, push, or create a branch unless asked in that message.
