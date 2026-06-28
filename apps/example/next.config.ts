import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages export raw ./src/*.ts with no build step, so Next must
  // transpile them in-place.
  transpilePackages: ["@sia/contract", "@sia/engine", "@sia/sdk", "@sia/seed"],
  // @ratel-ai/sdk ships a native NAPI-RS binary — it must be require()d at runtime
  // in the Node server, never bundled by Next/Turbopack.
  serverExternalPackages: ["@ratel-ai/sdk"],
};

export default nextConfig;
