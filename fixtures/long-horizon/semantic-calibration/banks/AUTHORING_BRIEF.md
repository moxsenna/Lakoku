# M10-D1 corpus authoring brief

You are authoring **judge-visible narrative prose** for a semantic-judge calibration corpus.
A human reviewer inspects this prose directly. Template generation, token substitution, and
rubric-answer commentary are rejection causes. Write real scenes.

## Hard rules

1. **Indonesian narrative prose only.** Past-or-present scene writing, concrete action, concrete
   objects, concrete dialogue. Reader-facing novel text.
2. **No meta prose.** Never write a sentence that states, explains, hints at, or summarises the
   rubric conclusion, the tier, the partition, the score, or the reason a reviewer should judge it
   one way. Forbidden shapes include, but are not limited to:
   - `Di sini laju beralih dari temuan ke keputusan.`
   - `Di sini sikapnya berubah setelah memilih korban yang dibela.`
   - `Bab ini tidak mengubah apa pun.`
   - `Adegan ini mengulang adegan sebelumnya.`
   Any sentence that talks *about* the scene instead of *being* the scene is forbidden.
3. **No labels.** The words `STRONG`, `WEAK`, `BORDERLINE`, `CALIBRATION`, `HOLDOUT`, `rubric`,
   `D-R1`..`D-R8`, `tier`, `skor`, `ambang` must never appear in prose.
4. **No token substitution.** Two fixtures in the same bank must not be the same paragraph with a
   different name/number. Different fixtures are different scenes: different objects, different
   locations, different people, different actions, different sentences.
5. **Tier is expressed by story behaviour, not by wording.** See the per-rubric axis below. A WEAK
   fixture must genuinely fail the axis in the fiction; a STRONG fixture must genuinely satisfy it;
   a BORDERLINE fixture must genuinely sit between.
6. **Zero five-gram overlap.** No sequence of 5 consecutive words (after lowercasing and stripping
   punctuation) may repeat anywhere in the corpus, including across your own fixtures. Vary sentence
   openings, verbs, and rhythm. Do not reuse stock phrases.
7. Every chapter paragraph: 40–90 words, one paragraph per chapter, no line breaks inside it.
8. `title` per chapter: 2–5 Indonesian words, unique inside your bank.

## Universe bibles

You author inside exactly one universe. Never borrow the other universe's cast, place, objects,
or vocabulary.

### `pesisir-utara`

- Protagonist: **Sari**, juru catat bongkar-muat at the north-coast port of **Tanjung Rembang**.
- Antagonist: **Regent Damar**, who controls the harbour permit office.
- Supporting: **Bu Hasnah** (pengurus gudang garam), **Latif** (adik Sari, ferry hand),
  **Pak Uweng** (juru timbang), **Nyi Ratih** (pemilik warung dermaga).
- Objects and texture: manifest kapal, timbangan garam, pintu air pasang, lampu suar, tali temali,
  peti ikan asin, karcis feri, cap lilin biru, buku muatan.
- Central conflict: falsified shipping manifests hide conscripted crews on the salt route.
- Register: salt, tide, rope, rust, gull, lamp oil.

### `lembah-awan`

- Protagonist: **Vina**, penjaga benih at the highland terraces of **Lembah Awan**.
- Antagonist: **Mandor Bagas**, who rations the irrigation gates.
- Supporting: **Mbah Ripto** (penjaga saluran tua), **Danu** (kakak Vina, pemetik teh),
  **Bu Ningsih** (guru desa), **Karsa** (penjual bibit keliling).
- Objects and texture: lumbung benih, kanal terasering, kabut pagi, karung goni, jam air,
  arit, tungku pengering, kartu jatah air, daun teh basah.
- Central conflict: water quotas and a contaminated seed store on the upper terraces.
- Register: fog, terrace, mud, soaked burlap, kettle steam, bamboo.

## Rubric axes

| Rubric | Axis the prose must genuinely exhibit or fail |
|---|---|
| D-R1 | Pacing: each chapter changes what the protagonist can do next. WEAK = same worry restated, situation unchanged. BORDERLINE = movement arrives late and slight. |
| D-R2 | Character progression under cost. STRONG = a costly act contradicting an established early habit. WEAK = claims change, repeats the old avoidance. BORDERLINE = attempts new conduct, cost is thin. |
| D-R3 | Conflict escalation: opposition narrows options and makes delay expensive. WEAK = threat restated at the same level. BORDERLINE = a deadline appears, stakes stay half-concrete. |
| D-R4 | Semantic repetition. STRONG = later scene changes tactic, place, information, and emotional result. WEAK = later scene paraphrases the earlier confrontation with no new meaning. BORDERLINE = a deliberate echo that adds one modest consequence. |
| D-R5 | Material chapter purpose. STRONG = route, clue, relationship, or payoff visibly advances. WEAK = atmosphere and chat only. BORDERLINE = a small clue, slight central movement. |
| D-R6 | Setup/payoff proportion across distant chapters. STRONG = payoff uses the exact setup object, costs a choice, changes a relationship. WEAK = the debt closes by announcement, setup detail unused. BORDERLINE = setup referenced, causal bridge compressed. |
| D-R7 | Emotional resolution inside a complete Bab 49. STRONG = protagonist names the changed wound and chooses the relationship or value. WEAK = Bab 49 reaches logistics only, no emotional beat. BORDERLINE = feeling appears but the scene ends before the emotional consequence lands. |
| D-R8 | Ending satisfaction across the Bab 41–50 runway. STRONG = the runway prepares the final choice and Bab 50 answers it with earned aftermath. WEAK = the runway does not prepare it and Bab 50 stops at victory or departure. BORDERLINE = Bab 50 answers, aftermath or runway leaves it under-earned. |

## Chapter surfaces

| Rubric | Chapters (exact order) |
|---|---|
| D-R1 | 18, 19, 20 |
| D-R2 | 9, 15, 22 |
| D-R3 | 41, 43, 46 |
| D-R4 | 14, 15, 16, 32 |
| D-R5 | 24, 25 |
| D-R6 | 6, 21, 34 |
| D-R7 | 45, 48, 49 |
| D-R8 | 41, 42, 43, 44, 45, 46, 47, 48, 49, 50 |

## `justification`

One or two sentences, English, written **for the human reviewer**, never fed to a judge. State the
in-fiction facts that make the tier claim checkable (e.g. "Bab 22 has Sari sign the amended
manifest under her own name after hiding behind Bu Hasnah in Bab 9"). Do not restate the axis text.

## Output shape

Create exactly one file, exporting exactly one bank. Example for `pesisir-utara` / `D-R1`:

```ts
import type { D1AuthoredBank } from '../corpus'

export const PESISIR_UTARA_D_R1: D1AuthoredBank = {
  universeId: 'pesisir-utara',
  rubricId: 'D-R1',
  STRONG: [
    {
      chapters: [
        { chapterNumber: 18, title: 'Pintu Air Menjelang Pasang', paragraphs: ['...'] },
        { chapterNumber: 19, title: '...', paragraphs: ['...'] },
        { chapterNumber: 20, title: '...', paragraphs: ['...'] },
      ],
      justification: '...',
    },
    // 5 total
  ],
  WEAK: [/* 5 */],
  BORDERLINE: [/* 3 */],
}
```

Counts are exact: `STRONG` 5, `WEAK` 5, `BORDERLINE` 3.
Do not edit any file other than the one bank file you were assigned.
