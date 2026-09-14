import { build } from 'vite';
import { builtinModules, createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

await build({
  configFile: false,
  envDir: false,
  build: {
    target: 'node24',
    outDir: '.tools',
    emptyOutDir: false,
    lib: {
      entry: 'scripts/campus-session-smoke.ts',
      formats: ['es'],
      fileName: () => 'campus-session-smoke.mjs',
    },
    rolldownOptions: { external: ['electron', ...builtinModules, /^node:/] },
  },
});
const require = createRequire(import.meta.url);
const profile = mkdtempSync(join(tmpdir(), 'dela-campus-smoke-'));
if (dirname(resolve(profile)) !== resolve(tmpdir()))
  throw new Error('Unexpected smoke profile path');
try {
  for (const phase of ['save', 'restore', 'cleared']) {
    const result = spawnSync(
      require('electron'),
      ['.tools/campus-session-smoke.mjs', profile, phase],
      {
        stdio: 'inherit',
        timeout: 30000,
      },
    );
    if (result.error || result.status !== 0) throw result.error ?? new Error(`Failed: ${phase}`);
  }
} finally {
  rmSync(profile, { recursive: true, force: true });
}
