/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  api: {
    bodyParser: {
      sizeLimit: "2mb",
    },
    responseLimit: false,
  },
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
        ],
      },
    ];
  },
  output: "standalone",
  typescript: {
    ignoreBuildErrors: false,
  },
};

module.exports = nextConfig;
