import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

function prepareMacosIcons(outputDirectory: string) {
  if (process.platform !== 'darwin') return;
  mkdirSync(outputDirectory, { recursive: true });
  // 与系统图标的可见底板对齐：1024 画布中主体占 824，四周各留 100 透明像素。
  for (const name of ['white', 'black']) {
    const filename = `Dela_${name}_bg.png`;
    const destination = resolve(outputDirectory, filename);
    execFileSync(
      '/usr/bin/sips',
      ['-z', '824', '824', resolve('assets', filename), '--out', destination],
      { stdio: 'pipe' },
    );
    execFileSync('/usr/bin/sips', ['-p', '1024', '1024', destination, '--out', destination], {
      stdio: 'pipe',
    });
  }
}

export default defineConfig({
  envDir: false,
  plugins: [
    {
      name: 'macos-icons',
      buildStart() {
        if (process.platform === 'darwin')
          for (const name of ['white', 'black'])
            this.addWatchFile(resolve('assets', `Dela_${name}_bg.png`));
      },
      writeBundle(output) {
        prepareMacosIcons(resolve(output.dir!, 'icons'));
      },
    },
  ],
  build: {
    target: 'node24',
    outDir: 'out/main',
    lib: { entry: 'src/main/index.ts', formats: ['cjs'], fileName: () => 'index.cjs' },
    rolldownOptions: {
      external: [
        'electron',
        'electron-updater',
        // Pi 运行时依赖：保持外部 require，
        // 打包时随 node_modules 收进 asar。正则同时覆盖子路径导入
        // （如 pi-ai/api/openai-completions）；rolldown 的字符串 external 不匹配子路径。
        /^@earendil-works\//,
        'openai',
        'typebox',
        'better-sqlite3',
        'node-pty',
        'imapflow',
        'nodemailer',
        ...builtinModules,
        /^node:/,
      ],
    },
  },
});
