import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Consente l'accesso al dev server da 127.0.0.1
  allowedDevOrigins: ["127.0.0.1"],

  experimental: {
    serverActions: {
      bodySizeLimit: "100mb", // Increased for large media files
    },
  },

  // Note: For route handlers (.../route.ts files), body size is controlled by
  // the underlying server. For large payloads, consider using streaming or
  // increase Node.js max HTTP header size if needed.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;