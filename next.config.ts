import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb"
    }
  },
  output: "standalone",
  outputFileTracingRoot: process.cwd()
};

export default nextConfig;
