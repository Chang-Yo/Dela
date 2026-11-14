import { build } from 'vite';
import { builtinModules } from 'node:module';
import { spawnSync } from 'node:child_process';

const isBenchmark = process.argv[2] === 'benchmark';
const entry = isBenchmark ? 'benchmark-runner' : 'cli';

for (const target of isBenchmark ? [entry] : [entry, 'render-worker'])
  await build({
    configFile: false,
    envDir: false,
    logLevel: 'error',
    build: {
      target: 'node24',
      outDir: '.tools/notice-subscriptions',
      emptyOutDir: false,
      minify: false,
      lib: {
        entry: `experiments/notice-subscriptions/${target}.ts`,
        formats: ['cjs'],
        fileName: () => `${target}.cjs`,
      },
      rolldownOptions: { external: ['electron', 'cheerio', 'zod', ...builtinModules, /^node:/] },
    },
  });
const result = spawnSync(
  process.execPath,
  [`.tools/notice-subscriptions/${entry}.cjs`, ...process.argv.slice(isBenchmark ? 3 : 2)],
  { stdio: 'inherit', windowsHide: true },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
