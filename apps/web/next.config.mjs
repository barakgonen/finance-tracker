/** @type {import('next').NextConfig} */
const nextConfig = {
  // workspace packages and native/worker-based deps load as plain Node modules on the server
  serverExternalPackages: ["@ft/parsers", "@ft/ingest", "@ft/db", "pdfjs-dist", "postgres", "@node-rs/argon2"],
  experimental: {
    serverActions: { bodySizeLimit: "20mb" }, // statement uploads
  },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
