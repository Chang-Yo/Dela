import { spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

export default async function setup() {
  await mkdir(resolve('.tools/notice-subscriptions/remediation'), { recursive: true });
  const result = spawnSync(
    process.execPath,
    ['experiments/notice-subscriptions/run.ts', '--help'],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30_000,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `Notice build exited ${result.status}`);
}
