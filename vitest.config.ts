import { delimiter, resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': resolve('src/renderer') } },
  define: {
    __FILE_ICONS_DIR__: JSON.stringify(
      resolve('node_modules/material-icon-theme/icons').replaceAll('\\', '/'),
    ),
  },
  test: {
    // 单元测试不启动 Electron，也需能找到应用随包分发的搜索工具。
    env: {
      PATH: [
        resolve('vendor/bin', process.platform === 'darwin' ? `darwin-${process.arch}` : ''),
        process.env.PATH ?? '',
      ].join(delimiter),
    },
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*',
      '.tools/**',
      '**/*.remote.test.ts',
    ],
  },
});
