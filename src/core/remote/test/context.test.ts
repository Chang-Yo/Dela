// 远端上下文镜像的脱机验证：镜像由测试自造，确认 Pi 收下镜像里的 skills 与 AGENTS.md
// （filePath 指向镜像、AGENTS.md 带远端路径）；真机部分见 context.remote.test.ts。
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ root: '' }));
vi.mock('electron', () => ({
  app: { getPath: () => state.root, isPackaged: false, getAppPath: () => process.cwd() },
}));

import { loadPi } from '../../agent/pi';
import { contextMirrorRoot } from '../context';

const skill = (name: string, description: string, body: string) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;

beforeEach(() => {
  state.root = mkdtempSync(join(tmpdir(), 'dela-context-'));
});
afterEach(() => rmSync(state.root, { force: true, recursive: true }));

describe('镜像内容交给 Pi', () => {
  it('镜像里的 skills 被 Pi 发现，AGENTS.md 按远端路径进入上下文', async () => {
    const mirrorRoot = contextMirrorRoot('r1', 'p1');
    const alpha = join(mirrorRoot, 'repo', '.agents', 'skills', 'alpha');
    mkdirSync(alpha, { recursive: true });
    writeFileSync(join(alpha, 'SKILL.md'), skill('alpha', '仓库技能', 'ALPHA 正文'));
    writeFileSync(join(alpha, 'ref.txt'), '附属文件');

    const pi = await loadPi();
    const loader = new pi.DefaultResourceLoader({
      cwd: '/root/proj',
      agentDir: join(state.root, 'agent'),
      additionalSkillPaths: [join(mirrorRoot, 'repo', '.agents', 'skills')],
      agentsFilesOverride: (base: { agentsFiles: { path: string; content: string }[] }) => ({
        agentsFiles: [...base.agentsFiles, { path: '/root/proj/AGENTS.md', content: '暗号：菠萝' }],
      }),
    });
    // Pi 的默认技能位置（例如本机 ~/.agents/skills）照旧被发现，镜像只是多挂一处。
    const { skills } = loader.getSkills();
    expect(skills.map((entry) => entry.name)).not.toContain('alpha');
    await loader.reload();
    const loaded = loader.getSkills().skills.find((entry) => entry.name === 'alpha')!;
    expect(loaded).toBeDefined();
    // 模型看到的位置就是镜像位置，/skill 展开时本地读它。
    expect(loaded.filePath).toBe(join(alpha, 'SKILL.md'));
    expect(readFileSync(loaded.filePath, 'utf-8')).toContain('ALPHA 正文');
    // 远端 AGENTS.md 排在本地全局上下文之后，路径是远端路径。
    expect(loader.getAgentsFiles().agentsFiles.at(-1)).toEqual({
      path: '/root/proj/AGENTS.md',
      content: '暗号：菠萝',
    });
  }, 60_000);
});
