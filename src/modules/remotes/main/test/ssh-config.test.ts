// ~/.ssh/config 解析：只取具体主机作为候选，通配块与 Match 块不算，同名以先出现的为准（与 ssh 一致）。
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const home = vi.hoisted(() => ({ dir: '' }));
vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:os')>()),
  homedir: () => home.dir,
}));

import { parseSshConfig, sshConfigHosts } from '../ssh-config';

afterEach(() => {
  if (home.dir) rmSync(home.dir, { recursive: true, force: true });
  home.dir = '';
});

describe('ssh config 候选', () => {
  it('取具体主机与展示用字段，跳过通配与 Match', () => {
    const hosts = parseSshConfig(`
# 注释
Host gpu gpu-alias
  HostName 10.0.0.5
  User  alice
  Port 2222
Host *.internal !bastion
  User bob
Match host foo
  User nobody
Host gateway
  HostName=gw.example.com  # 行尾注释
Host gpu
  HostName 10.9.9.9
`);
    expect(hosts).toEqual([
      { alias: 'gpu', hostName: '10.0.0.5', user: 'alice', port: 2222 },
      { alias: 'gpu-alias', hostName: '10.0.0.5', user: 'alice', port: 2222 },
      { alias: 'gateway', hostName: 'gw.example.com', user: null, port: null },
    ]);
  });

  it('展开 Include（相对 ~/.ssh，支持末段通配），没有 config 时返回空', () => {
    home.dir = mkdtempSync(join(tmpdir(), 'dela-ssh-'));
    expect(sshConfigHosts()).toEqual([]);
    mkdirSync(join(home.dir, '.ssh', 'config.d'), { recursive: true });
    writeFileSync(join(home.dir, '.ssh', 'config'), 'Include config.d/*\nHost main\n');
    writeFileSync(join(home.dir, '.ssh', 'config.d', 'lab'), 'Host lab\n  User u\n');
    expect(sshConfigHosts().map((host) => host.alias)).toEqual(['lab', 'main']);
  });
});
