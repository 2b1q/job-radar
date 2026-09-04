# Connecting the server to an MCP client

The server speaks MCP over stdio, so a client starts it as a subprocess. Back to
the [README](README.md).

## 1. Install

    pnpm install
    node --test          # offline, should end with "fail 0"

## 2. Give the client an absolute path to node

A desktop app does not inherit your shell's `PATH`, so a bare `node` either is
not found or is an older one than the shell uses. Take the path from the shell
that just ran the tests:

    which node           # e.g. /Users/you/.nvm/versions/node/v22.14.0/bin/node

Node 22.5 or newer is required, for `node:sqlite`.

## 3. Register the server

In the client's MCP config — on macOS usually
`~/Library/Application Support/Claude/claude_desktop_config.json` — add an entry
under `mcpServers`:

```json
{
  "mcpServers": {
    "job-radar": {
      "command": "/absolute/path/to/node",
      "args": [
        "--experimental-sqlite",
        "/absolute/path/to/job-radar/server.mjs"
      ],
      "env": {
        "JOBS_PROFILE": "default"
      }
    }
  }
}
```

`--experimental-sqlite` is required on Node 22 and harmless on 23+, where
`node:sqlite` is no longer behind the flag. Leaving it in means the config
survives a node upgrade or downgrade either way.

Restart the client. The tools appear as `jobs_search`, `jobs_count`, `jobs_mark`
and `jobs_stats`.

## 4. Before the first search

Copy `profiles.example.json` to `profiles.json` and describe what you are looking
for. Without it the server falls back to the example profile, which is a
demonstration rather than anybody's search.

A board that needs a session cookie reads it from the environment — `TM_COOKIE`
in the `env` block above, or exported before the client starts. It is a live
account session: it belongs in the client config or the environment, never in
this directory.

## Notes

- The store is created on first run as `jobs.db` beside the server;
  `JOBS_DB_PATH` moves it. Keep it on a local disk — SQLite over a network share
  is a way to lose it.
- `node smoke.mjs <af|tm|w3>` exercises one board without MCP and without
  touching the store; it is the quickest way to tell a broken config from a
  broken board.
