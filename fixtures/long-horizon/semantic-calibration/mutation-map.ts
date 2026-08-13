export interface D1ControlledMutationRelation {
  readonly axis: 'RUBRIC_STRENGTH'
  readonly baseFixtureId: string
}

type ControlledMutationGroup = readonly [baseFixtureId: string, ...memberFixtureIds: string[]]

const fixtureId = (universeId: 'lembah-awan' | 'pesisir-utara', rubricId: string, ordinal: string) =>
  `d1-fixture-${universeId}-${rubricId}-${ordinal}`

const group = (
  universeId: 'lembah-awan' | 'pesisir-utara',
  rubricId: string,
  baseOrdinal: string,
  ...memberOrdinals: string[]
): ControlledMutationGroup => [
  fixtureId(universeId, rubricId, baseOrdinal),
  ...memberOrdinals.map((ordinal) => fixtureId(universeId, rubricId, ordinal)),
]

/**
 * Ratified same-spine groups. First fixture is independently authored base;
 * remaining fixtures vary only RUBRIC_STRENGTH and point directly to that base.
 */
export const D1_CONTROLLED_MUTATION_GROUPS: readonly ControlledMutationGroup[] = Object.freeze([
  group('lembah-awan', 'd-r1', 'a1', 'b1', 'c1'),
  group('lembah-awan', 'd-r1', 'a2', 'b2', 'c2'),
  group('lembah-awan', 'd-r1', 'a3', 'b5'),
  group('lembah-awan', 'd-r1', 'a4', 'b4'),
  group('lembah-awan', 'd-r2', 'a1', 'b1', 'c1'),
  group('lembah-awan', 'd-r2', 'a2', 'b2', 'c2'),
  group('lembah-awan', 'd-r2', 'a3', 'b3', 'c3'),
  group('lembah-awan', 'd-r2', 'a4', 'b4'),
  group('lembah-awan', 'd-r2', 'a5', 'b5'),
  group('lembah-awan', 'd-r3', 'a1', 'b1', 'c2'),
  group('lembah-awan', 'd-r3', 'a2', 'b2', 'c1', 'c3'),
  group('lembah-awan', 'd-r3', 'a3', 'b3'),
  group('lembah-awan', 'd-r3', 'a4', 'b4'),
  group('lembah-awan', 'd-r3', 'a5', 'b5'),
  group('lembah-awan', 'd-r4', 'a1', 'b1', 'c1'),
  group('lembah-awan', 'd-r4', 'a2', 'b2', 'c2'),
  group('lembah-awan', 'd-r4', 'a3', 'b3', 'c3'),
  group('lembah-awan', 'd-r4', 'a4', 'b4'),
  group('lembah-awan', 'd-r5', 'a2', 'b2', 'c2'),
  group('lembah-awan', 'd-r6', 'a1', 'b1', 'c1'),
  group('lembah-awan', 'd-r6', 'a2', 'b2', 'c2'),
  group('lembah-awan', 'd-r6', 'a3', 'b3'),
  group('lembah-awan', 'd-r6', 'a4', 'b4'),
  group('lembah-awan', 'd-r6', 'a5', 'b5', 'c3'),
  group('lembah-awan', 'd-r7', 'a3', 'b3', 'c3'),
  group('lembah-awan', 'd-r7', 'a5', 'b5'),
  group('lembah-awan', 'd-r7', 'a4', 'b4'),
  group('lembah-awan', 'd-r7', 'a1', 'c2'),
  group('lembah-awan', 'd-r7', 'b1', 'c1'),
  group('pesisir-utara', 'd-r1', 'a1', 'b1', 'c1'),
  group('pesisir-utara', 'd-r1', 'a4', 'b4'),
  group('pesisir-utara', 'd-r1', 'a5', 'b5', 'c3'),
  group('pesisir-utara', 'd-r1', 'a3', 'b3'),
  group('pesisir-utara', 'd-r1', 'b2', 'c2'),
  group('pesisir-utara', 'd-r2', 'a1', 'b1', 'c1'),
  group('pesisir-utara', 'd-r2', 'a2', 'b2', 'c2'),
  group('pesisir-utara', 'd-r2', 'a3', 'b3'),
  group('pesisir-utara', 'd-r2', 'a4', 'b4', 'c3'),
  group('pesisir-utara', 'd-r2', 'a5', 'b5'),
  group('pesisir-utara', 'd-r3', 'a1', 'b1', 'c1'),
  group('pesisir-utara', 'd-r3', 'a2', 'b3', 'c3'),
  group('pesisir-utara', 'd-r3', 'a3', 'b4'),
  group('pesisir-utara', 'd-r3', 'a4', 'b5'),
  group('pesisir-utara', 'd-r3', 'b2', 'c2'),
  group('pesisir-utara', 'd-r4', 'a1', 'b1'),
  group('pesisir-utara', 'd-r4', 'a3', 'b2'),
  group('pesisir-utara', 'd-r4', 'a2', 'c3'),
  group('pesisir-utara', 'd-r5', 'a5', 'c1'),
  group('pesisir-utara', 'd-r6', 'a2', 'c1'),
  group('pesisir-utara', 'd-r7', 'a5', 'c2'),
  group('pesisir-utara', 'd-r7', 'b1', 'c1'),
  group('pesisir-utara', 'd-r7', 'a3', 'c3'),
])

function buildControlledMutationRegistry(): Readonly<Record<string, D1ControlledMutationRelation>> {
  const registry: Record<string, D1ControlledMutationRelation> = {}
  for (const [baseFixtureId, ...memberFixtureIds] of D1_CONTROLLED_MUTATION_GROUPS) {
    for (const memberFixtureId of memberFixtureIds) {
      if (registry[memberFixtureId]) throw new Error(`Duplicate controlled mutation member: ${memberFixtureId}.`)
      registry[memberFixtureId] = Object.freeze({ axis: 'RUBRIC_STRENGTH', baseFixtureId })
    }
  }
  return Object.freeze(registry)
}

export const D1_CONTROLLED_MUTATIONS = buildControlledMutationRegistry()

const D1_CONTROLLED_MUTATION_BASES = new Set(
  D1_CONTROLLED_MUTATION_GROUPS.map(([baseFixtureId]) => baseFixtureId),
)

/** Independent fixtures get one-fixture families; controlled groups share base family. */
export function d1FixtureFamilyId(fixtureIdValue: string): string {
  const relation = D1_CONTROLLED_MUTATIONS[fixtureIdValue]
  const familyRoot = relation?.baseFixtureId ?? fixtureIdValue
  return familyRoot.replace(/^d1-fixture-/, 'd1-family-')
}

export function isD1ControlledMutationBase(fixtureIdValue: string): boolean {
  return D1_CONTROLLED_MUTATION_BASES.has(fixtureIdValue)
}
