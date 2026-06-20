import { defineConfig } from 'vite';

// In Docker Compose set VITE_API_PROXY=http://api:8000.
const apiTarget = process.env.VITE_API_PROXY || 'http://localhost:7999';

export default defineConfig({
  server: {
    host: true,
    port: 5172,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
    },
  },
});
