// Skills 发现/启停/渐进加载（阶段四 §5.3）：frontmatter 解析（CRLF/畸形容忍）、
// 禁用清单持久化、read_skill/read_skill_file 的路径守卫与超限截断。
// 数据库用真实 database.ts（electron app.getPath 指向临时目录）。
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const state = vi.hoisted(() => ({ root: '' }));
vi.mock('electron', () => ({ app: { getPath: () => state.root } }));
import { closeDatabase, getDatabase } from '../../../database';
import { SKILL_HEAD_LIMIT_BYTES, listSkills, setSkillEnabled, skillIndex, skillsDirectory } from '../skills';
import { SKILL_FILE_LIMIT_BYTES, readSkillBody, readSkillFile } from '../skill-tools';
import { readSkillFileTool, readSkillTool } from '../../tools/common/skill-read';

function writeSkill(name: string, markdown: string, files: Record<string, string> = {}) {
  const directory = join(skillsDirectory(), name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'SKILL.md'), markdown);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), content);
  }
}

beforeAll(() => {
  state.root = mkdtempSync(join(tmpdir(), 'dela-skills-'));
  getDatabase()
    .prepare("INSERT OR REPLACE INTO workspace_settings VALUES ('directory', ?)")
    .run(state.root);
});

afterAll(() => {
  closeDatabase();
  rmSync(state.root, { recursive: true, force: true });
});

beforeEach(() => {
  getDatabase().prepare("DELETE FROM workspace_settings WHERE key='skills-disabled'").run();
  rmSync(skillsDirectory(), { recursive: true, force: true });
});

describe('Skill 发现与 frontmatter 解析', () => {
  it('解析 name/description 并把正文（frontmatter 之后）留给 read_skill', () => {
    writeSkill('thesis', '---\nname: thesis\ndescription: 论文写作规范\n---\n\n# 步骤\n先列大纲');
    const skills = listSkills();
    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      name: 'thesis',
      description: '论文写作规范',
      enabled: true,
    });
    expect(skills[0]!.path).toBe(join(skillsDirectory(), 'thesis', 'SKILL.md'));
    expect(readSkillBody('thesis')).toBe('\n# 步骤\n先列大纲');
  });

  it('容忍 CRLF 换行', () => {
    writeSkill('crlf', '---\r\nname: crlf\r\ndescription: 换行容忍\r\n---\r\n\r\n正文');
    expect(listSkills()[0]).toMatchObject({ name: 'crlf', description: '换行容忍' });
    // 正文按 LF 归一（frontmatter 解析按行分割）。
    expect(readSkillBody('crlf')).toBe('\n正文');
  });

  it('无 frontmatter 或缺少闭合 --- 时全文视为正文', () => {
    writeSkill('plain', '# 只有正文');
    writeSkill('unclosed', '---\nname: unclosed\ndescription: 没有闭合');
    expect(listSkills().map(({ name, description }) => ({ name, description }))).toEqual(
      expect.arrayContaining([
        { name: 'plain', description: '' },
        { name: 'unclosed', description: '' },
      ]),
    );
    expect(readSkillBody('plain')).toBe('# 只有正文');
    expect(readSkillBody('unclosed')).toBe('---\nname: unclosed\ndescription: 没有闭合');
  });

  it('跳过非目录条目、无名 SKILL.md 与非法目录名', () => {
    mkdirSync(skillsDirectory(), { recursive: true });
    writeFileSync(join(skillsDirectory(), 'loose.md'), 'x');
    mkdirSync(join(skillsDirectory(), 'no-entry'), { recursive: true });
    mkdirSync(join(skillsDirectory(), 'bad name'), { recursive: true });
    writeFileSync(join(skillsDirectory(), 'bad name', 'SKILL.md'), '---\ndescription: x\n---\n');
    expect(listSkills()).toHaveLength(0);
  });

  it('超大 SKILL.md 只读头部窗口解析 frontmatter（listSkills 不整读全量）', () => {
    writeSkill('big-listed', `---\ndescription: 头部描述\n---\n${'x'.repeat(SKILL_HEAD_LIMIT_BYTES * 2)}`);
    expect(listSkills()[0]).toMatchObject({ name: 'big-listed', description: '头部描述' });
  });
});

describe('read_skill 正文上限', () => {
  it('正文超过 200KB 时截断并在末尾标注', () => {
    writeSkill('big', `---\ndescription: 大\n---\n${'x'.repeat(SKILL_FILE_LIMIT_BYTES + 512)}`);
    const body = readSkillBody('big');
    expect(body).toMatch(/^x+/);
    expect(body).toContain('已截断');
    expect(body.length).toBeGreaterThan(200_000);
    expect(body.length).toBeLessThan(SKILL_FILE_LIMIT_BYTES + 100);
  });
});

