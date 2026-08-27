import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pins the workspace root to this project — otherwise Turbopack's
  // lockfile-scan walks up to an unrelated package.json in the home
  // directory and gets confused about where the project actually lives.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
