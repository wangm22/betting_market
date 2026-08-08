import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // A stray lockfile in the home directory otherwise makes Turbopack infer
  // the wrong workspace root.
  turbopack: { root: path.join(__dirname) },
};

export default nextConfig;
