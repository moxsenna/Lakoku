# M10-D D1-R2 — cross-fixture semantic relationship audit

**Status:** COMPLETE AUDIT / CORRECTIVE ACTION REQUIRED  
**Scope:** 16 authored banks, 208 fixtures  
**Model/provider calls:** none  
**DB/runtime/C evidence changes:** none

## 1. Classification rules

Every relationship found during full-bank manual review is classified as exactly one:

- `BLOCKER_CLONE`: same narrative spine is reused outside its legal rubric-local
  calibration family. Later/derivative prose must be rewritten and re-reviewed.
- `ALLOWED_CONTROLLED_MUTATION`: same universe, rubric, and family; one authored base
  is varied only on `RUBRIC_STRENGTH`. Members must share `fixtureFamilyId`; every
  non-base member must point directly to the base.
- `THEMATIC_ADJACENCY`: shared theme, archetype, object, setting texture, or cast does
  not reuse the complete narrative spine. Members remain independent families.

Cross-rubric and cross-universe relationships cannot be registered as controlled
mutations under the manifest fence. A controlled-mutation base may be STRONG or WEAK,
but the base must not itself carry a mutation relation.

Fixture shorthand used below maps to manifest identity:

```text
L-d-rN-* = d1-fixture-lembah-awan-d-rN-*
P-d-rN-* = d1-fixture-pesisir-utara-d-rN-*
a = STRONG; b = WEAK; c = BORDERLINE
```

## 2. BLOCKER_CLONE ledger

| ID | Members | Finding | Corrective disposition |
|---|---|---|---|
| B1 | `L-d-r4-a5`, `L-d-r6-a1` | marker thread, evidence tin, public board payoff repeat | keep D-R4; rewrite D-R6 family |
| B2 | `L-d-r5-b5`, `L-d-r8-b5` | Bagas key-on-belt and passive non-response repeat | rewrite D-R8 member |
| B3 | `L-d-r2-b3`, `L-d-r4-b5` | unrecorded sack re-handed while ledger stays empty | rewrite later D-R4 member |
| B4 | `L-d-r7-b1`, `L-d-r8-b3`, with close `L-d-r5-b3` | Danu loses work/pay, blames Vina in kitchen, silence follows | rewrite D-R8 member and re-author D-R5 weak scene away from this spine |
| B5 | `P-d-r4-a4`, `P-d-r8-a3` | Ratih back-table warung becomes evidence base with same relationship payoff | rewrite D-R8 member |
| B6 | `P-d-r3-a4`, `P-d-r8-a2` | scale certificate attacked, equipment sealed, Uweng cast as forger | rewrite D-R8 member |
| B7 | `L-d-r3-a2`, `L-d-r4-a2`; weak derivatives `L-d-r4-b2`, `L-d-r5-b2`, `L-d-r8-b2` | acid/contaminated sack, Karsa recognition, public proof or passive non-inspection repeat | preserve one D-R3 family; rewrite conflicting D-R4/D-R5/D-R8 families |
| B8 | `L-d-r6-c1`, `L-d-r8-c2` | single unlogged red marker, one private witness, no resolution | rewrite D-R8 member |
| B9 | `L-d-r6-c2`, `L-d-r8-c3`; `L-d-r6-b2`, `L-d-r8-b4` | Mbah Ripto old map, white canal markers, unrealized route | register within-rubric D-R8 old-map relation for current truth, then rewrite entire derivative D-R8 weak/borderline surface and re-review; final manifest must reflect rewritten families |
| B10 | `L-d-r7-a4`, `L-d-r8-a4` | Bu Ningsih loses classroom and closes through improvised outdoor class | rewrite D-R8 member |
| B11 | `P-d-r1-a3`, `P-d-r8-c2`, with echo `P-d-r4-c1` | odd ferry ticket reveals hidden night departure | keep D-R1; rewrite D-R8 member and replace D-R4 echo object |
| B12 | `L-d-r2-a5`, `L-d-r6-a5` | lumbung key transferred to three-person custody and protagonist loses sole access | keep D-R2; rewrite D-R6 family |

Blocker disposition is prose-level, not metadata-only. Token/name substitution is
forbidden. Each rewritten family needs a new scene, object, location, action chain,
and sentence surface, followed by renewed semantic and five-gram review.

Because its WEAK and BORDERLINE rows are mostly transplants, `lembah-awan` D-R8 must
be re-authored as nine fixtures total: STRONG `a4`, all five WEAK fixtures, and all
three BORDERLINE fixtures. `pesisir-utara` D-R8 requires at least the B5, B6, and B11
members to be re-authored.

## 3. ALLOWED_CONTROLLED_MUTATION ledger

Only groups below qualify. Every group receives one unique family ID. First named
member is base unless marked otherwise. Every later member points directly to it using
axis `RUBRIC_STRENGTH`.

### Lembah Awan

| Rubric | Controlled family members |
|---|---|
| D-R1 | `a1,b1,c1`; `a2,b2,c2`; `a3,b5`; `a4,b4` |
| D-R2 | `a1,b1,c1`; `a2,b2,c2`; `a3,b3,c3`; `a4,b4`; `a5,b5` |
| D-R3 | `a1,b1,c2`; `a2,b2,c1,c3`; `a3,b3`; `a4,b4`; `a5,b5` |
| D-R4 | `a1,b1,c1`; `a2,b2,c2`; `a3,b3,c3`; `a4,b4`; `a5,b5` |
| D-R5 | `a2,b2,c2` |
| D-R6 | `a1,b1,c1`; `a2,b2,c2`; `a3,b3`; `a4,b4`; `a5,b5,c3` |
| D-R7 | `a3,b3,c3`; `a5,b5`; `a4,b4`; `a1,c2`; base `b1` with member `c1` |
| D-R8 | current old-map `b4,c3` and current red-marker/key-material `b5,c2` relationships are audit truth but blocked by B2/B8/B9; they must not survive final refreeze unchanged |

