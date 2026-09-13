import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/renderer',
  base: './',
  envDir: false,
  plugins: [
    tailwindcss(),
    react(),
    {
      name: 'development-csp',
      apply: 'serve',
      transformIndexHtml(html) {
        // React Refresh injects an inline preamble in development only.
        return html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'");
      },
    },
  ],
  build: { target: 'chrome152', outDir: '../../out/renderer', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
});
