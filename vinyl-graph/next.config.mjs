// STATIC_EXPORT=1 builds a static site (GitHub Pages) — API routes are removed
// by the deploy workflow before this build, and the client falls back to
// public/graph.json + localStorage (see lib/runtime.ts).
const isStatic = process.env.STATIC_EXPORT === '1';

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '500mb',
    },
  },
  ...(isStatic
    ? {
        output: 'export',
        basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? '',
        images: { unoptimized: true },
      }
    : {}),
};

export default nextConfig;
