import { build } from 'vite';
import { builtinModules } from 'node:module';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

await build({
  configFile: false,
  envDir: false,
  build: {
    target: 'node24',
    outDir: '.tools',
    emptyOutDir: false,
    lib: {
      entry: 'scripts/workspace-smoke.ts',
      formats: ['cjs'],
      fileName: () => 'workspace-smoke.cjs',
    },
    rolldownOptions: { external: ['electron', 'better-sqlite3', ...builtinModules, /^node:/] },
  },
});
const require = createRequire(import.meta.url);
const result = spawnSync(require('electron'), ['.tools/workspace-smoke.cjs'], {
  stdio: 'inherit',
  timeout: 60000,
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
