import { defineConfig } from 'vite';

const gateway = `http://127.0.0.1:${process.env.GATEWAY_PORT || 8787}`;

export default defineConfig({
  server: {
    port: Number(process.env.PORT) || 5173,
    strictPort: true,
    host: '127.0.0.1',
    proxy: { '/api': { target: gateway, changeOrigin: false } },
  },
  preview: { proxy: { '/api': gateway } },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: { manualChunks: (id) => (id.includes('node_modules/three/') ? 'three' : undefined) },
    },
  },
  worker: { format: 'es' },
});
