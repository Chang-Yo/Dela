import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { publishMacRelease } from '../publish-macos-release';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));

const tag = 'v1.3.0';
const sourceSha = 'a'.repeat(40);
const repository = 'example/releases';
let directory: string;
let release: {
  tag_name: string;
  draft: boolean;
  immutable: boolean;
  assets: { name: string; size: number; digest: string | null; state: string }[];
};
let assets: typeof release.assets;
const publish = () => publishMacRelease(directory, tag, sourceSha, repository);
const uploads = () =>
  vi.mocked(execFileSync).mock.calls.filter(([, args]) => args?.[0] === 'release');

beforeEach(async () => {
  vi.resetAllMocks();
  directory = await mkdtemp(join(tmpdir(), 'dela-release-'));
  const files: Record<string, string> = {
    'Dela-1.3.0-mac-arm64.dmg': 'signed dmg fixture',
    'Dela-1.3.0-mac-arm64.zip': 'signed zip fixture',
  };
  files['SHA256SUMS-mac-arm64'] = Object.entries(files)
    .map(([name, data]) => `${createHash('sha256').update(data).digest('hex')}  ${name}\n`)
    .join('');
  files['source-commit-mac-arm64.txt'] = `${sourceSha}\n`;
  assets = [];
  for (const [name, data] of Object.entries(files)) {
    await writeFile(join(directory, name), data);
    assets.push({
      name,
      size: Buffer.byteLength(data),
      digest: `sha256:${createHash('sha256').update(data).digest('hex')}`,
      state: 'uploaded',
    });
  }
  release = { tag_name: tag, draft: false, immutable: false, assets: [] };
  vi.mocked(execFileSync).mockImplementation(() => JSON.stringify(release));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('append Mac assets to an existing release', () => {
  it('uploads only the four Mac assets without changing Windows assets or release metadata', async () => {
    release.assets.push({ name: 'latest.yml', size: 1, digest: null, state: 'uploaded' });
    await writeFile(join(directory, 'latest.yml'), 'must not upload');
    await publish();
    expect(uploads()).toEqual([
      [
        'gh',
        [
          'release',
          'upload',
          tag,
          ...assets.map(({ name }) => join(directory, name)),
          '--repo',
          repository,
        ],
        { stdio: 'inherit' },
      ],
    ]);
    expect(execFileSync).toHaveBeenCalledTimes(2);
  });

  it('retries a partial upload by adding only missing files', async () => {
    release.assets = assets.slice(0, 2);
    await publish();
    expect(uploads()[0]?.[1]).toEqual([
      'release',
      'upload',
      tag,
      ...assets.slice(2).map(({ name }) => join(directory, name)),
      '--repo',
      repository,
    ]);
  });

  it('does nothing when all assets already match, including an immutable release', async () => {
    release.assets = assets;
    release.immutable = true;
    await publish();
    expect(uploads()).toEqual([]);
  });

  it.each(['different', null])(
    'rejects an existing asset with digest %s before uploading anything',
    async (digest) => {
      release.assets = [{ ...assets[3]!, digest }];
      await expect(publish()).rejects.toThrow('instead of overwriting');
      expect(uploads()).toEqual([]);
    },
  );

  it.each(['draft', 'immutable'] as const)(
    'rejects a %s release without uploading',
    async (field) => {
      release[field] = true;
      await expect(publish()).rejects.toThrow();
      expect(uploads()).toEqual([]);
    },
  );

  it('does not create a release if Windows publication has not completed', async () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('HTTP 404');
    });
    await expect(publish()).rejects.toThrow('HTTP 404');
    expect(uploads()).toEqual([]);
  });

  it.each([
    ['source-commit-mac-arm64.txt', `${'b'.repeat(40)}\n`, 'source commit'],
    ['Dela-1.3.0-mac-arm64.zip', 'corrupted download', 'checksums'],
  ])('rejects invalid %s before contacting GitHub', async (name, contents, message) => {
    await writeFile(join(directory, name!), contents!);
    await expect(publish()).rejects.toThrow(message);
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('rejects artifacts from a different version before contacting GitHub', async () => {
    await expect(publishMacRelease(directory, 'v1.4.0', sourceSha, repository)).rejects.toThrow(
      'ENOENT',
    );
    expect(execFileSync).not.toHaveBeenCalled();
  });
});
