import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // Standalone output is for the Docker image only — locally `npm start`
  // and the e2e script keep using the regular server.
  ...(process.env.BUILD_STANDALONE === "1" ? { output: "standalone" as const } : {}),
  // A stray lockfile in the home directory otherwise makes Turbopack infer
  // the wrong workspace root.
  turbopack: { root: path.join(__dirname) },
};

export default nextConfig;
