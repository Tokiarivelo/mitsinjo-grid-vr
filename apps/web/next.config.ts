import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@mitsinjo/engine'],
  experimental: {
    optimizePackageImports: ['lucide-react', 'recharts', '@react-three/drei'],
  },
  // PQ-T45 §8bis: the QuickJS WASM the sandbox reads at runtime (`readFileSync`, invisible to
  // tracing) must ship with the shape route on Vercel.
  outputFileTracingIncludes: {
    '/api/vision/shape': [
      './node_modules/.pnpm/@jitl+quickjs-wasmfile-release-sync@*/node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm',
    ],
  },
};

export default nextConfig;
