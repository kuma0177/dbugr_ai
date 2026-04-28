/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@feedbackagent/shared'],
  async headers() {
    return [
      {
        // Allow inject.js to be fetched from any origin (bookmarklet running on HTTPS sites)
        source: '/inject.js',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
