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
    rolldownOptions: {
      external: [
        'electron',
        'better-sqlite3',
        // office-export 经 resource-parse 动态加载原生画布；与 vite.main.config.ts 同样外置，
        // 否则 rolldown 会把 .node 二进制当模块文本加载。
        '@napi-rs/canvas',
        ...builtinModules,
        /^node:/,
      ],
    },
  },
});
const require = createRequire(import.meta.url);
const result = spawnSync(require('electron'), ['.tools/workspace-smoke.cjs'], {
  stdio: 'inherit',
  timeout: 60000,
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
