import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  serverExternalPackages: ["sharp", "mongodb"],
  images: {
    domains: [],
    unoptimized: true,
  },
};

export default nextConfig;
