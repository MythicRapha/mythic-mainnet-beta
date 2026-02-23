/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  // Production domain mapping
  env: {
    NEXT_PUBLIC_SITE_URL: 'https://mythic.sh',
    NEXT_PUBLIC_BRIDGE_URL: 'https://mythic.sh/bridge',
    NEXT_PUBLIC_DOCS_URL: 'https://mythic.sh/docs',
    NEXT_PUBLIC_SWAP_URL: 'https://mythicswap.app',
    NEXT_PUBLIC_LAUNCHPAD_URL: 'https://mythic.money',
    NEXT_PUBLIC_FOUNDATION_URL: 'https://mythic.foundation',
    NEXT_PUBLIC_RPC_URL: 'https://rpc.mythic.sh',
    NEXT_PUBLIC_EXPLORER_URL: 'https://explorer.mythic.sh',
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'mythic.sh' },
      { protocol: 'https', hostname: '*.mythic.sh' },
    ],
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        crypto: false,
        stream: false,
        http: false,
        https: false,
        zlib: false,
        url: false,
      }
    }
    return config
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ]
  },
}

module.exports = nextConfig
