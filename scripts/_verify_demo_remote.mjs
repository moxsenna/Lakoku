import fs from 'node:fs'

function loadEnv(path) {
  const out = {}
  for (const line of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) {
      v = v.slice(1, -1)
    }
    out[m[1]] = v
  }
  return out
}

const env = { ...loadEnv('.dev.vars'), ...loadEnv('.env.local') }
const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY

for (const num of [1, 2, 3, 12, 32, 50]) {
  const u = `${url}/rest/v1/chapters?story_id=eq.demo%3Aselasa-akhir&number=eq.${num}&select=number,title,choice_prompt,choices,paragraphs`
  const res = await fetch(u, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  const row = (await res.json())[0]
  const words = (row?.paragraphs || []).join(' ').split(/\s+/).filter(Boolean).length
  console.log(JSON.stringify({
    number: row?.number,
    title: row?.title,
    paras: row?.paragraphs?.length,
    words,
    choicePrompt: row?.choice_prompt,
    choices: row?.choices?.map((c) => c.label),
    sample: row?.paragraphs?.slice(0, 3),
  }, null, 2))
}
