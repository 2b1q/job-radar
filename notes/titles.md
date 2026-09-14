# What the title filter reads

Back to the [README](../README.md). `titleExclude` and `titleInclude` are the profile's
regular expressions over every title, after collection.

## Titles in Russian

**JavaScript's `\b` knows only ASCII letters**, so an English pattern never matches a
Cyrillic word, and a list written in English passes a Russian title untouched unless it
happens to carry a Latin token such as `Junior` or `QA`.

Share of Cyrillic titles among stored rows with status `new`, 1,313 rows:

| af | hc | tm | ats, sol, w3 |
|---|---|---|---|
| 63 of 499 (12%) | 20 of 31 (64%) | 68 of 99 (68%) | 0 |

So on two connected sources most titles were never read by the filter at all.

The example `backend-node` profile now carries the same role classes in Russian - analyst,
manager, teaching and content, design, information security, sales, support, 1C,
frontend, intern - with an explicit Cyrillic left edge instead of `\b`, and its language
rule gained `go` (not `go-to`) and Bitrix, which were missing in either script. Measured
on the 1,170 distinct titles with status `new`:

| | before | after |
|---|---|---|
| Cyrillic titles passing | 110 of 147 | 68 |
| newly dropped | - | 48: 42 Cyrillic, 6 Latin naming Go |

Every newly dropped title was read; none is a Node.js or TypeScript backend role. The 68
still passing are backend, fullstack, data, ML, Solidity and similar - classes the English
list does not cut either, so the Russian section stops at parity with it.
`tests/title-exclude.test.mjs` holds both halves.
