import { defineConfig } from 'vite';

export default defineConfig({
  envDir: false,
  build: {
    target: 'chrome152',
    outDir: 'out/preload',
    lib: { entry: 'src/app/preload/index.ts', formats: ['cjs'], fileName: () => 'index.cjs' },
    rolldownOptions: { external: ['electron'] },
  },
});
