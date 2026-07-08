import { z } from 'zod'
import {
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
  const message = publicAuthoringErrorMessage(new Error('No object generated: response did not match schema.'))
  check('schema error tidak bocor ke UI', !/No object generated|schema/i.test(message))
  check('pesan meminta coba ulang', /coba ulang/i.test(message))

  console.log('\ndefault model order:')
  const previousKey = process.env.OPENROUTER_API_KEY
  const previousModels = process.env.AUTHORING_MODELS
  process.env.OPENROUTER_API_KEY = 'test-key'
  delete process.env.AUTHORING_MODELS
  const labels = resolveAuthoringModels().map((candidate) => candidate.label)
  if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY
  else process.env.OPENROUTER_API_KEY = previousKey
  if (previousModels === undefined) delete process.env.AUTHORING_MODELS
  else process.env.AUTHORING_MODELS = previousModels

  check('model release paling stabil dicoba lebih dulu', labels[0] === 'openrouter:openai/gpt-4.1-mini')
  check('fallback deepseek tetap tersedia', labels.includes('openrouter:deepseek/deepseek-v3.2'))
  check('fallback gemini tetap tersedia', labels.includes('openrouter:google/gemini-2.5-flash-lite'))

  console.log(`\n${pass}/${pass + fail} PASS`)
  if (fail > 0) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
