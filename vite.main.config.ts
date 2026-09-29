import { builtinModules } from 'node:module';
import { defineConfig } from 'vite';

export default defineConfig({
  envDir: false,
  build: {
    target: 'node24',
    outDir: 'out/main',
    lib: { entry: 'src/main/index.ts', formats: ['cjs'], fileName: () => 'index.cjs' },
    rolldownOptions: {
      external: [
        'electron',
        // Pi 运行时依赖（docs/refactor/decisions-phase1.md L8）：保持外部 require，
        // 打包时随 node_modules 收进 asar。正则同时覆盖子路径导入
        // （如 pi-ai/api/openai-completions）；rolldown 的字符串 external 不匹配子路径。
        /^@earendil-works\//,
        'openai',
        'typebox',
        '@napi-rs/canvas',
        'better-sqlite3',
        'imapflow',
        'nodemailer',
        ...builtinModules,
        /^node:/,
      ],
    },
  },
});
