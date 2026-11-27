import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const workerArgument = process.argv.findIndex((argument) => argument.startsWith('--notice-url='));
const entry = resolve(__dirname, workerArgument < 0 ? 'app.cjs' : 'render-worker.cjs');

if (workerArgument >= 0) {
  process.argv = [process.argv[0]!, entry, ...process.argv.slice(workerArgument)];
}

createRequire(resolve(__dirname, 'index.cjs'))(entry);
