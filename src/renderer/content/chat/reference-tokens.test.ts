// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { WorkspaceEntry } from '../../../shared/api';
import type { ChatReference } from './drafts';
import { matchReferenceTokens, referenceCandidates, referenceContext } from './reference-tokens';

const ref = (key: string, title = key): ChatReference => ({ key, title });

const options = [
  ref('E:/repo/authAPI.js', 'Test/authAPI.js'),
  ref('E:/repo/meeting notes.md', 'docs/meeting notes.md'),
  ref('E:/repo/readme.md', 'readme.md'),
];

describe('matchReferenceTokens（@token 扫描）', () => {
  it('命中已知 title：区间覆盖 @ 与路径，ref 带绝对路径 key', () => {
    const tokens = matchReferenceTokens('看一下 @Test/authAPI.js 的实现', options);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ start: 4, end: 20, ref: options[0] });
  });

  it('token 前必须是行首或空白：user@host.com 不算引用', () => {
    expect(matchReferenceTokens('联系 user@host.com 确认', options)).toEqual([]);
    expect(matchReferenceTokens('@readme.md 开头', options)).toHaveLength(1);
  });

  it('未知路径、已删除文件只是普通文本', () => {
    expect(matchReferenceTokens('看 @nope.js 和 @missing/x.md', options)).toEqual([]);
  });

  it('title 含空格：跨空格扩展后命中', () => {
    const tokens = matchReferenceTokens('见 @docs/meeting notes.md 的结论', options);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.ref.key).toBe('E:/repo/meeting notes.md');
    expect(tokens[0]!.start).toBe(2);
    expect(tokens[0]!.end).toBe(24);
  });

  it('尾部标点不属于路径：句号、逗号、中文句号均可', () => {
    for (const tail of ['。', ',', '，']) {
      const tokens = matchReferenceTokens(`看 @readme.md${tail}`, options);
      expect(tokens).toHaveLength(1);
      expect(tokens[0]!.ref.title).toBe('readme.md');
    }
  });

  it('中文逗号后紧跟正文（无空格分隔）不解析：@ 菜单插入自带尾随空格，正常路径不受影响', () => {
    expect(matchReferenceTokens('看 @readme.md，谢谢', options)).toEqual([]);
  });

  it('同一文件多次引用各自成 token，不含空格的同名 title 不嵌套误判', () => {
    const tokens = matchReferenceTokens('@readme.md 与 @readme.md', options);
    expect(tokens.map((token) => token.start)).toEqual([0, 13]);
  });

  it('候选为空时直接返回空数组', () => {
    expect(matchReferenceTokens('@readme.md', [])).toEqual([]);
  });
});

describe('referenceContext（发送解析，按 key 去重）', () => {
  it('重复引用同一文件只保留一次，保持出现顺序', () => {
    const refs = referenceContext('@readme.md 和 @Test/authAPI.js 与 @readme.md', options);
    expect(refs).toEqual([options[2], options[0]]);
  });
});

describe('referenceCandidates（@ 候选范围）', () => {
  const entry = (
    id: string,
    path: string,
    kind: WorkspaceEntry['kind'] = 'source',
  ): WorkspaceEntry => ({
    id,
    parentId: null,
    name: path.split('/').pop()!,
    kind,
    sourceId: null,
    path,
    updatedAt: '2026-10-09T00:00:00.000Z',
  });

  // 通用池的 cwd 是工作区根，各项目目录都挂在它下面。
  const tree = [
    entry('n1', 'E:/repo/笔记.md', 'note'),
    entry('dir', 'E:/repo/课程', 'folder'),
    entry('p1', 'E:/repo/Test', 'project'),
    entry('s1', 'E:/repo/Test/authAPI.js'),
    entry('p2', 'E:/repo/ChangYo', 'project'),
    entry('s2', 'E:/repo/ChangYo/main.py'),
    entry('far', 'E:/other/outside.md'),
  ];

  it('通用池只列工作区根下的自有文件，不列别的项目目录里的文件', () => {
    expect(referenceCandidates(tree, 'E:/repo', null)).toEqual([ref('E:/repo/笔记.md', '笔记.md')]);
  });

  it('项目会话列自己项目目录里的文件，title 相对项目目录', () => {
    expect(referenceCandidates(tree, 'E:/repo/Test', 'p1')).toEqual([
      ref('E:/repo/Test/authAPI.js', 'authAPI.js'),
    ]);
  });

  it('cwd 未知（会话快照未到）时不列任何候选', () => {
    expect(referenceCandidates(tree, null, null)).toEqual([]);
  });
});
