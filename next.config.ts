import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The skill executors read config/skill-registry.json at runtime via fs. Next's
  // output tracing won't detect a computed-path read, so without this the file is
  // absent from the serverless bundle and skill generation 500s on Vercel. Force
  // it into the API function bundles so loadManifest() resolves in production.
  outputFileTracingIncludes: {
    '/api/**': ['./config/skill-registry.json'],
  },
};

export default nextConfig;
