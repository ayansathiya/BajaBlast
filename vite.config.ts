import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

// Baked into the bundle so the running UI can state its own version. It's
// compared against the server's version in Settings → System: if the two
// disagree, dist/ is stale and needs `npm run build`.
const build = JSON.parse(readFileSync(new URL('./build.json', import.meta.url), 'utf8')).build;

export default defineConfig({
  plugins: [react()],
  base: './',
  define: {
    __APP_BUILD__: JSON.stringify(build),
  },
  server: {
    port: 5173,
  },
});
