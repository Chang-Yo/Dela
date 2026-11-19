// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { WorkspaceEntry } from '../../../workspace/contract';
import type { ChatReference } from '../drafts';
import {
  matchReferenceTokens,
  referenceCandidates,
  referenceContext,
  referenceEntryCandidates,
  sessionReferences,
  withCourseReferences,
} from '../reference-tokens';

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

  it('同一文件多次引用各自成 token，不含空格的同名 title 不嵌套误判', () => {
    const tokens = matchReferenceTokens('@readme.md 与 @readme.md', options);
    expect(tokens.map((token) => token.start)).toEqual([0, 13]);
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
    entry('n1', 'E:/repo/笔记.md', 'file'),
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

  it('父子项目都能引用自己目录下的文件，子项目登记不会屏蔽父项目候选', () => {
    const a = 'D:/Downloads/hw1-flights';
    const b = `${a}/hw1-flights`;
    const entries = [
      entry('A', a, 'project'),
      entry('B', b, 'project'),
      entry('pdf', `${a}/HW1.pdf`, 'file'),
      entry('sql', `${b}/setup.sql`, 'file'),
    ];
    expect(referenceCandidates(entries, a, 'A')).toEqual([
      ref(`${a}/HW1.pdf`, 'HW1.pdf'),
      ref(`${b}/setup.sql`, 'hw1-flights/setup.sql'),
    ]);
    expect(referenceCandidates(entries, b, 'B')).toEqual([ref(`${b}/setup.sql`, 'setup.sql')]);
    expect(referenceCandidates(entries, a, null)).toEqual([]);
  });

  it('POSIX 路径区分大小写，不混入同名异大小写项目的文件', () => {
    const entries = [
      entry('own', '/repo/Project', 'project'),
      entry('foreign', '/repo/project', 'project'),
      entry('s1', '/repo/Project/readme.md'),
      entry('s2', '/repo/project/readme.md'),
    ];
    expect(referenceCandidates(entries, '/repo/Project', 'own')).toEqual([
      ref('/repo/Project/readme.md', 'readme.md'),
    ]);
  });
});

describe('withCourseReferences', () => {
  it('并入课件候选：title 冲突时工作区文件优先', () => {
    const local = [ref('E:/repo/笔记.md', '笔记.md')];
    expect(
      withCourseReferences(local, [
        { path: 'C:/courses/软件工程/files/lec1.pdf', title: '软件工程/files/lec1.pdf' },
        { path: 'E:/repo/笔记.md', title: '笔记.md' },
      ]),
    ).toEqual([
      ref('E:/repo/笔记.md', '笔记.md'),
      ref('C:/courses/软件工程/files/lec1.pdf', '软件工程/files/lec1.pdf'),
    ]);
  });

  it('本地候选为空时课件就是全部候选；课件清单为空则不新增', () => {
    expect(withCourseReferences([], [{ path: 'C:/a.pdf', title: '课/a.pdf' }])).toEqual([
      ref('C:/a.pdf', '课/a.pdf'),
    ]);
    const local = [ref('E:/repo/笔记.md', '笔记.md')];
    expect(withCourseReferences(local, [])).toEqual([ref('E:/repo/笔记.md', '笔记.md')]);
  });
});

describe('referenceCandidates（通用池并入资料根目录）', () => {
  const file = (path: string, kind: WorkspaceEntry['kind'] = 'file'): WorkspaceEntry => ({
    id: path,
    parentId: null,
    name: path.split('/').pop()!,
    kind,
    sourceId: null,
    path,
    updatedAt: '2026-10-09T00:00:00.000Z',
  });
  const workspace = '/data/Dela/workspace';
  const privateDirectory = '/data/Dela/chat-sessions/s1';

  it('资料根目录下的文件进候选，title 相对资料根目录；资料里项目的文件不进', () => {
    const entries = [
      file(`${workspace}/笔记.md`),
      file(`${workspace}/课程/大纲.md`),
      file(`${workspace}/repo`, 'project'),
      file(`${workspace}/repo/src/main.ts`),
    ];
    expect(referenceCandidates(entries, privateDirectory, null, workspace)).toEqual([
      ref(`${workspace}/笔记.md`, '笔记.md'),
      ref(`${workspace}/课程/大纲.md`, '课程/大纲.md'),
    ]);
  });

  it('title 冲突时 cwd 下的文件优先', () => {
    const entries = [file(`${workspace}/notes.md`), file(`${privateDirectory}/notes.md`)];
    expect(referenceCandidates(entries, privateDirectory, null, workspace)).toEqual([
      ref(`${privateDirectory}/notes.md`, 'notes.md'),
    ]);
  });

  it('项目会话不并入资料根目录', () => {
    const entries = [file(`${workspace}/笔记.md`)];
    expect(referenceCandidates(entries, '/data/repo', 'p1', workspace)).toEqual([]);
  });

  it('referenceEntryCandidates 的通用池按 cwd、资料、课件的顺序合并', () => {
    const entries = [file(`${workspace}/笔记.md`), file(`${privateDirectory}/草稿.md`)];
    expect(
      referenceEntryCandidates(
        entries,
        privateDirectory,
        null,
        null,
        [],
        [{ path: '/data/Dela/courses/软件工程/lec1.pdf', title: '软件工程/lec1.pdf' }],
        workspace,
      ),
    ).toEqual([
      ref(`${privateDirectory}/草稿.md`, '草稿.md'),
      ref(`${workspace}/笔记.md`, '笔记.md'),
      ref('/data/Dela/courses/软件工程/lec1.pdf', '软件工程/lec1.pdf'),
    ]);
  });
});

describe('# 会话引用', () => {
  const session = (id: string, title: string, updatedAt: string, createdAt = updatedAt) => ({
    id,
    title,
    updatedAt,
    createdAt,
  });

  it('候选是同池的其他会话，最近更新的在前；重名的缀上创建时间，文本仍唯一', () => {
    const refs = sessionReferences(
      [
        session('a', '复习计划', '2026-11-01T08:00:00', '2026-11-01T08:00:00'),
        session('self', '当前会话', '2026-11-06T08:00:00'),
        session('b', '期中整理', '2026-11-04T08:00:00'),
        session('c', '复习计划', '2026-11-05T09:12:00', '2026-11-03T14:20:00'),
      ],
      'self',
    );
    expect(refs).toEqual([
      { key: 'c', title: '复习计划 · 11-03 14:20', session: true },
      { key: 'b', title: '期中整理', session: true },
      { key: 'a', title: '复习计划 · 11-01 08:00', session: true },
    ]);
  });

  it('#标题 解析成会话；「# 」Markdown 标题、C# 与 @ 同名都不算', () => {
    const refs: ChatReference[] = [
      { key: 's1', title: '怎么复习？', session: true },
      { key: 's2', title: '期中 整理', session: true },
      ref('/p/怎么复习？'),
    ];
    expect(referenceContext('对比 #怎么复习？ 和 #期中 整理。', refs)).toEqual([refs[0], refs[1]]);
    expect(matchReferenceTokens('# 怎么复习？\n学 C#怎么复习？', refs)).toEqual([]);
    expect(matchReferenceTokens('#怎么复习？。', refs)).toMatchObject([{ start: 0, end: 6 }]);
  });
});
