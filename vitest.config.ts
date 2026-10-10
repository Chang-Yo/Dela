import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': resolve('src/renderer') } },
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*',
      // 本机工具与临时评审脚本的目录（被 Git 忽略）：里面的测试不属于仓库套件。
      '.tools/**',
      // 真机远程套件走 pnpm test:remote，见 vitest.remote.config.ts。
      '**/*.remote.test.ts',
    ],
  },
});
