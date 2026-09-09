# job-radar

Several job boards behind one MCP interface, with a memory of everything it has
already shown you.

## The problem

Every board has its own query language, its own idea of a tag, and its own way of
failing quietly: a filter value nobody validates, an empty page that reads as an
empty market, an apply button that leads back to the board instead of the
employer. Search a few of them by hand and most of what you read today is what you
read yesterday.

## What it does

- **One interface over several boards.** The same four tools and the same answer
  shape, whichever board is answering
- **It remembers.** Every posting it has shown you is recorded, so the next search
  returns what is new. Mark one `applied`, `rejected`, `interview` or `skip`, and
  the mark stays with it
- **It recognises the same job twice.** Boards republish each other's postings
  under their own ids. One that has already been seen on one board does not come
  back from another, and the answer says when that happened
- **It says where an apply link goes.** Some boards link to the employer's own
  application; others link back to themselves and keep the company behind a signup.
  Every posting says which — or says that nobody has classified that board's links
  yet — so a shortlist is not a pile of dead ends
- **It refuses to invent.** A salary the board quoted in a currency it did not name
  stays out of the comparable field, and a location is passed on as the board's
  claim rather than as a fact
- **It reads the posting, not only the card.** Where a source publishes the
  vacancy's own text, what people open a vacancy to check — whether it demands
  the right to work in one country, whether the office is a requirement or an
  offer, which language the requirements actually name — comes back as a flag
  and the sentence it was found in. Which words matter is yours to configure,
  and nothing is ever dropped for one: the quote is there to be read
- **It fails out loud.** A page that parses to nothing, a paging parameter the
  board ignored, a run that cannot say what it cost — each of those is an error
  here, not a quiet empty answer that looks like a slow day

## The sources

| code | source | what you need |
|---|---|---|
| `af` | AgileFluent | nothing |
| `tm` | TalentMove | a paid subscription, its session cookie in `TM_COOKIE` |
| `w3` | web3.career | nothing |
| `sol` | jobs.solana.com | nothing |
| `hc` | career.habr.com | nothing |
| `ats` | the employers you name, on their own Greenhouse, Ashby or BambooHR | a watchlist in your profile |

The last one is not a board. It is a list of companies you want to follow, read
from the applicant tracking system each of them actually hires through — which
is why it is the one source where every apply link reaches the employer.

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

## Quick start

    pnpm install
    cp profiles.example.json profiles.json    # what to look for is configuration
    cp .env.example .env                      # and credentials are not configuration
    pnpm test                                 # offline: no network, no model
    node --experimental-sqlite server.mjs     # MCP over stdio

Node 22.5+, no build step. `profiles.json` is where the search lives — roles,
grades, the countries you would move to, the tags each board knows by its own
name, the employers you follow, and the phrases worth flagging; every key is
documented in `profiles.example.json`. Board sessions and keys are environment
variables and never live in a file here; `.env.example` names them. Registering
the server with an MCP client: [SETUP.md](SETUP.md).

## What it is not

- **Not a scraper you can point at any site.** One adapter per board, written
  against what that board actually answers
- **Not a salary converter.** Nothing is turned from one currency into another; an
  invented number is the one that gets quoted later
- **Not a verifier.** What a source says about a location or a work mode is
  passed on as its claim, and marked as unverified. A flag raised on a posting's
  text is a quote to read, not a decision that has been made for you
- **Not an application bot.** It finds and it remembers; applying is yours

## Where to look next

- [SETUP.md](SETUP.md) — registering the server with an MCP client
- `profiles.example.json` — every configuration key, with what a wrong value does
- [notes/](notes/) — what was measured on each source, and under what conditions
- [CLAUDE.md](CLAUDE.md) — how the code is organised and how to work in it

## License

MIT — see [LICENSE](LICENSE).
