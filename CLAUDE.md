# Claude Project Guide — job-radar

MCP server over several job sources: one adapter each, one shared dedup store, stdio
protocol glue. Which sources, and what each needs, is the table in `README.md`. Node 22.5+,
no build step, no TypeScript, `node:sqlite` for state. Package manager: **pnpm**.

The responsibility of this repo is not "talk to a board". It is **find what has not been
seen and remember what was done with it**. The store is the core; adapters are replaceable.

This file is how to work here. What the tool does is `README.md`; what a board actually did
is `notes/`.

## Commands

| Task | Command |
|---|---|
| Install | `pnpm install` |
| Run MCP | `node --experimental-sqlite server.mjs` |
| Tests | `pnpm test` (`node --test`; the flags are in `package.json`, `--test-timeout` among them - see `.claude/rules/testing.md`) |
| Smoke, one source | `node smoke.mjs af` · `TM_COOKIE=... node smoke.mjs tm [category]` · `node smoke.mjs w3 [tag]` · `node smoke.mjs sol [term]` · `node smoke.mjs hc [term]` · `node smoke.mjs ats` (each falls back to what the profile names for THAT source) |
| Store state | `node --experimental-sqlite -e "import('./store.mjs').then(s=>console.log(s.stats()))"` |

Check `package.json` before guessing a command. Run tests only when asked.

## The map

```
server.mjs        protocol glue only. Adding a board = one line in SOURCES
params.mjs        query -> board parameters, plus local validation of values the board accepts silently
adapters/*.mjs    ONE source each: its transport dialect and its parsing. Nothing else
adapters/_shared/ everything every adapter needs and none of them owns, signals included
store.mjs         SQLite: seen ids, dup_key, derived employer, statuses, run log, request budget
```

## Where the rest of the rules are

Four sets of rules live in `.claude/rules/` and load **only when a matching file is
opened**, which is why this file is short enough to be followed:

| file | loads when you touch | holds |
|---|---|---|
| `testing.md` | `tests/**` | fixtures, guards, the runner's flags |
| `adapters.md` | `adapters/**`, `params.mjs`, `server.mjs` | the shared record shape, id prefixes, what every board has already taught us |
| `documentation.md` | any `*.md`, `profiles.example.json` | which of the three documents a sentence belongs in |
| `releasing.md` | `.claude-plugin/**`, `.mcp.json`, `package.json` | the three version strings and `claude plugin validate` |

Splitting is not free context: a rule with no `paths:` and an `@import` both load at
launch, exactly like this file. Only `paths:` makes a rule lazy, so a rule that belongs to
everything belongs **here** rather than in a file of its own.

**One release rule cannot be lazy**, because it applies while you are changing something
else: *a user gets an update only when the version string changes, so a change that reaches
a user bumps the version in the same commit.* The procedure is in `releasing.md`.

## Invariants — do not break

- **the store file stays `jobs.db`.** It holds the search history, statuses included, and a
  new filename is an empty database rather than a migration
- **the tools stay `jobs_count`, `jobs_search`, `jobs_mark_status`, `jobs_stats`.** Client
  configs and existing skills call them by name; renaming breaks those silently, and the
  gain is cosmetic
- do not prefix AgileFluent ids — the same class of loss, for the reason given above
- do not give a board its own store: cross-board dedup is the point
- do not convert one currency into another for sorting; an invented number gets quoted later
- do not patch a vendored file; fix it upstream and re-copy

## How a task runs

Each step is what makes the next one honest.

1. **Measure before writing.** Reconnaissance first — what a board answers, how it pages,
   which parameters it ignores in silence. Half the work on one board went into finding
   that a parameter was not called what the markup said, and that is worthless once the
   code is written around a guess
2. **Report the findings, then build.** Name what was measured and in what scope. "It
   probably works like the other board" is not a finding
