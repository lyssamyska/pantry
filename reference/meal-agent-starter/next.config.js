/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow images from Pinterest and recipe sites
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.pinimg.com' },
      { protocol: 'https', hostname: '*.wp.com' },
      { protocol: 'https', hostname: '**' },
    ],
  },
};

module.exports = nextConfig;
