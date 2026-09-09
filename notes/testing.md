# What the test suite has cost

Back to the [README](../README.md).

## An orphaned runner burned a core for three days

`tests/server-store.test.mjs` starts real `server.mjs` processes over stdio,
because that seam has no other cover: `server.mjs` opens a transport at import
and never returns. A client that is not closed leaves its server running, and
`node --test` will not exit while a child is alive — so the suite passes every
test and then hangs.

One did. A runner sat at PPID 1 on 96% of a core for **three days and eighteen
hours**, orphaned when its parent shell died. It held no database and had no
children; `pkill -f 'node .*--test'` clears one safely.

Two things came out of it, and only one of them worked.

## `--test-timeout` — kept

A test that hangs now fails with a name instead of running forever. Verified by
breaking it: a test that never resolves terminates and the suite exits non-zero.
`60000` is the setting, against a slowest real test of about eleven seconds.

## `--test-force-exit` — tried and rejected

It ends the run while files are still reporting. Three consecutive runs of the
same unchanged suite:

| run | tests reported | claimed |
|---|---|---|
| 1 | 247 | `fail 0` |
| 2 | 254 | `fail 0` |
| 3 | 251 | `fail 0` |

Without the flag: 254 every time. The per-file sum is 254.

So the flag silently skipped up to seven tests and called the run a pass — the
failure this repository exists to catch, produced by the fix for a different one.
**A flag that hides tests is worse than the hang it prevents.**

The hang is handled where it belongs instead: one helper starts a server and
closes it in a `finally`, so no test can forget, and `after` closes even when
`before` threw before assigning.
