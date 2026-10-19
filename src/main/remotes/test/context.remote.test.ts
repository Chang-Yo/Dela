// 远端上下文镜像的真机验证（含 bash 命令正文里的镜像路径翻译）。
// 需要 DELA_REMOTE_HOST（如 root@1.2.3.4），由 pnpm test:remote 运行，不在默认 pnpm test 与 CI 里。
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ root: '' }));
vi.mock('electron', () => ({
  app: { getPath: () => state.root, isPackaged: false, getAppPath: () => process.cwd() },
}));

import { contextMirrorRoot, syncRemoteContext, uploadSkillToRemote } from '../context';
import { mirrorCommandText, remoteOperations, remotePath, setContextMirrors } from '../operations';
import { shellQuote, type RemoteTarget } from '../transport';

const skill = (name: string, description: string, body: string) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;

beforeEach(() => {
  state.root = mkdtempSync(join(tmpdir(), 'dela-context-'));
});
afterEach(() => rmSync(state.root, { force: true, recursive: true }));

const target: RemoteTarget = {
  host: process.env.DELA_REMOTE_HOST!,
  keyPath: process.env.DELA_REMOTE_KEY ?? null,
};

describe('远端上下文镜像（真机）', () => {
  const ops = remoteOperations(target);
  const root = `/tmp/dela-context-${Date.now()}`;
  const remoteDir = `${root}/nested/proj`;
  const home = `${root}/home`;
  // 仓库内两处技能 + 服务器主目录一处技能，加上祖先目录的上下文文件。
  const repoSkillFiles: [string, string][] = [
    ['.agents/skills/alpha/SKILL.md', skill('alpha', '仓库原生技能', 'ALPHA 正文')],
    ['.agents/skills/alpha/ref/note.txt', '附属文件\n'],
    ['.dela/skills/beta/SKILL.md', skill('beta', 'Dela 仓库技能', 'BETA 正文')],
  ];
  const serverSkillFile: [string, string] = [
    '.dela/skills/gamma/SKILL.md',
    skill('gamma', '服务器共享技能', 'GAMMA 正文'),
  ];

  beforeAll(async () => {
    await ops.bash.exec(`mkdir -p ${shellQuote(root)} && rm -rf ${shellQuote(root)}`, '/', {
      onData: () => {},
    });
    for (const [path, content] of repoSkillFiles) {
      await ops.write.writeFile(`${remoteDir}/${path}`, content);
    }
    await ops.write.writeFile(`${home}/${serverSkillFile[0]}`, serverSkillFile[1]);
    await ops.write.writeFile(`${remoteDir}/AGENTS.md`, '暗号：菠萝\n');
    await ops.write.writeFile(`${root}/nested/CLAUDE.md`, '祖先暗号：椰子\n');
  }, 240_000);

  afterAll(async () => {
    await ops.bash.exec(`rm -rf ${shellQuote(root)}`, '/', { onData: () => {} });
    setContextMirrors('live:test', []);
  }, 240_000);

  it('三处技能与 AGENTS.md 回填镜像，镜像路径翻得回远端', async () => {
    const context = await syncRemoteContext({
      target,
      key: 'live:test',
      remoteId: 'r1',
      projectId: 'p1',
      remoteDir,
      home,
    });
    const mirror = contextMirrorRoot('r1', 'p1');
    expect(context.skillPaths).toEqual([
      join(mirror, 'repo', '.agents', 'skills'),
      join(mirror, 'repo', '.dela', 'skills'),
      join(mirror, 'home', '.dela', 'skills'),
    ]);

    // 逐字节一致：/skill 展开读的就是这几个镜像文件。
    for (const [path, content] of repoSkillFiles) {
      const mirrored = join(mirror, 'repo', path);
      expect(existsSync(mirrored), mirrored).toBe(true);
      expect(readFileSync(mirrored, 'utf-8'), path).toBe(content);
    }
    const serverMirrored = join(mirror, 'home', serverSkillFile[0]);
    expect(readFileSync(serverMirrored, 'utf-8')).toBe(serverSkillFile[1]);

    // AGENTS.md 记的是远端路径；祖先目录的 CLAUDE.md 排在 cwd 之前（Pi 的注入顺序）。
    expect(context.agentsFiles.at(-1)).toEqual({
      path: `${remoteDir}/AGENTS.md`,
      content: '暗号：菠萝\n',
    });
    expect(context.agentsFiles.map((file) => file.path).slice(-2)).toEqual([
      `${root}/nested/CLAUDE.md`,
      `${remoteDir}/AGENTS.md`,
    ]);

    // 镜像路径 → 远端真身（read/write/edit 与 ls/find/grep 都走同一个收口）。
    expect(remotePath(join(mirror, 'repo', '.agents', 'skills', 'alpha', 'SKILL.md'))).toBe(
      `${remoteDir}/.agents/skills/alpha/SKILL.md`,
    );
    expect(remotePath(join(mirror, 'home', serverSkillFile[0]))).toBe(
      `${home}/${serverSkillFile[0]}`,
    );
    // 远端绝对路径不受映射影响。
    expect(remotePath('/etc/hosts')).toBe('/etc/hosts');

    // bash 命令正文里的镜像路径同样翻译（模型可能直接 cat 技能的 location）。
    const mirrorFile = join(mirror, 'repo', '.agents', 'skills', 'alpha', 'ref', 'note.txt');
    expect(mirrorCommandText(`cat ${mirrorFile}`)).toBe(
      `cat ${remoteDir}/.agents/skills/alpha/ref/note.txt`,
    );
    const chunks: Buffer[] = [];
    const result = await ops.bash.exec(`cat ${mirrorFile}`, '/', {
      onData: (chunk) => chunks.push(chunk),
    });
    expect(result.exitCode, mirrorCommandText(`cat ${mirrorFile}`)).toBe(0);
    expect(Buffer.concat(chunks).toString('utf8').trim()).toBe('附属文件');
  }, 240_000);

  it('未指定 home 时用远端 $HOME，缺目录不报错', async () => {
    const context = await syncRemoteContext({
      target,
      key: 'live:test',
      remoteId: 'r2',
      projectId: 'p2',
      remoteDir,
    });
    const mirror = contextMirrorRoot('r2', 'p2');
    expect(context.skillPaths.slice(0, 2)).toEqual([
      join(mirror, 'repo', '.agents', 'skills'),
      join(mirror, 'repo', '.dela', 'skills'),
    ]);
    expect(context.agentsFiles.some((file) => file.content === '暗号：菠萝\n')).toBe(true);
  }, 240_000);

  it('上传本地技能：逐字节一致、进 git status、同名要确认', async () => {
    const read = async (path: string) => {
      const chunks: Buffer[] = [];
      const result = await ops.bash.exec(`cat ${shellQuote(path)}`, '/', {
        onData: (chunk) => chunks.push(chunk),
      });
      expect(result.exitCode, path).toBe(0);
      return Buffer.concat(chunks);
    };
    const local = join(state.root, 'lint');
    mkdirSync(join(local, 'scripts'), { recursive: true });
    writeFileSync(join(local, 'SKILL.md'), skill('lint', '本地技能', 'LINT 正文'));
    writeFileSync(join(local, 'scripts/run.sh'), '#!/bin/sh\necho 远端执行\n');
    await ops.bash.exec(
      `rm -rf ${shellQuote(remoteDir)}/.dela/skills/lint && git -C ${shellQuote(remoteDir)} init -q`,
      '/',
      { onData: () => {} },
    );

    const uploaded = await uploadSkillToRemote({
      target,
      skillDir: local,
      name: 'lint',
      remoteDir,
      overwrite: false,
    });
    expect(uploaded).toEqual({ path: `${remoteDir}/.dela/skills/lint`, files: 2 });
    for (const file of ['SKILL.md', 'scripts/run.sh']) {
      expect(
        (await read(`${remoteDir}/.dela/skills/lint/${file}`)).equals(
          readFileSync(join(local, file)),
        ),
        file,
      ).toBe(true);
    }

    const status: Buffer[] = [];
    await ops.bash.exec(`git -C ${shellQuote(remoteDir)} status --porcelain -uall`, '/', {
      onData: (chunk) => status.push(chunk),
    });
    expect(Buffer.concat(status).toString('utf8')).toContain('.dela/skills/lint/SKILL.md');

    // 同名先拦下来（渲染端据此弹二次确认），覆盖后再传就换掉正文。
    await expect(
      uploadSkillToRemote({ target, skillDir: local, name: 'lint', remoteDir, overwrite: false }),
    ).rejects.toThrow(/^远端已存在：/);
    writeFileSync(join(local, 'SKILL.md'), skill('lint', '本地技能', '改过的正文'));
    await uploadSkillToRemote({
      target,
      skillDir: local,
      name: 'lint',
      remoteDir,
      overwrite: true,
    });
    expect((await read(`${remoteDir}/.dela/skills/lint/SKILL.md`)).toString('utf8')).toContain(
      '改过的正文',
    );
  }, 240_000);
});
