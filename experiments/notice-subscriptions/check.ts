import { spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';

await mkdir('.tools/notice-framework', { recursive: true });
const framework = 'experiments/notice-subscriptions/validation/framework';
for (const args of [
  [`${framework}/verify.ts`, '.tools/notice-framework/integrity-ci.json'],
  [
    `${framework}/run.ts`,
    `${framework}/development/corpus.json`,
    '.tools/notice-framework/development-ci.json',
  ],
  [
    `${framework}/run.ts`,
    `${framework}/confirmation/corpus.json`,
    '.tools/notice-framework/confirmation-ci.json',
  ],
]) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}
