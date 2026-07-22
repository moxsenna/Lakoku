/** @type {import('next').NextConfig} */
const nextConfig = {
  // VPS Docker runs the standalone server (`node server.js`).
  output: 'standalone',
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
