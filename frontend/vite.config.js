import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Sub-path the app is published under:
//  - `npm run build` (production)  → /payrol/  (from .env.production)
//  - `npm run dev`   (development) → /         (from .env.development)
// A BASE_PATH shell/Docker build variable overrides both. The value is baked
// into the build, so it must match BASE_PATH in the backend's environment.
export default defineConfig(({ mode }) => {
  const fileEnv = loadEnv(mode, process.cwd(), 'VITE_');
  const basePath = (process.env.BASE_PATH || fileEnv.VITE_BASE_PATH || '').trim().replace(/\/+$/, '');

  // The app calls the API at the same-origin path <base>/api:
  //  - development: this dev server forwards it to the backend (port 5000)
  //  - production:  the backend serves this built app AND the API from one origin
  return {
    base: `${basePath}/`,
    plugins: [react()],
    server: {
      port: 5173,
      host: 'localhost', // dev server reachable from this computer only
      proxy: { [`${basePath}/api`]: { target: 'http://localhost:5000', changeOrigin: false } },
    },
    build: { outDir: 'dist', sourcemap: false },
  };
});
