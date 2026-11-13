/** @type {import('next').NextConfig} */
const nextConfig = {
  // workspace packages and native/worker-based deps load as plain Node modules on the server
  serverExternalPackages: ["@ft/parsers", "@ft/ingest", "@ft/db", "pdfjs-dist", "postgres", "@node-rs/argon2", "@anthropic-ai/sdk"],
  experimental: {
    serverActions: {
      bodySizeLimit: "20mb", // statement uploads
      // forms posted through a proxy that doesn't forward the original host (e.g. the private
      // HTTPS address set up by ./start.sh phone) are accepted from these hosts only
      allowedOrigins: (process.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    },
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
