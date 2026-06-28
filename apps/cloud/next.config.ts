import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages export raw ./src/*.ts with no build step, so Next must
  // transpile them in-place.
  transpilePackages: ["@sia/contract", "@sia/engine", "@sia/sdk", "@sia/seed"],
  // The mongodb driver and its optional native peers (kerberos, snappy, …) must not be
  // bundled — keep it external so it's require()d at runtime in the Node server.
  serverExternalPackages: ["mongodb"],
};

export default nextConfig;
