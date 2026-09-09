---
paths:
  - "**/*.md"
  - "profiles.example.json"
---

## Documentation: three files, three jobs

- **`README.md`** — for someone deciding whether to use this: the problem it solves, what
  it does about it, which boards it speaks to, how to start it, and what it deliberately
  does not do. High level throughout — no field contracts, no mechanics, no measurements.
  Those have their own files, and the README links to them. **Two hundred lines is the
  budget**, raised from a hundred when the repository became a published plugin: what
  somebody must read before installing — what it will not do, which sources need a
  credential, and where their data goes — is not optional and does not fit in a hundred.
  It is a budget, not a target; spend it on those questions and link out for the rest
- **`notes/*.md`** — every measurement, probe, dead end and board quirk, with the number and
  the conditions that produced it. This is where a fact goes when it is true but nobody
  needs it to use the tool
- **`CLAUDE.md`** — how to work in this repository. Not what the tool does

Rules that keep them from merging back together:

- A number belongs in `notes`. A README that quotes a measurement will be wrong within a
  month and nobody will notice
- If a paragraph answers none of "why would I use this", "how do I start it" and "what
  will it not do", it is not a README paragraph
- Say a thing in one file. A sentence repeated in two drifts into two different claims
- No project history and no rationale essays anywhere. The README may say what the tool is
  for; it may not claim anything that has not been measured
