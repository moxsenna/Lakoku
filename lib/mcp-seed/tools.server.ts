import { z } from 'zod'

export type ToolName =
  | 'seed_assign_novel'
  | 'seed_get_unit_spec'
  | 'seed_submit_unit'
  | 'seed_get_batch_spec'
  | 'seed_submit_units'
  | 'seed_get_novel_status'
  | 'seed_finalize_novel'

const assignSchema = z.object({
  genre: z.string().trim().min(2).max(40),
  judul: z.string().trim().min(3).max(120),
  tagline: z.string().trim().max(200).optional(),
  premis: z.string().trim().min(20).max(800),
  protagonis: z.string().trim().min(2).max(60),
  tropes: z.array(z.string().trim().min(2).max(60)).max(8).optional(),
})

const getUnitSpecSchema = z.object({
  novel_id: z.string().trim().min(1).max(120),
  unit_index: z.number().int().min(0).max(61).optional(),
})

const submitUnitSchema = z.object({
  novel_id: z.string().trim().min(1).max(120),
  unit_index: z.number().int().min(0).max(61),
  prose_markdown: z.string().min(200).max(40_000),
  choice_prompt: z.string().trim().min(8).max(200).optional(),
  choices: z.array(z.object({
    label: z.string().trim().min(4).max(120),
    reaction: z.array(z.string().trim().min(20).max(800)).min(1).max(2),
  })).min(2).max(3).optional(),
})

const getBatchSpecSchema = z.object({
  novel_id: z.string().trim().min(1).max(120),
  count: z.number().int().min(1).max(12).optional(),
})

const batchUnitSchema = z.object({
  unit_index: z.number().int().min(0).max(61),
  prose_markdown: z.string().min(200).max(40_000),
  choice_prompt: z.string().trim().min(8).max(200).optional(),
  choices: z.array(z.object({
    label: z.string().trim().min(4).max(120),
    reaction: z.array(z.string().trim().min(20).max(800)).min(1).max(2),
  })).min(2).max(3).optional(),
})

const submitUnitsSchema = z.object({
  novel_id: z.string().trim().min(1).max(120),
  units: z.array(batchUnitSchema).min(1).max(12),
})

const novelRefSchema = z.object({
  novel_id: z.string().trim().min(1).max(120),
})

const SCHEMAS = {
  seed_assign_novel: assignSchema,
  seed_get_unit_spec: getUnitSpecSchema,
  seed_submit_unit: submitUnitSchema,
  seed_get_batch_spec: getBatchSpecSchema,
  seed_submit_units: submitUnitsSchema,
  seed_get_novel_status: novelRefSchema,
  seed_finalize_novel: novelRefSchema,
} as const

export function toolInputSchema<T extends ToolName>(name: T): (typeof SCHEMAS)[T] {
  return SCHEMAS[name]
}

export function parseToolArguments<T extends ToolName>(name: T, input: unknown): z.infer<(typeof SCHEMAS)[T]> {
  return SCHEMAS[name].parse(input) as z.infer<(typeof SCHEMAS)[T]>
}

/** JSON Schema manual — mirror zod di atas untuk descriptor tools/list. */
function schemaOf(properties: Record<string, unknown>, required: string[]): object {
  return { type: 'object', properties, required, additionalProperties: false }
}

