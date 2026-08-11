# M10-D D0 horizon amendment proposal — bounded novel-wide replacement

**Stage:** M10-D (Semantic Long-Horizon Judges)  
**Status:** RATIFIED — see §6 disposition  
**Model calls:** FORBIDDEN  
**Manifest refreeze:** HELD (ratification does not release the refreeze hold)

## 1. Reason for amendment

D0 currently requires these complete novel-wide surfaces:

- D-R1: Bab 1–50
- D-R2: Bab 1–50
- D-R4: Bab 1–50
- D-R6: Bab 1–50

D1-R1 authored only bounded chapter surfaces. Treating sparse or act-local chapters as
novel-wide authority would silently weaken D0. This proposal records the mismatch and
holds the four novel-wide obligations for explicit reviewer disposition.

## 2. Cost arithmetic

Frozen matrix size remains:

```text
8 rubrics × 2 universes × 13 fixtures = 208 rows
```

Complete novel-wide authorship for four affected rubrics costs:

```text
4 rubrics × 2 universes × 13 fixtures × 50 chapters = 5,200 chapter segments
```

Current D1-R1 authored baseline within those four rubrics is:

```text
D-R1: 2 universes × 13 fixtures × 3 chapters = 78
D-R2: 2 universes × 13 fixtures × 3 chapters = 78
D-R4: 2 universes × 13 fixtures × 4 chapters = 104
D-R6: 2 universes × 13 fixtures × 3 chapters = 78
                                                   ---
baseline authored chapter segments                 338
```

Baseline additional cost for literal Bab 1–50 completion is therefore:

```text
5,200 - 338 = 4,862 additional chapter segments
```

This net figure is a baseline. Authorized contiguous act expansion for D-R2 and D-R4
will add authored segments and reduce the remaining net count, but does not make a
50-chapter surface feasible. Every added paragraph must also satisfy corpus constraints:
40–90 words, unique 2–5 word title, zero prohibited meta prose, five-gram isolation,
and serial human review. Raw chapter count understates review cost.

No scope reduction from 208 rows is proposed.

## 3. Feasible surfaces retained or extended now

D1-R2 must author and freeze these surfaces without waiting for this amendment:

| Rubric | View | Required surface |
|---|---|---|
| D-R1 | reader | contiguous act-local surface |
| D-R2 | structural | contiguous act-local surface |
| D-R3 | structural | contiguous act-local plus contiguous runway Bab 41–50 |
| D-R4 | reader | local N-2/N-1/N, contiguous act-local, contiguous runway Bab 41–50 |
| D-R5 | reader | chapter within contiguous act context |
| D-R7 | reader | contiguous Bab 45–50 |
| D-R8 | reader and structural cases | contiguous Bab 41–50, identical titled reader surface |

D-R6 remains structural and retains explicit setup/payoff chapters while its replacement
novel-wide horizon is under review.

## 4. Proposed bounded horizon authority

Add one horizon kind only after reviewer ratification:

```text
BOUNDED_NOVEL
```

Canonical meaning:

1. Coverage is an explicit, pre-registered ordered chapter set spanning early setup,
   relevant act development, late consequence, and ending/runway where applicable.
2. Coverage is rubric-specific and identical for all 13 fixtures inside one
   rubric/universe bank.
3. Coverage never claims Bab 1–50 completeness and cannot be serialized as `NOVEL`.
4. Structural view receives only D0-approved bounded structural context.
5. Manifest freezes exact chapter identities before any model call.
6. Any missing registered chapter hard-fails assembly.

Proposed rubric application:

| Rubric | Bounded authority |
|---|---|
| D-R1 | contiguous act-local case plus pre-registered cross-act velocity anchors |
| D-R2 | contiguous act-local case plus pre-registered earlier/later character-state anchors |
| D-R4 | local case, contiguous act-local case, contiguous runway case, plus pre-registered cross-act repetition anchors |
| D-R6 | explicit setup, bridge, and payoff chapters sufficient to expose the complete authored debt path |

Exact anchor chapter numbers remain **UNFROZEN** in this proposal. They must be authored,
manually reviewed, and registered before manifest refreeze. Sparse anchors may support
`BOUNDED_NOVEL`; they must never be relabeled `NOVEL`.

## 5. Authority and gate effect

The pre-disposition gate state was:

```text
D0 novel-wide obligations       UNCHANGED
bounded replacement             PROPOSED ONLY
D1-R2 manifest refreeze         HOLD
D2 calibration                  NO-GO
D2/D3 model calls               FORBIDDEN
D-OPS-1                         OPEN / UNRESOLVED
production/shared DB            FORBIDDEN
C semantics/evidence            FROZEN
```

