---
paths:
  - ".claude-plugin/**"
  - ".mcp.json"
  - "package.json"
---

## Releasing

The repository is also a Claude Code plugin and its own marketplace:
`.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` and `.mcp.json`.

**A user gets an update only when the version string changes.** Fix a bug without
touching `.claude-plugin/plugin.json` and nobody installs the fix — the plugin
looks current and is not. So a change that reaches a user bumps the version in
the same diff as the change — staged with it, since committing is the owner's
(root `CLAUDE.md`, "Handing it over").

Three files carry a version and they must agree: `.claude-plugin/plugin.json`,
`package.json`, and the `McpServer` constructor in `server.mjs`.

    claude plugin validate .            # before staging; --strict in CI

It catches broken JSON, duplicate plugin names and a `source` pointing outside
the repository.

