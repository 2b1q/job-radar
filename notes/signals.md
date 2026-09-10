# Signals: what separates a match from an assertion

Back to the [README](../README.md).

A signal is a word found in a posting's text. An assertion is what the sentence
does with it. Everything here is the distance between the two, measured on live
postings, 2026-09-09.

## The rule, once, for every signal

**A match counts only where a word from its own subject governs it, and its
polarity is read from what stands before it.** One mechanism, two parameters:

| signal | governing words | where they may stand |
|---|---|---|
| `language` | requirement words — experience, expertise, proficiency, strong, written, built, production, required… | **before** the name, within 60 characters |
| `onsite` | arrangement words — office, on-site, in-person, remote, work, presence, week, days, commute, attendance, schedule, relocation, role, position, based, hours | either side, within 60 characters |
| `phrases` | none — the phrase is the whole subject | — |

The window and the direction are the only things that differ. Adding a signal
means naming its subject, not writing it a new rule.

## What each check cost, and what it bought

### Governing: the language signal, 276 postings

| rule | flagged | wrong |
|---|---|---|
| the name appears as a word | 35 | most |
| + not inside a hyphenated compound | 30 | `go-to-market` gone |
| + the sentence contains a requirement word | 24 | "assess the core **skills**" still reached back to a verb |
| + the requirement word comes **before** the name, within 60 characters | **3** | 3 |

The three survivors are all `Go`: a two-letter English verb is not separable
from its own grammar without parsing. `Rust`, `Scala` and `Java` produced no
false positive at any stage.

### Governing: the onsite signal, 200 postings

The same rule was missing here, and the defect it let through was reported from
a live run — `hybrid` raised on a designer's portfolio:

> Requires early-stage startup experience, **a hybrid portfolio of UX and visual
> craft**, Figma mastery, and deep intuition for gaming culture

`hybrid` describes the portfolio. Nothing in the posting asks anybody into an
office. Two more of the same shape were in the sample: *service delivery at
client sites*, and *multi-cloud and hybrid environments*.

**Only the ambiguous triggers need governing.** `hybrid` and `on-site` are a
work arrangement only in the right company; `in-office`, `two days a week in the
office` and `relocation to X is required` carry their subject already. Marking
the two ambiguous ones and leaving the rest alone is what the `ambiguous` flag on
each pattern does.

The cost of getting that wrong in the other direction was measured too. An early
version required a cue for every pattern and lost `Hybrid in <city>, <state>` — a
real arrangement stated with no noun at all. Hence the `hybrid in <place>` pattern,
which is unambiguous by construction.

A cue **inside** the match counts, so that `two days per week in the office`
governs itself — but it must be a *part* of it, or `on-site` would vouch for
itself and the check would be a tautology.

## Polarity: a substring is not an assertion

The second live defect, and the worse of the two:

> relocationOffered: "The role is fully remote within one country, **with no
> visa sponsorship**"

The phrase is there. The claim is the opposite of what the flag said, and a
reader skimming a shortlist would have read "relocation offered" off a posting
that rules it out.

English job ads write the denial as readily as the offer — *no visa sponsorship*,
*we do not sponsor*, *unable to sponsor* — so this is not an edge case, and it
cannot be pushed into the profile: a user would have to enumerate every negative
phrasing forever. **The phrase list belongs to the user; the grammar around it
belongs here**, and negation is grammar.

A negated match is **kept and labelled**, never dropped. "There is no
sponsorship" is worth exactly as much as "there is", with the opposite sign:

    relocationOffered (negated): "The role is fully remote within India, with no visa sponsorship"

`polarity` is a field on the finding — `affirmed` or `negated` — rather than a
second signal name. The name stays the one the user configured, so their config
maps one-to-one onto what they read back, and every signal type carries polarity
the same way. A negator counts only within 45 characters before the match and
inside the same sentence, so a denial about something else earlier in the
paragraph does not reach it.

## What the two fixes did, on identical text

200 AgileFluent descriptions, one configuration, the code before and after:

| | findings |
|---|---|
| before | 9 |
| after | 7 |
| dropped as ungoverned | 2 — both genuine false positives |
| kept, relabelled `negated` | 2 — both had been asserting the opposite |

So **four of the nine findings were wrong**: two said something the posting did
not, two said the reverse of what it did. All four now read correctly, and the
two arrangements stated without a noun, which an intermediate version lost, are
back.

## What is still unmeasured

Whether the arrangement cue list is complete. It was drawn from the sentences in
one 200-posting sample; a phrasing the sample missed will be dropped silently,
which is the failure this file is otherwise about.

Whether polarity should distinguish "not stated" from "denied". It does not: a
posting that never mentions sponsorship raises nothing at all, which reads the
same as a posting that has not been looked at.

## An office in a benefits list

A third live false positive, of one shape seen twice: `In-office meals`, and
earlier `In-Office Group Meals`. A benefits list names the office more often
than a requirement does, and `hybrid`/`on-site` sitting next to *meals, snacks,
lunch, perks, benefits, stipend, gym, parking, catering* is a thing offered, not
a place you must be.

Handled as a second qualifier beside the "office as an option" one, and for the
same reason: the vocabulary of what is being offered is grammar, not somebody's
preference. A requirement in the next sentence still lands — the qualifier
disqualifies the sentence it is in, not the posting.
