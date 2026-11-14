import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { builtinModules, createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'vite';

const base = 'experiments/notice-subscriptions/validation/framework';
await build({
  configFile: false,
  envDir: false,
  logLevel: 'error',
  build: {
    target: 'node24',
    outDir: base + '/evidence',
    emptyOutDir: false,
    minify: false,
    lib: {
      entry: base + '/capture-example.ts',
      formats: ['cjs'],
      fileName: () => 'capture-example.cjs',
    },
    rolldownOptions: { external: ['electron', 'cheerio', 'zod', ...builtinModules, /^node:/] },
  },
});
const electron = createRequire(resolve('package.json'))('electron') as string;
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [resolve(base + '/evidence/capture-example.cjs'), process.cwd()], {
  env,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', (chunk: Buffer) => {
  log += chunk.toString();
});
child.stderr.on('data', (chunk: Buffer) => {
  log += chunk.toString();
});
const timer = setTimeout(() => child.kill(), 20_000);
const status = await new Promise<number | null>((done, reject) => {
  child.once('error', reject);
  child.once('close', done);
});
clearTimeout(timer);
await writeFile(base + '/evidence/capture.log', log);
assert.equal(status, 0, log);
const manifest = JSON.parse(await readFile(base + '/evidence/manifest.json', 'utf8'));
for (const name of ['preview', 'refresh']) {
  const png = await readFile(base + '/evidence/' + name + '.png');
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
}
assert.deepEqual(manifest.result, {
  candidates: 1,
  baselineNewEntries: 0,
  firstRefreshNewEntries: 1,
  secondRefreshNewEntries: 0,
});
await writeFile(
  base + '/evidence/capture-exit.json',
  JSON.stringify({ status, ...manifest.result }, null, 2) + '\n',
);
console.log(JSON.stringify({ status, ...manifest.result }));
