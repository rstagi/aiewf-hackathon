import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages export raw ./src/*.ts with no build step, so Next must
  // transpile them in-place.
  transpilePackages: ["@sia/contract", "@sia/engine", "@sia/sdk", "@sia/seed"],
};

export default nextConfig;
