// Local Next.js keeps the direct proxy; Cloudflare serves a static export.
const cloudflare = process.env.BUDDHA_CLOUDFLARE_BUILD === '1';
export default cloudflare ? { output: 'export' } : {
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${process.env.BACKEND_URL || 'http://127.0.0.1:8000'}/api/:path*` }];
  },
};
