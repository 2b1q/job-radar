---
paths:
  - "tests/**"
  - "**/*.test.mjs"
---

## Testing

- Offline: fixtures only, no network in tests
- Fixtures are synthetic or sanitised, and declare which they are
- **Every guard is verified by breaking the code it guards, not the fixture.** A test that
  has never failed proves nothing
- A skipped test must be visible: print how many were skipped and why. `OK (skipped=12)` is
  not `OK`
- Cover the seam, not each side of it: feed one module's output straight into its consumer
- **A spawned server is closed in a `finally`, always.** An unclosed client leaves the
  process running and `node --test` will not exit: a suite that passes and then hangs.
  `--test-timeout` bounds it; `--test-force-exit` was tried and rejected because it skips
  tests silently — numbers in `notes/testing.md`

