import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

interface Release {
  tag_name: string;
  draft: boolean;
  immutable: boolean;
  assets: { name: string; size: number; digest: string | null; state: string }[];
}

async function checksum(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export async function publishMacRelease(
  directory: string,
  tag: string,
  sourceSha: string,
  repository: string,
): Promise<void> {
  assert(/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag), 'Invalid release tag');
  assert(/^[0-9a-f]{40}$/.test(sourceSha), 'Invalid source commit');
  assert(repository, 'GH_REPO is required');

  const installers = ['dmg', 'zip'].map((ext) => `Dela-${tag.slice(1)}-mac-arm64.${ext}`);
  const names = [...installers, 'SHA256SUMS-mac-arm64', 'source-commit-mac-arm64.txt'];
  const files = await Promise.all(
    names.map(async (name) => {
      const path = resolve(directory, name);
      const info = await stat(path);
      assert(info.isFile() && info.size > 0, `Empty or invalid artifact: ${name}`);
      return { name, path, size: info.size, digest: await checksum(path) };
    }),
  );
  assert.equal(
    (await readFile(resolve(directory, 'source-commit-mac-arm64.txt'), 'utf8')).trim(),
    sourceSha,
    'Mac artifacts do not match the release source commit',
  );
  const sums = (await readFile(resolve(directory, 'SHA256SUMS-mac-arm64'), 'utf8')).trim();
  assert.equal(
    sums,
    files
      .slice(0, 2)
      .map((file) => `${file.digest}  ${file.name}`)
      .join('\n'),
    'Mac artifact checksums do not match',
  );

  const release = JSON.parse(
    execFileSync('gh', ['api', `repos/${repository}/releases/tags/${tag}`], { encoding: 'utf8' }),
  ) as Release;
  assert.equal(release.tag_name, tag, 'Release tag does not match');
  assert(!release.draft, 'The Windows release must be published before adding Mac installers');

  const pending = files.filter((file) => {
    const existing = release.assets.find((asset) => asset.name === file.name);
    if (!existing) return true;
    assert(
      existing.state === 'uploaded' &&
        existing.size === file.size &&
        existing.digest === `sha256:${file.digest}`,
      `Release asset differs or has no verified digest: ${file.name}. Publish a new version instead of overwriting it.`,
    );
    return false;
  });
  if (pending.length === 0) {
    console.log(`${repository}@${tag}: Mac assets already match`);
    return;
  }
  assert(
    !release.immutable,
    'Immutable releases cannot accept Mac installers after Windows publication',
  );
  execFileSync(
    'gh',
    ['release', 'upload', tag, ...pending.map((file) => file.path), '--repo', repository],
    { stdio: 'inherit' },
  );
  console.log(`${repository}@${tag}: uploaded ${pending.length} Mac assets`);
}

if (import.meta.main) {
  assert(process.env.GH_TOKEN, 'GH_TOKEN is required');
  assert(process.argv[2], 'Usage: node scripts/publish-macos-release.ts <artifact-directory>');
  await publishMacRelease(
    process.argv[2],
    process.env.RELEASE_TAG ?? '',
    process.env.SOURCE_SHA ?? '',
    process.env.GH_REPO ?? '',
  );
}
