import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  devIndicators: false,
  experimental: { proxyTimeout: 330000 },
  async rewrites() { return [{source:'/api/:path*',destination:'http://127.0.0.1:8000/api/:path*'}] },
};
export default nextConfig;
