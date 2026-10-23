import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
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
    __FILE_ICONS_DIR__: JSON.stringify(
      resolve('node_modules/material-icon-theme/icons').replaceAll('\\', '/'),
    ),
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
    {
      // 文件图标资产：上游 icons/ 里一半以上是目录图标等文件树用不到的 SVG，按
      // manifest 的 fileExtensions/fileNames 引用集只拷用到的部分。MIT 要求随分发
      // 保留许可文本。
      name: 'file-icons-assets',
      apply: 'build',
      async closeBundle() {
        const themeDir = resolve('node_modules/material-icon-theme');
        const manifest: {
          iconDefinitions: Record<string, { iconPath?: string }>;
          fileExtensions: Record<string, string>;
          fileNames: Record<string, string>;
        } = JSON.parse(await readFile(join(themeDir, 'dist/material-icons.json'), 'utf8'));
        const referenced = new Set(
          [...Object.values(manifest.fileExtensions), ...Object.values(manifest.fileNames)]
            .map((definition) => manifest.iconDefinitions[definition]?.iconPath)
            .filter((path): path is string => Boolean(path))
            .map((path) => basename(path)),
        );
        const outDir = resolve('out/renderer/file-icons');
        await mkdir(outDir, { recursive: true });
        for (const svg of referenced)
          await cp(join(themeDir, 'icons', svg), join(outDir, svg)).catch((error) => {
            throw new Error(`manifest 引用的图标「${svg}」在 icons/ 里不存在: ${error}`);
          });
        const provenance =
          '# 文件图标来源\n\n' +
          '本目录的全部 SVG 来自 material-icon-theme' +
          '（npm 包，由 vite.renderer.config.ts 构建时拷贝）。\n\n---\n\n';
        await writeFile(
          join(outDir, 'LICENSE.md'),
          provenance + (await readFile(join(themeDir, 'LICENSE'), 'utf8')),
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
