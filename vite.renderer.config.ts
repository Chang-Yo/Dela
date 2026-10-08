import { cp } from 'node:fs/promises';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/renderer',
  base: './',
  envDir: false,
  resolve: { alias: { '@': resolve('src/renderer') } },
  define: {
    __PDF_ASSET_DIR__: JSON.stringify(resolve('node_modules/pdfjs-dist').replaceAll('\\', '/')),
  },
  plugins: [
    {
      name: 'pdfjs-assets',
      apply: 'build',
      async closeBundle() {
        for (const directory of ['cmaps', 'standard_fonts', 'wasm'])
          await cp(
            resolve('node_modules/pdfjs-dist', directory),
            resolve('out/renderer/pdfjs', directory),
            { recursive: true },
          );
      },
    },
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
