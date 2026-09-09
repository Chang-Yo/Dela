import { spawn } from 'node:child_process';
import { build, createServer } from 'vite';
import electron from 'electron';

let child;
let server;
const watchers = [];
let stopping = false;
let restarting;
let initialized = false;

async function stopChild() {
  if (!child || child.exitCode !== null) return;
  const previous = child;
  child = undefined;
  await new Promise((resolve) => {
    previous.once('exit', resolve);
    previous.kill();
  });
}

async function restart() {
  clearTimeout(restarting);
  restarting = setTimeout(async () => {
    await stopChild();
    if (stopping) return;
    child = spawn(
      electron,
      ['.', ...(process.argv.includes('--smoke-test') ? ['--smoke-test'] : [])],
      {
        stdio: 'inherit',
        env: { ...process.env, DELA_DEV_URL: 'http://127.0.0.1:5173' },
      },
    );
    const current = child;
    current.once('exit', (code) => {
      if (child === current) void shutdown(code ?? 1);
    });
    current.once('error', (error) => {
      console.error(error);
      void shutdown(1);
    });
  }, 150);
}

async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  clearTimeout(restarting);
  await stopChild();
  await Promise.all(watchers.map((watcher) => watcher.close()));
  await server?.close();
  process.exitCode = code;
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

try {
  server = await createServer({ configFile: 'vite.renderer.config.ts', mode: 'development' });
  await server.listen();
  for (const configFile of ['vite.main.config.ts', 'vite.preload.config.ts']) {
    const watcher = await build({ configFile, mode: 'development', build: { watch: {} } });
    watchers.push(watcher);
    await new Promise((resolve, reject) => {
      const ready = (event) => {
        if (event.code === 'ERROR') reject(event.error);
        if (event.code === 'END') {
          watcher.off('event', ready);
          resolve();
        }
      };
      watcher.on('event', ready);
    });
    watcher.on('event', (event) => {
      if (event.code === 'END' && initialized) void restart();
      if (event.code === 'ERROR') console.error(event.error);
    });
  }
  initialized = true;
  await restart();
} catch (error) {
  console.error(error);
  await shutdown(1);
}
