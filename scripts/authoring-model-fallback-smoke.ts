import { z } from 'zod'
import {
  AuthoringGenerationError,
  authorObjectFromCandidates,
  publicAuthoringErrorMessage,
  resolveAuthoringModels,
  type AuthorObjectGenerate,
  type AuthorObjectGenerateArgs,
  type AuthoringModel,
} from '../lib/authoring/model'

let pass = 0
let fail = 0

function check(name: string, cond: boolean) {
  if (cond) {
    pass++
    console.log(`  PASS ${name}`)
  } else {
    fail++
    console.log(`  FAIL ${name}`)
  }
}

const MiniSchema = z.object({
  proposals: z.array(z.object({ title: z.string() })).length(3),
})

async function main() {
  console.log('authoring model fallback:')
  const calls: string[] = []
  const candidates: AuthoringModel[] = [
    { model: 'bad-model', label: 'openrouter:bad-model' },
    { model: 'good-model', label: 'openrouter:good-model' },
  ]
  const generate: AuthorObjectGenerate = async <T>({ model, schema }: AuthorObjectGenerateArgs<T>) => {
    calls.push(String(model))
    if (model === 'bad-model') {
      throw new Error('No object generated: response did not match schema.')
    }
    const object = schema.parse({
      proposals: [
        { title: 'Satu' },
        { title: 'Dua' },
        { title: 'Tiga' },
      ],
    })
    return {
      object,
    }
  }

  const result = await authorObjectFromCandidates(
    { schema: MiniSchema, system: 'system', prompt: 'prompt' },
    candidates,
    generate,
  )

  check('mencoba model pertama lalu model kedua', calls.join(',') === 'bad-model,good-model')
  check('mengembalikan label model yang sukses', result.usedModel === 'openrouter:good-model')
  check('object tervalidasi tetap dikembalikan', result.object.proposals.length === 3)

  console.log('\npublic error message:')
  const schemaError = new Error('No object generated: response did not match schema.')
  const message = publicAuthoringErrorMessage(
    new AuthoringGenerationError(schemaError, [
      `openrouter:bad-model: ${schemaError.message}`,
    ]),
  )
  check('schema error tidak bocor ke UI', !/No object generated|schema/i.test(message))
  check('pesan meminta coba ulang', /coba ulang/i.test(message))
  check(
    'error tak dikenal tetap fail-closed',
    publicAuthoringErrorMessage(schemaError) === 'Terjadi kesalahan tak terduga.',
  )

  console.log('\ndefault model order:')
  const prevOpenRouter = process.env.OPENROUTER_API_KEY
  const prevModels = process.env.AUTHORING_MODELS
  const prevNineUrl = process.env.NINEROUTER_BASE_URL
  const prevNineKey = process.env.NINEROUTER_API_KEY
  const prevCustomUrl = process.env.CUSTOM_LLM_BASE_URL
  const prevCustomKey = process.env.CUSTOM_LLM_API_KEY

  // Uji isolasi OpenRouter (ketika 9router tidak aktif)
  delete process.env.NINEROUTER_BASE_URL
  delete process.env.NINEROUTER_API_KEY
  delete process.env.CUSTOM_LLM_BASE_URL
  delete process.env.CUSTOM_LLM_API_KEY
  delete process.env.AUTHORING_MODELS
  process.env.OPENROUTER_API_KEY = 'test-key'

  const orLabels = resolveAuthoringModels().map((candidate) => candidate.label)
  check('fallback openrouter dicoba bila 9router absen', orLabels[0] === 'openrouter:openai/gpt-4.1-mini')
  check('fallback deepseek tetap tersedia', orLabels.includes('openrouter:deepseek/deepseek-v3.2'))
  check('fallback gemini tetap tersedia', orLabels.includes('openrouter:google/gemini-2.5-flash-lite'))

  // Uji 9router diprioritaskan bila env tersedia
  process.env.NINEROUTER_BASE_URL = 'https://9router.example.com/v1'
  process.env.NINEROUTER_API_KEY = 'test-nine-key'
  const nineLabels = resolveAuthoringModels().map((candidate) => candidate.label)
  check('9router diprioritaskan di urutan pertama', nineLabels[0] === '9router:ag/claude-sonnet-4-6')
  check('9router fallback ke thinking model', nineLabels[1] === '9router:ag/claude-opus-4-6-thinking')

  // Kembalikan env semula
  if (prevOpenRouter !== undefined) process.env.OPENROUTER_API_KEY = prevOpenRouter
  else delete process.env.OPENROUTER_API_KEY
  if (prevModels !== undefined) process.env.AUTHORING_MODELS = prevModels
  else delete process.env.AUTHORING_MODELS
  if (prevNineUrl !== undefined) process.env.NINEROUTER_BASE_URL = prevNineUrl
  else delete process.env.NINEROUTER_BASE_URL
  if (prevNineKey !== undefined) process.env.NINEROUTER_API_KEY = prevNineKey
  else delete process.env.NINEROUTER_API_KEY
  if (prevCustomUrl !== undefined) process.env.CUSTOM_LLM_BASE_URL = prevCustomUrl
  else delete process.env.CUSTOM_LLM_BASE_URL
  if (prevCustomKey !== undefined) process.env.CUSTOM_LLM_API_KEY = prevCustomKey
  else delete process.env.CUSTOM_LLM_API_KEY

  console.log(`\n${pass}/${pass + fail} PASS`)
  if (fail > 0) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
