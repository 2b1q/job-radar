# job-radar

Several job boards behind one MCP interface, with a memory of everything it has
already shown you. An MCP server you run yourself; nothing leaves your machine
except the searches, which go to the boards.

## Read this before installing

- **It finds and remembers. It does not apply.** No form is ever submitted for
  you.
- **Most sources do not reach the employer's own application.** `ats` always
  does — it reads the companies you name on their own Greenhouse, Ashby or
  BambooHR — and `sol` does for most of its postings. `tm`, `w3` and `hc` link
  back to themselves; on `af` nobody has classified the links. Every posting
  carries the answer in `applyAtEmployer`, `null` where it is unknown. If
  applying directly is what you came for, that is `ats`; the rest are for finding
  out that a job exists.
- **It keeps a private history.** `jobs.db` records which postings you were
  shown, what you marked applied or rejected, and what you skipped. See
  [Your data](#your-data).
- **Four of six sources need nothing.** `tm` needs a paid account's session
  cookie, `ats` needs you to list the companies. See [The sources](#the-sources).

## Install

As a Claude Code plugin, from this repository as a marketplace:

    /plugin marketplace add 2b1q/job-radar
    /plugin install job-radar@job-radar

Or by hand, as a plain MCP server: [SETUP.md](SETUP.md).

Either way, **two steps are yours**, because installing the plugin clones this
repository and stops there. In the plugin's directory:

    npm install                               # or pnpm; two dependencies
    cp profiles.example.json profiles.json    # the server will not start without it

Node 22.5+ is required, for `node:sqlite`. Skip either step and the server says
which one is missing and exits, rather than starting half-configured.

**The copy works as it is** — the example filters by nothing on purpose, so
every board answers. There is no fallback: without `profiles.json` the server
prints one line naming the template and exits. Fill in what you want when you
want it; the one thing to leave alone at first is `roles` and `grades`, and the
file says why beside them.

## The problem

Every board has its own query language, its own idea of a tag, and its own way of
failing quietly: a filter value nobody validates, an empty page that reads as an
empty market, an apply button that leads back to the board instead of the
employer. Search a few of them by hand and most of what you read today is what you
read yesterday.

## What it does

- **One interface over several boards.** The same four tools and the same answer
  shape, whichever board is answering
- **It remembers.** Every posting it shows you is recorded, so the next search
  returns what is new; a mark of `applied`, `rejected`, `interview` or `skip`
  stays with it
- **It recognises the same job twice.** Boards republish each other's postings
  under their own ids; one already seen does not come back from another, and the
  answer says when that happened
- **It says where an apply link goes**, so a shortlist is not a pile of dead ends
- **It refuses to invent.** A salary in a currency the board did not name stays
  out of the comparable field; a location is passed on as the board's claim
- **It reads the posting, not only the card.** Where a source publishes text, the
  things people open a vacancy to check — a work-authorisation demand, an office
  requirement, the language the requirements name — come back as a flag and the
  sentence it was found in. Which words matter is yours to configure
- **It fails out loud.** A page that parses to nothing, a paging parameter the
  board ignored, a run that cannot say what it cost — each is an error here, not
  a quiet empty answer that looks like a slow day
- **It is not a scraper you can point at any site.** One adapter per board,
  written against what that board actually answers

## The sources

| code | source | what you need | apply link reaches |
|---|---|---|---|
| `af` | AgileFluent | nothing | the board |
| `w3` | web3.career | nothing | the board |
| `sol` | jobs.solana.com | nothing | **the employer**, for most postings |
| `hc` | career.habr.com | nothing | the board |
| `tm` | TalentMove | **a paid account**, its session cookie in `TM_COOKIE` | the board |
| `ats` | Greenhouse, Ashby and BambooHR instances | **a watchlist** of companies in your profile | **the employer**, always |

Two of those need something before they answer at all, and it is fairer to say
so here than to let an empty result explain it. **`tm` will not work without a
paid subscription to that board** — the cookie is a live account session, it goes
in the environment, and without it the board answers 401 across the whole
address. **`ats` has nothing to search until you name companies**; it is not a
board but a list of employers you want to follow, read from the applicant
tracking system each of them actually hires through, which is why it is the one
source where every apply link reaches the employer.

Each has its own vocabulary and its own quirks; what was measured on each one is
in [notes/](notes/).

A client reads the list of sources once, when it starts the server. **Restart the
server process after adding a source**, or its tools will keep offering the ones
they were started with.

## The tools

| tool | what it does |
|---|---|
| `jobs_count` | how many postings match, without fetching them |
| `jobs_search` | fetch, deduplicate against everything seen, return the new ones |
| `jobs_mark_status` | record `applied`, `rejected`, `interview`, `skip` or `new` |
| `jobs_stats` | what the store holds, and what recent runs cost |

## Running it yourself

    pnpm install                              # npm install works too
    cp profiles.example.json profiles.json    # what to look for is configuration
    cp .env.example .env                      # credentials are not configuration
    pnpm test                                 # offline: no network, no model
    node --experimental-sqlite server.mjs     # MCP over stdio

No build step. Every configuration key is documented in
`profiles.example.json`; board sessions and keys are environment variables and
never live in a file here, and `.env.example` names them.

## When a search comes back empty

The answer separates the board's own total from what was fetched, so an empty
result says which kind it is:

- **`returned: 0` with `found` above zero** — the board has them and you have
  been shown them already. Every posting is recorded the first time; a repeated
  search returns what is new, which the second time is nothing. `skipped` says
  how many and why. Pass `onlyNew: false` to see everything again.
- **`found: 0`** — the board itself matched nothing. Your question, not the
  market.
- **`complete: false`** — the walk stopped early, so what you have is a lower
  bound, not an answer.
- **`found: null` with `foundUnavailable`** — the board's counter failed while
  its search worked. The postings are real; the total is missing.

Two settings narrow harder than they look, and both are named where you set
them. Non-empty `roles` or `grades` drop every posting where that board left the
field unset — on the largest board that is more than half of it. A multi-word
`query` narrows very sharply and often to zero; start with one word.

## Your data

This server keeps a record of somebody's job search. Every claim below is about
the code and can be checked in the file named beside it.

**`jobs.db`, beside `server.mjs`, is the whole of it** (`store.mjs`). It holds
every posting you were shown — company, title, url, location, salary label,
skills, the way in to the employer where one was found — with the date you first
saw it, the status you gave it and any note. Which vacancies you looked at, which
you pursued and which you dismissed is exactly what that file is.

- **Local, and sent nowhere.** Nothing here uploads it; the only network calls
  are an adapter to its own board (`adapters/*.mjs`). `JOBS_DB_PATH` moves it.
- **Gitignored, with its copies** — `jobs.db*` and `*.bak-*`, because a dated
  backup of a private file is still private. `git check-ignore -v jobs.db`.
- **Deleting it deletes the history.** No other copy, and no re-run rebuilds it.

**`profiles.json` is personal too** and gitignored for the same reason: the
countries you would move to, the companies you follow, the phrases you want
flagged, the words you search by. Only `profiles.example.json` ships.

**What a board can see.** Each search is an ordinary HTTPS request, so a board
sees what any website sees: your IP, a browser-shaped `User-Agent` and
`Accept-Language` from a small rotating list, and the query parameters you asked
for (`adapters/_shared/http.mjs`). One board also gets a session cookie, because
it will not answer without one — `TM_COOKIE`, read from the environment and never
written to disk here.

**No telemetry, no analytics, no account.** Nothing is called except the boards
themselves and, for `ats`, the tracking systems you list. Nothing reports usage.
`jobs_mark_status` writes only to your own store; no board is told what you did
with a posting.

## Where to look next

- [SETUP.md](SETUP.md) — registering the server with an MCP client
- `profiles.example.json` — every configuration key, with what a wrong value does
- [notes/](notes/) — what was measured on each source, and under what conditions
- [CLAUDE.md](CLAUDE.md) — how the code is organised and how to work in it
- [Your data](#your-data) — what is stored, where, and what reaches a board

## License

MIT — see [LICENSE](LICENSE).
