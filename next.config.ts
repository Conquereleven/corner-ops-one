import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root to this project (a lockfile higher up the tree would otherwise be picked).
  turbopack: { root: __dirname },
  poweredByHeader: false,
};

export default nextConfig;
