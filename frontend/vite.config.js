import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Optional sub-path the app is published under, e.g. BASE_PATH=/payrol for
// https://aun.edu.ng/payrol. Empty = the root of the domain. It is baked into
// the build, so it must match BASE_PATH in the backend's environment.
const basePath = (process.env.BASE_PATH || '').trim().replace(/\/+$/, '');

// The app calls the API at the same-origin path <base>/api:
//  - development: this dev server forwards it to the backend (port 5000)
//  - production:  the backend serves this built app AND the API from one origin
export default defineConfig({
  base: `${basePath}/`,
  plugins: [react()],
  server: {
    port: 5173,
    host: 'localhost', // dev server reachable from this computer only
    proxy: { [`${basePath}/api`]: { target: 'http://localhost:5000', changeOrigin: false } },
  },
  build: { outDir: 'dist', sourcemap: false },
});
