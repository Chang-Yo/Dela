import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { builtinModules, createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { expect, it } from 'vitest';

it('renders a user source in a different Node host cwd with explicit existing runtime paths', async () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
  const output = join(
    root,
    'experiments/notice-subscriptions/validation/framework/host-results/build',
  );
  const directory = await mkdtemp(join(tmpdir(), 'dela-notice-host-'));
  const electronPath = createRequire(join(root, 'package.json'))('electron') as string;
  const server = createServer((request, response) => {
    if (request.url === '/rows') {
      response.setHeader('content-type', 'application/json');
      response.end('[1,2]');
      return;
    }
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(`<main><h2>Host announcements</h2><ul></ul></main><script>
      document.title = [typeof require, typeof process, typeof window.electron].join(',');
      setTimeout(async () => {
        const rows = await (await fetch('/rows')).json();
        document.querySelector('ul').innerHTML = rows.map(id =>
          '<li><a href="/notice/' + id + '">Independent host announcement ' + id + '</a></li>').join('');
      }, 100);
    </script>`);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing host server port');
  const url = `http://127.0.0.1:${address.port}/`;
  try {
    for (const [name, entry] of [
      ['host-driver', 'validation/framework/host-driver'],
      ['render-worker', 'render-worker'],
    ])
      await build({
        root,
        configFile: false,
        envDir: false,
        logLevel: 'error',
        build: {
          target: 'node24',
          outDir: output,
          emptyOutDir: false,
          minify: false,
          lib: {
            entry: join(root, `experiments/notice-subscriptions/${entry}.ts`),
            formats: ['es'],
            fileName: () => `${name}.js`,
          },
          rolldownOptions: {
            external: ['electron', 'cheerio', 'zod', ...builtinModules, /^node:/],
          },
        },
      });
    const result = await new Promise<{ status: number | null; stdout: string; stderr: string }>(
      (done, reject) => {
        const child = spawn(
          process.execPath,
          [join(output, 'host-driver.js'), url, electronPath, join(output, 'render-worker.js')],
          { cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
        );
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk: Buffer) => {
          stdout += chunk.toString();
        });
        child.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        child.once('error', reject);
        child.once('close', (status) => done({ status, stdout, stderr }));
      },
    );
    expect(result.status, result.stderr).toBe(0);
    const page = JSON.parse(result.stdout);
    expect(page.cwd).toBe(directory);
    expect(page.pageUrl).toBe(url);
    expect(page.charset).toBe('utf-8');
    expect(page.title).toBe('undefined,undefined,undefined');
    expect(page.candidates).toHaveLength(1);
    expect(page.candidates[0].entries.map((entry: { url: string }) => entry.url)).toEqual([
      url + 'notice/1',
      url + 'notice/2',
    ]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    if (
      dirname(resolve(directory)) === resolve(tmpdir()) &&
      directory.startsWith(join(tmpdir(), 'dela-notice-host-'))
    )
      await rm(directory, { recursive: true, force: true });
  }
}, 20_000);