### Pesisir Utara

| Rubric | Controlled family members |
|---|---|
| D-R1 | `a1,b1,c1`; `a4,b4`; `a5,b5,c3`; `a3,b3`; base `b2` with member `c2` |
| D-R2 | `a1,b1,c1`; `a2,b2,c2`; `a3,b3`; `a4,b4,c3`; `a5,b5` |
| D-R3 | `a1,b1,c1`; `a2,b3,c3`; `a3,b4`; `a4,b5`; base `b2` with member `c2` |
| D-R4 | `a1,b1`; `a3,b2`; `a2,c3` |
| D-R5 | `a5,c1` |
| D-R6 | `a2,c1` only; unrelated weak fixtures remain independent |
| D-R7 | `a5,c2`; base `b1` with member `c1`; `a3,c3` |
| D-R8 | none accepted until B5/B6/B11 rewrites complete and new gradients are reviewed |

Standalone fixtures not named in this section receive independent family IDs. They
must not inherit tier-wide or rubric-wide families.

## 4. THEMATIC_ADJACENCY ledger

These relationships remain independent and receive no mutation relation:

1. Lembah evidence containers (`kaleng`) across D-R4/D-R6/D-R8.
2. Lembah children marking ground or stones across D-R4/D-R8.
3. Pesisir blue wax/seal objects across D-R1/D-R2/D-R4 where action chains differ.
4. Lembah `tampah` evidence surfaces across D-R1/D-R3/D-R4/D-R8 where spines differ.
5. Lembah rain/drizzle stasis texture across D-R1/D-R2/D-R8.
6. Lembah borderline “one small fact recorded” archetype across D-R5/D-R8.
7. Cross-universe D-R2 own-name-under-cost archetypes. Cross-universe identity makes
   controlled mutation illegal; differing cast and conflict keep them adjacent only.
8. Household/public accountability list archetypes across Lembah D-R6 and Pesisir
   D-R8.
9. Suar, warung, hidden-space, weight-discrepancy, timepiece, and tool-betrayal
   cross-rubric object reuse where complete spines are not in B1–B12.
10. Pesisir D-R6 weak anti-payoff rows: each remains an independent weak fixture, not
    one shared family.
11. Off-spine weak rows with no matched base: L-D-R1 `b3`; L-D-R5 `b3,b5`;
    P-D-R4 `b3,b4,b5`; P-D-R5 `b1..b5`.

## 5. Additional integrity finding

`L-d-r4-a3` uses “Nyi penjaja teh”. “Nyi” belongs to Pesisir register and is not a
named Lembah cast identity. Replace with a Lembah-valid role/name during blocker
rewrite review. This is universe leakage, not a tier-status correction.

No verbatim paragraph reuse or token-substitution construction was found during manual
review. Automated five-gram zero remains a separate required check after rewrites.

## 6. Manifest consequences

Current empty `D1_CONTROLLED_MUTATIONS` register is false. Current tier-wide
`fixtureFamilyId` is also false.

Required final state:

1. Independent fixture: unique family ID.
2. Legal mutation group: one shared family ID.
3. Base: no mutation relation.
4. Every sibling: direct relation to base with `RUBRIC_STRENGTH`.
5. Cross-rubric and cross-universe rows: never share controlled-mutation family.
6. B1–B12 derivative prose: rewritten and re-reviewed before final family map.
7. Old-map relation: explicitly represented during corrective history; final frozen
   identity follows rewritten, re-reviewed D-R8 prose.
8. No manifest hash refreeze until blocker rewrites, horizon work, and all authority
   defects close.

## 7. D1-R2A remediation scope and sequencing

Corrective prose scope is locked to:

```text
L D-R6   B1 family; B12 family
L D-R4   B3 member; B7 family; a3 universe-register correction
L D-R5   B4 member; B7 family
L D-R8   a4; b1..b5; c1..c3
P D-R8   B5 member; B6 member; B11 member
P D-R4   B11 echo member
all else FROZEN
```

“Family” means every dependent mutation member is rebuilt or explicitly separated as
an independent family. A rewritten fixture loses old content-specific ratification and
returns to `PENDING_REVIEW`. Historical relations remain in this audit; obsolete
relations must not be copied into final post-corrective manifest metadata.

D1-R2B horizon expansion waits until D1-R2A reaches zero blockers. Expanded surfaces
also require case/horizon-level review authority; old row-level ratification cannot
silently cover newly authored chapters.

## 8. Governance disposition

```text
relationship taxonomy audit     ACCEPTED / submitted local governance evidence
manual 16-bank audit             COMPLETE
controlled-mutation metadata    FAIL / corrective required
blocker clones                   12 groups OPEN
next active work                 D1-R2A blocker remediation
bank prose freeze exception      AUTHORIZED only for locked corrective scope
D1-R2B horizon expansion         WAIT until blocker count is zero
D0 novel-wide amendment          AWAITING reviewer ratification
manifest refreeze                HOLD
rewritten fixture labels         PENDING_REVIEW
D2 calibration                   NO-GO
D2/D3 model calls                FORBIDDEN
D-OPS-1                          OPEN / UNRESOLVED
```
