import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

interface FrozenFiles {
  files: { file: string; sha256: string }[];
  archiveDescriptorSha256?: string;
}

const directory = 'experiments/notice-subscriptions/validation/framework';
const archiveMode = process.argv[2] === '--archive';
if (archiveMode && !process.argv[3]) throw new Error('请指定 --archive 后的本地归档目录');
const output = resolve(
  process.argv[archiveMode ? 4 : 2] ?? '.tools/notice-framework/integrity-current.json',
);
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const readJson = async (file: string) =>
  JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
const retained = (await readJson(`${directory}/retained-freeze.json`)) as FrozenFiles;
const descriptorBytes = await readFile(`${directory}/archive.json`);
if (hash(descriptorBytes) !== retained.archiveDescriptorSha256)
  throw new Error('归档描述文件与保留集封存值不一致');
const descriptor = JSON.parse(descriptorBytes.toString('utf8')) as {
  manifestSha256: string;
};
let root = process.cwd();
let manifest = retained;
if (archiveMode) {
  const archive = resolve(process.argv[3]!);
  const bytes = await readFile(resolve(archive, 'manifest.json'));
  if (hash(bytes) !== descriptor.manifestSha256) throw new Error('历史归档清单校验失败');
  manifest = JSON.parse(bytes.toString('utf8')) as FrozenFiles;
  root = resolve(archive, 'snapshot');
}
const mismatches: string[] = [];
for (const entry of manifest.files) {
  try {
    if (hash(await readFile(resolve(root, entry.file))) !== entry.sha256)
      mismatches.push(`${entry.file}: SHA256 mismatch`);
  } catch (error) {
    mismatches.push(`${entry.file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
await mkdir(dirname(output), { recursive: true });
let historical: { checked: number; pass: boolean; mismatches: string[] } | undefined;
if (archiveMode && mismatches.length === 0) {
  const historicalOutput = output + '.historical.json';
  const child = spawnSync(
    process.execPath,
    [resolve(root, directory, 'verify.ts'), historicalOutput],
    { cwd: root, windowsHide: true, stdio: 'inherit' },
  );
  if (child.error) throw child.error;
  if (child.status !== 0) mismatches.push('Historical verifier failed');
  else historical = await readJson(historicalOutput);
}
const result = {
  verifiedAt: new Date().toISOString(),
  scope: archiveMode ? 'historical-archive' : 'retained-suite',
  checked: manifest.files.length,
  pass: mismatches.length === 0,
  mismatches,
  ...(historical ? { historical } : {}),
};
await writeFile(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
if (!result.pass) process.exitCode = 1;
