import { build } from 'vite';
import { spawnSync } from 'node:child_process';

await build({
  configFile: false,
  envDir: false,
  logLevel: 'error',
  build: {
    target: 'node24',
    outDir: '.tools/notice-framework',
    emptyOutDir: false,
    minify: false,
    lib: {
      entry: 'experiments/notice-subscriptions/validation/framework/evaluate.ts',
      formats: ['es'],
      fileName: () => 'evaluate.js',
    },
    rolldownOptions: { external: ['cheerio', 'zod', /^node:/] },
  },
});
const child = spawnSync(
  process.execPath,
  ['.tools/notice-framework/evaluate.js', ...process.argv.slice(2)],
  {
    windowsHide: true,
    stdio: 'inherit',
  },
);
if (child.error) throw child.error;
process.exitCode = child.status ?? 1;
