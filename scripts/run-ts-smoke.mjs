// 把 scripts/<name>.ts 打成 CJS 放进 .tools/，再用 Electron 运行。
// 用法：node scripts/run-ts-smoke.mjs workspace-smoke | remote-smoke
import { build } from 'vite';
import { builtinModules, createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const smokes = {
  // office-export 经 resource-parse 动态加载原生画布；与 vite.main.config.ts 同样外置，
  // 否则 rolldown 会把 .node 二进制当模块文本加载。
  'workspace-smoke': { external: ['@napi-rs/canvas'], timeout: 60000 },
  'remote-smoke': {
    external: [
      // 原生模块必须留在 node_modules：打进 bundle 后 node-pty 找不到自己的 prebuilds。
      'node-pty',
      // 只用到 workspace/ipc、remotes 与 terminal；原生画布与 Pi 都是可选路径，外置避免打进产物。
      '@napi-rs/canvas',
      '@earendil-works/pi-coding-agent',
    ],
    timeout: 180000,
    // 冒烟失败时要看真实函数名，压缩过的堆栈只有 a/b/e。
    minify: false,
  },
};

const name = process.argv[2];
const smoke = smokes[name];
if (!smoke) {
  console.error(`未知冒烟：${name}（可选 ${Object.keys(smokes).join(' / ')}）`);
  process.exit(1);
}

await build({
  configFile: false,
  envDir: false,
  build: {
    target: 'node24',
    outDir: '.tools',
    emptyOutDir: false,
    ...(smoke.minify === false ? { minify: false } : {}),
    lib: {
      entry: `scripts/${name}.ts`,
      formats: ['cjs'],
      fileName: () => `${name}.cjs`,
    },
    rolldownOptions: {
      external: ['electron', 'better-sqlite3', ...smoke.external, ...builtinModules, /^node:/],
    },
  },
});
const require = createRequire(import.meta.url);
const result = spawnSync(require('electron'), [`.tools/${name}.cjs`], {
  stdio: 'inherit',
  timeout: smoke.timeout,
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
