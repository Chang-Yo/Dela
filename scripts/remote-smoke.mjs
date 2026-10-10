import { build } from 'vite';
import { builtinModules, createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

await build({
  configFile: false,
  envDir: false,
  build: {
    target: 'node24',
    outDir: '.tools',
    emptyOutDir: false,
    // 冒烟失败时要看真实函数名，压缩过的堆栈只有 a/b/e。
    minify: false,
    lib: {
      entry: 'scripts/remote-smoke.ts',
      formats: ['cjs'],
      fileName: () => 'remote-smoke.cjs',
    },
    rolldownOptions: {
      external: [
        'electron',
        'better-sqlite3',
        // 原生模块必须留在 node_modules：打进 bundle 后 node-pty 找不到自己的 prebuilds。
        'node-pty',
        ...builtinModules,
        /^node:/,
        // 只用到 workspace/ipc、remotes 与 terminal；原生画布与 Pi 都是可选路径，外置避免打进产物。
        '@napi-rs/canvas',
        '@earendil-works/pi-coding-agent',
      ],
    },
  },
});
const require = createRequire(import.meta.url);
const result = spawnSync(require('electron'), ['.tools/remote-smoke.cjs'], {
  stdio: 'inherit',
  timeout: 180000,
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
