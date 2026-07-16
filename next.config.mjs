/** @type {import('next').NextConfig} */
const isVps = process.env.LAKOKU_DEPLOY === 'vps'

const nextConfig = {
  // VPS Docker uses standalone server.js (no OpenNext/Cloudflare worker).
  ...(isVps ? { output: 'standalone' } : {}),
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig

// Cloudflare local/dev only. Skip on VPS production image builds.
if (!isVps) {
  const { initOpenNextCloudflareForDev } = await import('@opennextjs/cloudflare')
  initOpenNextCloudflareForDev()
}
