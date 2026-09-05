# AgileFluent: a USD field that holds any currency

Back to the [README](../README.md).

## `salaryMinUsd` is the posting's minimum, not a dollar figure

The board fills one numeric field for every posting and states the currency only
in the label beside it. Counted over the 284 rows one store held, the labels use
**eleven** currency markers:

| marker | distinct labels |
|---|---|
| `$` | 46 |
| `€` | 10 |
| `PLN` | 5 |
| `RUB` | 4 |
| `CAD` | 3 |
| `GBP`, `JPY` | 2 each |
| `INR`, `SGD`, `PEN`, `BYR` | 1 each |

The shape is `<marker><min>–<max>k / <period>`, and `Не указана` where the
posting states nothing.

The measured case: `26090315`, label `JPY8000–16000k / год`, `salaryMinUsd`
**8000000**. `jobs_search` sorts descending on that field, so a yen figure sits
above every dollar salary on the board — and 8 000 000 of anything reads as an
outlier worth opening.

The board is not converting and is not wrong about its own posting: it is
reporting the minimum in the currency the employer quoted. The field name is what
makes it a defect downstream.

**So the label decides.** A figure survives into `salaryMinUsd` only where the
label opens with `$` or `USD`; anything else — including a label the board did
not send at all — leaves the field null and the label carrying the number in the
currency it was written in. Nothing is converted: that rule was never the one
being broken, and a rate-converted figure is the number somebody quotes back six
months later.

The other two adapters already worked this way. TalentMove quotes monthly roubles
and leaves the field null; web3.career fills it only when `baseSalary.currency`
is USD. Two adapters agreeing and a third disagreeing about what one field name
means is worse than any of the three answers.

## What is still unmeasured

Whether the board ever sends a figure with no label at all. None of the 284 rows
did — every one carried a label, `Не указана` included — so the case is handled
(no label is no currency, so no figure) rather than observed.
