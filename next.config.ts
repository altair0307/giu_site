import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb"
    }
  },
  output: "standalone",
  outputFileTracingRoot: process.cwd()
};

export default nextConfig;
