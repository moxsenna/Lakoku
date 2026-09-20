import { execSync } from 'node:child_process'

function run(cmd) {
  execSync(cmd, { stdio: 'pipe', cwd: process.cwd(), timeout: 300000 })
}
// Scoped lint over every new/changed push surface. Fails non-zero on violation.
run(
  'npx eslint lib/notifications lib/api/push-client.ts lib/android/push-bridge.ts ' +
    'app/api/push app/api/admin/push app/admin/push components/push components/admin/push ' +
    'scripts/verify-push-db.mjs scripts/verify-push-sender.mjs scripts/verify-push-web.mjs ' +
    'scripts/verify-push-hooks.mjs scripts/verify-push-android.mjs scripts/verify-push-admin.mjs',
)
console.log('push integrity verification passed')
