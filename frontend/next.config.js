/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
  // Prevent constant HMR refreshes on Windows
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        poll: 3000,           // Poll every 3s instead of instant file events
        aggregateTimeout: 1000, // Wait 1s before rebuilding after change
        ignored: /node_modules|\.next/,
      };
    }
    return config;
  },
};

module.exports = nextConfig;
