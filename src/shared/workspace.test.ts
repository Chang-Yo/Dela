import { describe, expect, it } from 'vitest';
import { relocateWorkspacePath } from './workspace';

describe('relocateWorkspacePath', () => {
  it('移动 POSIX 子树时保留文件名中的反斜杠，不改同前缀的兄弟文件', () => {
    expect(relocateWorkspacePath('/repo/a/note\\draft.md', '/repo/a', '/repo/b')).toBe(
      '/repo/b/note\\draft.md',
    );
    for (const path of ['/repo/a\\note.md', '/repo/ab/note.md', '/repo/A/note.md'])
      expect(relocateWorkspacePath(path, '/repo/a', '/repo/b')).toBe(path);
  });

  it.each(['C:/repo/a', 'C:\\repo\\a', '\\\\server\\share\\a'])(
    'Windows 路径 %s 保留原有两种分隔符匹配',
    (from) => {
      const to = `${from}-renamed`;
      expect(relocateWorkspacePath(from, from, to)).toBe(to);
      for (const separator of ['/', '\\']) {
        const suffix = `${separator}notes${separator}draft.md`;
        expect(relocateWorkspacePath(`${from}${suffix}`, from, to)).toBe(`${to}${suffix}`);
      }
      expect(relocateWorkspacePath(`${from}-other/file.md`, from, to)).toBe(
        `${from}-other/file.md`,
      );
    },
  );

  it('POSIX 文件名本身含反斜杠时仍可精确重命名', () => {
    expect(relocateWorkspacePath('/repo/a\\note.md', '/repo/a\\note.md', '/repo/b.md')).toBe(
      '/repo/b.md',
    );
  });
});
