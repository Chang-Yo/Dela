import { build } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { builtinModules, createRequire } from 'node:module';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

await mkdir('.tools/shuiyuan-perf/input', { recursive: true });
await writeFile(
  '.tools/shuiyuan-perf/input/index.html',
  '<!doctype html><html><head><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0}#root{display:flex;flex-direction:column}</style></head><body><div id="root"></div><script type="module" src="/scripts/shuiyuan-perf-view.tsx"></script></body></html>',
);
await build({
  configFile: false,
  envDir: false,
  logLevel: 'error',
  base: './',
  plugins: [react(), tailwindcss()],
  define: { __PDF_ASSET_DIR__: '""', __FILE_ICONS_DIR__: '""' },
  build: {
    outDir: '.tools/shuiyuan-perf/view',
    emptyOutDir: true,
    rolldownOptions: { input: '.tools/shuiyuan-perf/input/index.html' },
  },
});
if (process.argv[2] === 'capture-before') {
  await cp('.tools/shuiyuan-perf/view', '.tools/shuiyuan-perf/view-before', { recursive: true });
  process.exit(0);
}
if (process.argv[2]?.startsWith('before') && !existsSync('.tools/shuiyuan-perf/view-before'))
  throw new Error('Run capture-before on the baseline source before applying the optimization.');
await build({
  configFile: false,
  envDir: false,
  logLevel: 'error',
  plugins: process.argv[2]?.startsWith('stage2-before')
    ? [
        {
          name: 'baseline-snapshot',
          async load(id) {
            if (id.replaceAll('\\', '/').endsWith('/scripts/shuiyuan-perf.ts')) {
              const source = await readFile(id, 'utf8');
              return source.replace(
                "encryptSnapshotBytes(JSON.stringify({ ...p, id: i + 1 })).toString('base64')",
                'JSON.stringify({ ...p, id: i + 1 })',
              );
            }
            if (id.replaceAll('\\', '/').endsWith('/src/main/shuiyuan/snapshot-files.ts'))
              return `import { writeFile } from 'node:fs/promises';
                export const writeSnapshotBytes = writeFile;
                export const encryptSnapshotBytes = (data) => Buffer.from(data);
                export { readShuiyuanSnapshot, readShuiyuanSnapshotPage, handleShuiyuanSnapshotRequest } from './snapshot';
                import { readShuiyuanSnapshotIndex } from './snapshot';
                export async function findShuiyuanSnapshot(id) {
                  const index = await readShuiyuanSnapshotIndex(id);
                  return index ? { index } : null;
                }`;
            if (id.replaceAll('\\', '/').endsWith('/src/main/shuiyuan/snapshot.ts'))
              return readFile('.tools/shuiyuan-perf/stage2/snapshot.ts', 'utf8');
          },
        },
      ]
    : [],
  build: {
    target: 'node24',
    outDir: '.tools/shuiyuan-perf',
    emptyOutDir: false,
    lib: { entry: 'scripts/shuiyuan-perf.ts', formats: ['cjs'], fileName: () => 'main.cjs' },
    rolldownOptions: { external: ['electron', 'better-sqlite3', ...builtinModules, /^node:/] },
  },
});
const require = createRequire(import.meta.url);
const result = spawnSync(
  require('electron'),
  [resolve('.tools/shuiyuan-perf/main.cjs'), ...process.argv.slice(2)],
  { stdio: 'inherit', timeout: 100000, windowsHide: true },
);
process.exit(result.status ?? 1);