export const SEED_TOOLS: ReadonlyArray<{
  name: ToolName
  description: string
  inputSchema: object
  annotations: { readOnlyHint: boolean }
}> = [
  {
    name: 'seed_assign_novel',
    description: 'Buat draft novel katalog Lakoku baru dan mulai antrean generasi 62 unit. Panggil ini dulu.',
    annotations: { readOnlyHint: false },
    inputSchema: schemaOf({
      genre: { type: 'string', description: 'Salah satu: family_drama, romance, mystery, fantasy_kingdom, slice_of_life, survival_thriller (boleh label Indonesia)' },
      judul: { type: 'string', description: 'Judul novel' },
      tagline: { type: 'string', description: 'Tagline satu kalimat (opsional; default judul)' },
      premis: { type: 'string', description: 'Sinopsis premis 3-6 kalimat' },
      protagonis: { type: 'string', description: 'Nama tokoh utama' },
      tropes: { type: 'array', items: { type: 'string' }, description: 'Maks 8 trope (opsional)' },
    }, ['genre', 'judul', 'premis', 'protagonis']),
  },
  {
    name: 'seed_get_unit_spec',
    description: 'Ambil spesifikasi unit berikutnya (prompt lengkap + choices_directive: agent = sertakan 2-3 choices; ending_lock = tulis reaksi untuk ending_lock_labels; none = tanpa choices). Balas dengan seed_submit_unit.',
    annotations: { readOnlyHint: true },
    inputSchema: schemaOf({
      novel_id: { type: 'string' },
      unit_index: { type: 'integer', minimum: 0, maximum: 61, description: 'Kosong = unit wajib berikutnya' },
    }, ['novel_id']),
  },
  {
    name: 'seed_submit_unit',
    description: 'Kirim prosa unit (judul baris pertama "# ", paragraf dipisah baris kosong) + choices sesuai choices_directive: choice_prompt, lalu 2-3 choices berisi label + reaction (1-2 paragraf per pilihan; total 40-220 kata). Untuk ending_lock, label dikunci server — cukup kirim reaksi berurutan tanpa label.',
    annotations: { readOnlyHint: false },
    inputSchema: schemaOf({
      novel_id: { type: 'string' },
      unit_index: { type: 'integer', minimum: 0, maximum: 61 },
      prose_markdown: { type: 'string' },
      choice_prompt: { type: 'string', description: 'Pertanyaan pilihan ke pembaca (wajib bila choices_directive = agent)' },
      choices: {
        type: 'array',
        description: 'Wajib bila choices_directive = agent atau ending_lock. Untuk ending_lock kirim tepat 3 reaksi berurutan (label diabaikan).',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'Label pilihan (8-120 karakter)' },
            reaction: { type: 'array', items: { type: 'string' }, description: '1-2 paragraf reaksi, total 40-220 kata' },
          },
          required: ['label', 'reaction'],
        },
      },
    }, ['novel_id', 'unit_index', 'prose_markdown']),
  },
  {
    name: 'seed_get_batch_spec',
    description: 'MODE CEPAT: ambil spesifikasi beberapa unit sekaligus (default 8, maks 12) tanpa menunggu per unit. Tulis semua unit di konteksmu lalu kirim sekalian via seed_submit_units.',
    annotations: { readOnlyHint: true },
    inputSchema: schemaOf({
      novel_id: { type: 'string' },
      count: { type: 'integer', minimum: 1, maximum: 12, description: 'Jumlah unit dalam batch (default 8)' },
    }, ['novel_id']),
  },
  {
    name: 'seed_submit_units',
    description: 'MODE CEPAT: kirim beberapa unit sekaligus (maks 12, urut unit_index naik). Tiap unit: prose_markdown + choices sesuai choices_directive spec-nya. Unit yang sudah accepted tidak perlu dikirim ulang.',
    annotations: { readOnlyHint: false },
    inputSchema: schemaOf({
      novel_id: { type: 'string' },
      units: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            unit_index: { type: 'integer', minimum: 0, maximum: 61 },
            prose_markdown: { type: 'string' },
            choice_prompt: { type: 'string' },
            choices: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string' },
                  reaction: { type: 'array', items: { type: 'string' } },
                },
                required: ['label', 'reaction'],
              },
            },
          },
          required: ['unit_index', 'prose_markdown'],
        },
      },
    }, ['novel_id', 'units']),
  },
  {
    name: 'seed_get_novel_status',
    description: 'Progres 62 unit novel katalog: unit tersimpan, berikutnya, dan blocker.',
    annotations: { readOnlyHint: true },
    inputSchema: schemaOf({ novel_id: { type: 'string' } }, ['novel_id']),
  },
  {
    name: 'seed_finalize_novel',
    description: 'Selesaikan novel ke status review bila seluruh 62 unit tersimpan. Publish TIDAK dilakukan oleh tool ini.',
    annotations: { readOnlyHint: false },
    inputSchema: schemaOf({ novel_id: { type: 'string' } }, ['novel_id']),
  },
]