Ratification authorizes only bounded-horizon schema/corpus work. It does not authorize
provider calls, threshold derivation from real scores, DB/schema/migration/runtime work,
or changes to C evidence.

### 5.1 Post-ratification gate state

```text
D0 novel-wide obligations       REPLACED by BOUNDED_NOVEL for D-R1/D-R2/D-R4/D-R6
bounded replacement             RATIFIED
D1-R2B bounded schema/corpus    GO
D1-R2 manifest refreeze         HELD
D2 calibration                  NO-GO
D2/D3 model calls               FORBIDDEN
D-OPS-1                         OPEN / UNRESOLVED
production/shared DB            FORBIDDEN
C semantics/evidence            FROZEN
```

## 6. Reviewer disposition

Reviewer had to choose one explicit disposition:

1. `RATIFIED`: accept `BOUNDED_NOVEL` and require exact anchor surfaces before D1
   manifest refreeze.
2. `REVISE`: name replacement horizon semantics or additional required surfaces.
3. `REJECTED`: retain literal Bab 1–50 authorship; D1 stays HOLD until all 5,200
   chapter segments exist and pass corpus review.

No default acceptance. Silence leaves this proposal on HOLD.

### 6.1 Recorded disposition

```text
disposition   RATIFIED
option        1
condition     exact anchor surfaces authored, human-reviewed, and registered
              before D1 manifest refreeze
```

Ratification of `BOUNDED_NOVEL` does not release the manifest refreeze hold and does not
authorize any provider call.

## 7. Ratified D1-R2B anchor and topology addendum

Reviewer disposition on the D1-R2B execution plan fixed the following. These values are
authority for D1-R2B; the proposal body above remains the semantic definition.

### 7.1 Authoring target registry — all 8 rubrics

```text
D-R1   6, 18, 19, 20, 32, 45
D-R2   9, 13, 14, 15, 16, 17, 18, 19, 20, 22
D-R3   33..50
D-R4   6, 14, 15, 16, 32, 41..50
D-R5   23, 24, 25, 26
D-R6   6, 21, 34, 44, 46, 48
D-R7   45, 46, 47, 48, 49, 50
D-R8   41..50
```

Chapter slots `6+10+18+15+4+6+6+10 = 75`. Segments `75 × 26 fixtures = 1,950`.

### 7.2 Bounded-novel evaluator authority

`BOUNDED_NOVEL` applies to D-R1, D-R2, D-R4, D-R6 only. Each bounded entry must be
identical to the corresponding authoring target above. A `BOUNDED_NOVEL` horizon declared
for any rubric without a registry entry is a hard policy failure.

### 7.3 Inventory

```text
existing authored segments        806
missing segments                1,144
post-expansion segments         1,950

D-R1  +78    D-R2  +182   D-R3  +390   D-R4  +286
D-R5  +52    D-R6  +78    D-R7  +78    D-R8    +0
```

Registry semantics: `existing ⊆ target` before authoring; per-rubric equality after that
rubric's wave; equality for all 8 rubrics after the final wave.

### 7.4 Case topology — RATIFIED at 312

```text
D-R1   BOUNDED_NOVEL                                 26
D-R2   BOUNDED_NOVEL                                 26
D-R3   ACT 33-40 + RUNWAY 41-50                      52
D-R4   LOCAL 14-16 + BOUNDED_NOVEL + RUNWAY 41-50    78
D-R5   ACT 23-26                                     26
D-R6   BOUNDED_NOVEL                                 26
D-R7   ACT EXPLICIT 45-50                            26
D-R8   RUNWAY structural + reader                    52
                                                    ---
                                                    312
```

`ACT` and `RUNWAY` answer different questions; collapsing them into one sparse bounded case
would reduce future call cost but destroy horizon diagnosis.

**312 locks corpus/case topology only. It is not authorization to run 312 model calls.
D2 remains FORBIDDEN.**

D-R7 coverage is `EXPLICIT [45,46,47,48,49,50]`, never `CONTIGUOUS 45→50`; existing D-R7
policy requires explicit coverage including Bab 49.

D-R8 gains a second reader-view case over identical chapter coverage 41–50. Title
preservation in the judge surface is **not** in scope and remains HELD.

### 7.5 Review-state authority

Row review state widens to `PENDING_REVIEW | RATIFIED` before any new prose is authored.
Newly authored or modified rows are `PENDING_REVIEW`. Only the reviewer, against exact
content hashes, promotes a row to `RATIFIED`. Assembly and execution authority accept
`RATIFIED` only and fail closed otherwise. Representable is not executable.