3. **Build the smallest thing that does the job**, touching only what the task needs and
   preferring an existing pattern to a new one. Rules for the code itself:
   [Writing code here](#writing-code-here), `.claude/rules/testing.md`
4. **Verify by running.** "Probably the dry-run flag" is not an answer; a run that produces
   the missing rows is. For a fix, show the number it changed
5. **Review your own diff** — below
6. **Hand it over staged, never committed** — below

Along the way:

- **A live run costs requests and writes to the store.** Count them, record them in
  `notes/request-budget.md`, and copy `jobs.db` to `jobs.db.pre-<what>.bak` first — the
  backup is gitignored, and a store is not something a re-run can rebuild
- **Never rewrite stored data silently.** A row that needs correcting is said out loud, and
  a value derived rather than observed carries a field saying where it came from
- **Finish the whole task.** If one part turns out to be blocked, finish the rest and say
  which part was left and why. Scaling the work down is the asker's call

### Review your own diff

Read it as if somebody else wrote it. Every item below has been caught in review here, and
every one was written by the author of the change:

- **dead exports** — a constant or helper exported and imported nowhere. Either it is used
  or it goes; "somebody might" is how a module grows a public surface nobody maintains
- **a number in two files** — the same measurement in a comment and in `notes/`, already
  disagreeing because the second measurement was bigger than the first. One number, one
  home: `.claude/rules/documentation.md`
- **documentation the change invalidated** — a debt table listing work that is done, a
  README paragraph describing the old shape, a command line that grew an argument
- **scope creep, and its opposite** — a refactor nobody asked for, or a fix that stopped at
  the first of the two places the defect lives
- **the budget** — when a change spends README's, say the new number and what could be cut,
  instead of spending it quietly

Fix what the review finds, re-run the tests, and report what the review changed — including
what the change made worse. A defect the author names is worth more than one the reader
finds.

### What must never be published

Two questions, and the second is the one that gets missed: is it a credential, and is it
somebody's private business?

`TM_COOKIE` is a live account session, not a setting: environment only. `.env`, `*_TOKEN`,
`*_SECRET`, `*_COOKIE`, `*.db` and `*.bak` are never committed.

A measurement about a board stays — *`tm:262185` carries the tag on its card and on its
page, yet `skills=ai` does not return it* — while a fact about one person's search goes.
The id in that sentence is evidence about the board; the same id in a shortlist is somebody
else's business. Hence the practice in tests and notes: **real ids, invented companies**
(`GammaCo`, `DeltaCo`).

Scan before staging, and report the scan, not the conclusion. Every category below has been
found in a diff here at least once:

- credential-shaped strings: cookie, nonce, bearer, key, secret, token
- home directory paths, personal names, email addresses
- employers, cities and salaries from a live run
- what the owner did: applied, when, to which posting, what is on a shortlist. This stays
  out even de-identified — a sentence shaped like "N applications through this board reached
  the employer" states something about a person, not about a board, however good the
  conclusion drawn from it is
- the store, the backups and the personal `profiles.json`: confirm they are *ignored* with
  `git check-ignore -v`, not merely absent from the diff

**Then check the scan by running, not by reading.** Copy what `git status --porcelain -uall`
lists into an empty directory — no `profiles.json`, no store, no `node_modules` — install,
run the tests, start the server. A test that needs the personal config, or a server that
answers emptily instead of naming `profiles.example.json`, is the defect. Finish with a
grep for the owner's own vocabulary — names, employers, cities, the companies from a live
search. Expected empty; report whatever is not.

### Handing it over

**The end of a task is a staged working tree, never a commit.** Whoever asked for the work
reviews it and commits it themselves; a commit made for them removes that review.

Order, and none of it is optional:

1. tests pass — `pnpm test`, reported as `.claude/rules/testing.md` requires
2. `git status --porcelain -uall`, read line by line. `-uall` because a directory collapses
   to one line and hides what is inside it
3. the scan above, reported category by category
4. only then `git add` the reviewed files, by name — never `git add .`, which stages
   whatever the scan has not seen
5. `git diff --staged`, show it, stop

Do not commit, amend, push, or create a branch unless asked in that message.

## Writing code here

- DRY, KISS, YAGNI, SRP. SOLID where it improves boundaries and testability
- No dead code, no speculative abstractions, no temporary fixes
- Functions do one thing, named by intent; prefer early returns over nesting
- `Set`/`Map` for membership, not repeated `.find()`
- Exported constants for domain values, not raw string literals
- Validate at the boundary (zod in `server.mjs`), keep parsing pure and testable
- Parsing must be importable without side effects. `server.mjs` starts a stdio transport on
  import, so anything a test needs lives outside it — that is why `params.mjs` exists
- Never swallow an error: rethrow with the request context (board, category, page)
- **The repository is English, end to end** — code, comments, identifiers, log messages,
  docs, config examples and commit messages. The boards it reads are not, and neither is
  the user; the repository that serves them is. Reproduce a non-English string only where
  it must be verbatim — a tag value, a probe query, a sample chunk — and quote it as data
  rather than writing prose around it
- **Declarative code, thin comments.** A name, a small function or an exported constant
  beats a paragraph explaining a clever line — reach for a comment only after the code
  cannot be made to say it. **Inside a function: one or two lines, three at the ceiling**,
  and only the non-obvious *why*. A comment growing past that is the signal to fix the
  code or move the prose to `notes/`
- **A file header and a doc comment are the exception, and the only one.** Every adapter
  opens with what its board actually answers and what it refuses — the reconnaissance the
  next person would otherwise repeat. Keep the *numbers* out of it: a measurement lives in
  `notes/` and the header points there (see `.claude/rules/documentation.md`)

## Standing debt — recorded, not to be refactored

The `get`/`post` wrapper and the page loop are copied once per adapter, six times each.
`_shared/` holds everything else: throttling, user agents, the request counter,
`strip`/`decode`, `normKey`, both guards and the signal detector.

**This is a decision, not an oversight.** Neither copy is mechanical — statuses differ per
source and every loop stops on a different signal — and rewriting six adapters costs more
than holding it. Do not extract them, and do not re-open it without being asked.
