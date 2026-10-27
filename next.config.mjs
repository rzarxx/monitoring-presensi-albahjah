/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ['192.168.1.10'],
  experimental: {
    agentUpgrade: 'security',
  },
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
