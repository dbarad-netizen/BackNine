/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.NEXT_PUBLIC_API_URL || "https://backnine-hu60.onrender.com"}/api/:path*`,
      },
      {
        source: "/auth/:path*",
        destination: `${process.env.NEXT_PUBLIC_API_URL || "https://backnine-hu60.onrender.com"}/auth/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
