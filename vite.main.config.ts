import { builtinModules } from 'node:module';
import { defineConfig } from 'vite';

export default defineConfig({
  envDir: false,
  build: {
    target: 'node24',
    outDir: 'out/main',
    lib: { entry: 'src/main/index.ts', formats: ['cjs'], fileName: () => 'index.cjs' },
    rolldownOptions: {
      external: ['electron', 'better-sqlite3', ...builtinModules, /^node:/],
    },
  },
});
