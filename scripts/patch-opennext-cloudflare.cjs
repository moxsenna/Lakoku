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

function patchWorker() {
  const file = path.join(
    process.cwd(),
    '.open-next',
    'server-functions',
    'default',
    'handler.mjs',
  )
  const from =
    'getMiddlewareManifest(){return this.minimalMode?null:require(this.middlewareManifestPath)}'
  const to = 'getMiddlewareManifest(){return this.minimalMode?null:MiddlewareManifest}'

  replaceOnce(file, from, to, to)
}

if (mode === 'deps') {
  patchDeps()
} else if (mode === 'worker') {
  patchWorker()
} else {
  throw new Error('Usage: node scripts/patch-opennext-cloudflare.cjs <deps|worker>')
}
