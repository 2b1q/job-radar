# Dedup across boards

Why one store, what the second key does, and where it stops working. Back to the
[README](../README.md).

## Why one store and not a repository per board

Both boards republish the same Greenhouse and Lever postings, so a vacancy shows
up twice unless something joins them. Two keys do that:

- **`id`** catches the same board offering the same posting again
- **`dup_key`** — normalised `company` + `title` — catches the *other* board
  offering it. Ids are minted per board: one posting arrives as `26043677`
  from AgileFluent and as `tm:266351` from TalentMove, and by id alone those are
  two vacancies. That is not hypothetical; it is how the second copy came back
  marked `new` while the first already carried `applied`

The key is an **exact** match on normalised strings — lowercased, punctuation
stripped, whitespace collapsed — and never fuzzy. The two mistakes are not
equally priced: a false merge hides a live vacancy and says nothing, while a
duplicate row is one line a human sees and dismisses.

**Entities are decoded before the key is built.** One board left `&amp;` in a
title and another did not, so the same posting keyed as
`...backend blockchain` and `...backend amp blockchain` and sat in the store
twice. The key is derived data, so it is recomputed on start when the derivation
changes rather than left as whatever an older version produced.

**Titles are translated per board, and that the key cannot survive.** The same
posting reads `Founding CTO / Technical Lead – Messenger & Stablecoin Payments`
on one board and a Russian rewrite of the same title on the other. Company
plus title cannot match across a translation, so cross-board dedup works for
verbatim republication — the Greenhouse and Lever case, which is most of it — and
not for a board that rewrites. Measured: 1 of 60 web3.career postings was already
known.

**No company, no key.** TalentMove leaves `company` null on some cards, and a
key built from the title alone would collapse every "Backend Developer" on the
board into one row. Those fall back to id-only dedup, which is what they had.

A skipped duplicate never touches the row already stored: it may carry a status
somebody set by hand.

