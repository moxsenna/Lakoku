import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  M10G_G1_PRICING_METADATA_ENDPOINT,
  createM10GG1PricingSnapshot,
} from '../lib/narrative-qa/contracts/m10-g-g1-pricing-snapshot.contract'

export const M10G_G1_PRICING_HTTP_METHOD = 'GET' as const
export const M10G_G1_PRICING_FIXTURE_PATH = 'fixtures/m10-g/pricing-snapshot-v1.json' as const

function rejectRequestSubstitution(): void {
  if (process.argv.slice(3).length > 0) throw new Error('M10G_G1_PRICING_ARGUMENT_SUBSTITUTION_REJECTED')
  for (const name of ['M10G_G1_PRICING_ENDPOINT', 'M10G_G1_PRICING_METHOD']) {
    if (process.env[name] !== undefined) throw new Error(`M10G_G1_PRICING_SUBSTITUTION_REJECTED:${name}`)
  }
}

export async function fetchM10GG1PricingMetadata(
  transport: typeof fetch = fetch,
  retrievedAt: string = new Date().toISOString(),
) {
  rejectRequestSubstitution()
  const response = await transport(M10G_G1_PRICING_METADATA_ENDPOINT, {
    method: M10G_G1_PRICING_HTTP_METHOD,
    redirect: 'manual',
    headers: { accept: 'application/json' },
  })
  if (response.status !== 200) throw new Error(`M10G_G1_PRICING_METADATA_HTTP_STATUS:${response.status}`)
  if (response.url && response.url !== M10G_G1_PRICING_METADATA_ENDPOINT) {
    throw new Error(`M10G_G1_PRICING_ENDPOINT_REDIRECT_REJECTED:${response.url}`)
  }
  const rawBytes = new Uint8Array(await response.arrayBuffer())
  const rawText = new TextDecoder('utf-8', { fatal: true }).decode(rawBytes)
  const rawResponseSha256 = createHash('sha256').update(rawBytes).digest('hex')
  let rawModelsResponse: unknown
  try {
    rawModelsResponse = JSON.parse(rawText) as unknown
  } catch {
    throw new Error('M10G_G1_PRICING_METADATA_JSON_INVALID')
  }
  return createM10GG1PricingSnapshot({
    retrievedAt,
    rawResponseSha256,
    rawResponseByteLength: rawBytes.byteLength.toString(),
    rawModelsResponse,
  })
}

async function main(): Promise<void> {
  const snapshot = await fetchM10GG1PricingMetadata()
  const outputPath = resolve(process.cwd(), M10G_G1_PRICING_FIXTURE_PATH)
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  console.log(JSON.stringify({
    method: M10G_G1_PRICING_HTTP_METHOD,
    endpoint: M10G_G1_PRICING_METADATA_ENDPOINT,
    authenticated: false,
    retrievedAt: snapshot.retrievedAt,
    rawResponseSha256: snapshot.rawResponseSha256,
    rawResponseByteLength: snapshot.rawResponseByteLength,
    rawRetainedSubsetCanonicalSha256: snapshot.rawRetainedSubsetCanonicalSha256,
    normalizedCanonicalHash: snapshot.normalized.canonicalHash,
    outputPath,
  }))
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
