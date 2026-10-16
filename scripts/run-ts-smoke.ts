// 把 scripts/<name>.ts 打成 CJS 放进 .tools/，再用 Electron 运行。
// 用法：node scripts/run-ts-smoke.ts workspace-smoke | remote-smoke | runtime-smoke
import { build } from 'vite';
import { builtinModules, createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

/** 一项冒烟的打包与运行参数；external 声明不打进 bundle 的模块。 */
interface SmokeConfig {
  external: (string | RegExp)[];
  timeout: number;
  minify?: boolean;
}

const smokes: Record<string, SmokeConfig> = {
  'runtime-smoke': {
    external: ['node-pty', /^@earendil-works\//],
    timeout: 45000,
    minify: false,
  },
  'workspace-smoke': { external: [], timeout: 60000 },
  'remote-smoke': {
    external: [
      // 原生模块必须留在 node_modules：打进 bundle 后 node-pty 找不到自己的 prebuilds。
      'node-pty',
      '@earendil-works/pi-coding-agent',
    ],
    timeout: 180000,
    // 冒烟失败时要看真实函数名，压缩过的堆栈只有 a/b/e。
    minify: false,
  },
};

const name = process.argv[2] ?? '';
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
const result = spawnSync(require('electron') as string, [`.tools/${name}.cjs`], {
  stdio: 'inherit',
  timeout: smoke.timeout,
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
