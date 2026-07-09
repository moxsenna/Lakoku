const fs = require('node:fs')
const path = require('node:path')

const mode = process.argv[2]

function replaceOnce(file, from, to, already) {
  const text = fs.readFileSync(file, 'utf8')

  if (already && text.includes(already)) {
    console.log(`patch-opennext-cloudflare: already patched ${file}`)
    return
  }

  if (!text.includes(from)) {
    throw new Error(`Patch target not found in ${file}`)
  }

  fs.writeFileSync(file, text.replace(from, to))
  console.log(`patch-opennext-cloudflare: patched ${file}`)
}

function patchDeps() {
  const cloudflareRoot = path.resolve(
    path.dirname(require.resolve('@opennextjs/cloudflare')),
    '..',
    '..',
  )
  const file = path.join(
    path.dirname(cloudflareRoot),
    'aws',
    'dist',
    'build',
    'copyTracedFiles.js',
  )
  const from = `                if (e.code !== "EEXIST") {
                    throw e;
                }`
  const to = `                if (e.code !== "EEXIST") {
                    if (process.platform === "win32" && e.code === "EPERM") {
                        const target = path.resolve(path.dirname(from), symlink);
                        if (statSync(target).isDirectory()) {
                            symlinkSync(target, to, "junction");
                        }
                        else {
                            copyFileAndMakeOwnerWritable(target, to);
                        }
                        return;
                    }
                    throw e;
                }`

  replaceOnce(file, from, to, 'symlinkSync(target, to, "junction")')
}

/**
 * OpenNext/Next minify output can differ by platform.
 * Prefer a resilient patch for middleware manifest loading.
 */
function patchWorker() {
  const file = path.join(
    process.cwd(),
    '.open-next',
    'server-functions',
    'default',
    'handler.mjs',
  )

  if (!fs.existsSync(file)) {
    throw new Error(`Worker handler not found: ${file}`)
  }

  const text = fs.readFileSync(file, 'utf8')
  const desired =
    'getMiddlewareManifest(){return this.minimalMode?null:MiddlewareManifest}'

  // Already in the desired form.
  if (text.includes(desired)) {
    console.log(`patch-opennext-cloudflare: already patched ${file}`)
    return
  }

  // Exact historical target (Windows OpenNext output).
  const exactFrom =
    'getMiddlewareManifest(){return this.minimalMode?null:require(this.middlewareManifestPath)}'
  if (text.includes(exactFrom)) {
    fs.writeFileSync(file, text.replace(exactFrom, desired))
    console.log(`patch-opennext-cloudflare: patched ${file} (exact)`)
    return
  }

  // Flexible target across minify variants.
  const flexible =
    /getMiddlewareManifest\(\)\s*\{\s*return\s+this\.minimalMode\s*\?\s*null\s*:\s*require\(\s*this\.middlewareManifestPath\s*\)\s*\}/
  if (flexible.test(text)) {
    fs.writeFileSync(file, text.replace(flexible, desired))
    console.log(`patch-opennext-cloudflare: patched ${file} (flexible)`)
    return
  }

  // If require(middlewareManifestPath) is gone entirely, nothing left to patch.
  if (!text.includes('require(this.middlewareManifestPath)')) {
    console.log(
      `patch-opennext-cloudflare: no middlewareManifestPath require found in ${file}; skipping`,
    )
    return
  }

  throw new Error(
    `Patch target not found in ${file}. Handler still requires this.middlewareManifestPath but form is unknown.`,
  )
}

if (mode === 'deps') {
  patchDeps()
} else if (mode === 'worker') {
  patchWorker()
} else {
  throw new Error('Usage: node scripts/patch-opennext-cloudflare.cjs <deps|worker>')
}