describe('Skill 启停与索引', () => {
  it('默认全启用；setSkillEnabled 持久化禁用清单并从索引消失', () => {
    writeSkill('a', '---\ndescription: 甲\n---\n正文');
    writeSkill('b', '---\ndescription: 乙\n---\n正文');
    expect(skillIndex().map(({ name }) => name)).toEqual(['a', 'b']);
    const updated = setSkillEnabled('a', false);
    expect(updated.find(({ name }) => name === 'a')).toMatchObject({ enabled: false });
    expect(skillIndex().map(({ name }) => name)).toEqual(['b']);
    // 持久化事实：workspace_settings 的禁用清单（只存禁用项）。
    const row = getDatabase()
      .prepare("SELECT value FROM workspace_settings WHERE key='skills-disabled'")
      .get() as { value: string };
    expect(JSON.parse(row.value)).toEqual(['a']);
    // 禁用对模型即不可用；重新启用后恢复。
    expect(() => readSkillBody('a')).toThrow(/不存在或已停用/);
    setSkillEnabled('a', true);
    expect(skillIndex()).toHaveLength(2);
  });

  it('未知名抛错', () => {
    writeSkill('a', '---\ndescription: 甲\n---\n正文');
    expect(() => setSkillEnabled('missing', false)).toThrow('Skill 不存在：missing');
  });

  it('read_skill 工具：索引为空时返回明确提示；正常时返回正文', () => {
    expect(readSkillTool.execute({ name: 'whatever' })).toEqual({ note: '当前没有可用 Skill' });
    writeSkill('thesis', '---\ndescription: 论文\n---\n# 正文');
    expect(readSkillTool.execute({ name: 'thesis' })).toEqual({
      name: 'thesis',
      text: '# 正文',
    });
  });
});

describe('read_skill_file 路径守卫', () => {
  beforeEach(() => {
    writeSkill('demo', '---\ndescription: 演示\n---\n正文', {
      'notes/a.md': '# 支持',
      'data.json': '{"k":1}',
      'big.txt': 'x'.repeat(SKILL_FILE_LIMIT_BYTES + 1024),
    });
  });

  it('读取目录内相对文本文件', () => {
    expect(readSkillFile('demo', 'notes/a.md')).toMatchObject({
      name: 'demo',
      path: 'notes/a.md',
      text: '# 支持',
    });
    expect(readSkillFile('demo', 'data.json').text).toBe('{"k":1}');
  });

  it('拒绝绝对路径与 .. 越界', () => {
    for (const path of [
      '/etc/passwd',
      'C:\\x\\y.md',
      '../outside.md',
      'notes/../../x.md',
      'a\\..\\b.md',
      './rel.md',
    ])
      expect(() => readSkillFile('demo', path)).toThrow(/相对路径|\.\.|路径段/);
  });

  it('拒绝非白名单扩展与不存在的文件', () => {
    writeSkill('demo', '---\ndescription: 演示\n---\n正文', { 'img.png': 'x', noext: 'x' });
    expect(() => readSkillFile('demo', 'img.png')).toThrow(/不支持的文件类型/);
    expect(() => readSkillFile('demo', 'noext')).toThrow(/不支持的文件类型/);
    expect(() => readSkillFile('demo', 'missing.md')).toThrow('文件不存在：missing.md');
  });

  it('超过 200KB 上限时截断并在结果中标注', () => {
    const result = readSkillFile('demo', 'big.txt');
    expect(result.truncated).toBe(true);
    expect(result.text).toBe('x'.repeat(SKILL_FILE_LIMIT_BYTES));
    expect(result.sizeBytes).toBe(SKILL_FILE_LIMIT_BYTES + 1024);
    expect((result as { note?: string }).note).toContain('已截断');
  });

  it('工具入口同样走守卫（ToolError 语义）', () => {
    expect(() => readSkillFileTool.execute({ name: 'demo', path: '../escape.md' })).toThrow(
      /相对路径|\.\./,
    );
    expect(() => readSkillFileTool.execute({ name: 'gone', path: 'a.md' })).toThrow(
      /不存在或已停用/,
    );
  });

  it('目录联接（junction）指向 Skill 根外时拒绝读取', () => {
    // Windows 下 junction 无需特权：symlinkSync(type 'junction') 模拟目录联接穿越。
    const outside = mkdtempSync(join(tmpdir(), 'dela-outside-'));
    try {
      writeFileSync(join(outside, 'secret.md'), '外部内容');
      symlinkSync(outside, join(skillsDirectory(), 'demo', 'link'), 'junction');
      expect(() => readSkillFile('demo', 'link/secret.md')).toThrow('路径不能越出 Skill 目录');
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
