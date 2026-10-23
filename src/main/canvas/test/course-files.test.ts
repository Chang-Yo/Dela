import { describe, expect, it } from 'vitest';
import { collectCourseFileEntries, pickCourseFiles } from '../course-files';

const root = (courseName: string, courseId: number, dir: string) => ({
  courseName,
  courseId,
  root: dir,
});

describe('pickCourseFiles', () => {
  it('挑出课程目录下的缓存文件，title 为「课程名/相对路径」', () => {
    const files = pickCourseFiles(
      [root('软件工程', 101, 'C:/data/courses/term-2025fall/软件工程 [101]')],
      [
        'C:/data/courses/term-2025fall/软件工程 [101]/files/lec1.pdf',
        'C:/data/courses/term-2025fall/别的课 [202]/other.md',
      ],
      () => true,
    );
    expect(files).toEqual([
      {
        path: 'C:/data/courses/term-2025fall/软件工程 [101]/files/lec1.pdf',
        title: '软件工程/files/lec1.pdf',
      },
    ]);
  });

  it('不存在的缓存文件与课程目录外的路径都被排除；相对路径统一正斜杠', () => {
    const files = pickCourseFiles(
      [root('课', 1, 'C:/courses/课 [1]')],
      ['C:/courses/课 [1]/a\\b.md', 'C:/courses/课 [1]/gone.md', 'C:/elsewhere/x.md'],
      (path) => !path.includes('gone'),
    );
    expect(files).toEqual([{ path: 'C:/courses/课 [1]/a\\b.md', title: '课/a/b.md' }]);
  });

  it('title 冲突时课程名追加 [courseId] 消解，且不产生重复 title', () => {
    const files = pickCourseFiles(
      [root('软件工程', 101, 'C:/c/one'), root('软件工程', 202, 'C:/c/two')],
      ['C:/c/one/a.md', 'C:/c/two/a.md'],
      () => true,
    );
    expect(files.map((file) => file.title)).toEqual(['软件工程/a.md', '软件工程 [202]/a.md']);
  });

  it('目录前缀必须在分隔符处断开：「…[1]」不误吞「…[10]」下的文件', () => {
    const files = pickCourseFiles(
      [root('课', 1, 'C:/c/课 [1]'), root('课', 10, 'C:/c/课 [10]')],
      ['C:/c/课 [10]/x.pdf'],
      () => true,
    );
    // 无冲突时首现标题不带 [courseId]；若被 [1] 误吞，relative 会变成「0/x.pdf」。
    expect(files).toEqual([{ path: 'C:/c/课 [10]/x.pdf', title: '课/x.pdf' }]);
  });

  it('匹配大小写不敏感，title 保留原始大小写', () => {
    const files = pickCourseFiles(
      [root('Course', 7, 'C:/c/Course [7]')],
      ['C:/C/course [7]/Readme.MD'],
      () => true,
    );
    expect(files).toEqual([{ path: 'C:/C/course [7]/Readme.MD', title: 'Course/Readme.MD' }]);
  });

  it('POSIX 课程路径区分大小写，且不把反斜杠视为目录边界', () => {
    expect(
      pickCourseFiles(
        [root('Course', 7, '/courses/Course [7]')],
        [
          '/courses/course [7]/wrong.pdf',
          '/courses/Course [7]\\outside.pdf',
          '/courses/Course [7]/Readme.MD',
        ],
        () => true,
      ),
    ).toEqual([{ path: '/courses/Course [7]/Readme.MD', title: 'Course/Readme.MD' }]);
  });

  it('POSIX 文件名中的反斜杠保留，不能与同名子目录文件合并', () => {
    expect(
      pickCourseFiles(
        [root('课', 1, '/courses/课 [1]')],
        ['/courses/课 [1]/a\\b.md', '/courses/课 [1]/a/b.md'],
        () => true,
      ),
    ).toEqual([
      { path: '/courses/课 [1]/a\\b.md', title: '课/a\\b.md' },
      { path: '/courses/课 [1]/a/b.md', title: '课/a/b.md' },
    ]);
  });

  it.each(['C:\\courses\\课 [1]\\', '\\\\server\\share\\课 [1]\\'])(
    'Windows 路径 %s 保持大小写与混合分隔符兼容',
    (directory) => {
      const path = `${directory.toUpperCase()}files/Readme.MD`;
      expect(pickCourseFiles([root('课', 1, directory)], [path], () => true)).toEqual([
        { path, title: '课/files/Readme.MD' },
      ]);
    },
  );

  it('路径归一化后仍排除课程目录自身和越界文件', () => {
    expect(
      pickCourseFiles(
        [root('课', 1, '/courses/one/')],
        ['/courses/one', '/courses/one/../two/outside.md', '/courses/one/./files/a.md'],
        () => true,
      ),
    ).toEqual([{ path: '/courses/one/./files/a.md', title: '课/files/a.md' }]);
  });
});

describe('collectCourseFileEntries', () => {
  const item = (partial: {
    id: string;
    parentId: string | null;
    kind: 'folder' | 'file' | 'module';
    name: string;
    sourceId?: string | null;
  }) => ({ courseId: 1, sourceId: null, ...partial });

  const items = [
    item({ id: '1:files', parentId: null, kind: 'folder', name: '文件' }),
    item({ id: 'folder:10', parentId: '1:files', kind: 'folder', name: '讲义' }),
    item({ id: 'folder:11', parentId: 'folder:10', kind: 'folder', name: '第1周' }),
    item({
      id: '1:files/file:1',
      parentId: '1:files',
      kind: 'file',
      name: '大纲.pdf',
      sourceId: 'file:1',
    }),
    item({
      id: 'folder:10/file:2',
      parentId: 'folder:10',
      kind: 'file',
      name: 'lec1.pdf',
      sourceId: 'file:2',
    }),
    item({
      id: 'folder:11/file:3',
      parentId: 'folder:11',
      kind: 'file',
      name: 'hw.pdf',
      sourceId: 'file:3',
    }),
    // 模块、作业提交里的同名引用与根目录链无关，必须排除。
    item({ id: 'module:20', parentId: '1:modules', kind: 'module', name: '模块' }),
    item({
      id: 'module-item:30',
      parentId: 'module:20',
      kind: 'file',
      name: 'lec1.pdf',
      sourceId: 'file:2',
    }),
    item({
      id: 'assignment:9:submission/file:4',
      parentId: 'assignment:9:submission',
      kind: 'file',
      name: '提交.pdf',
      sourceId: 'file:4',
    }),
  ];

  it('只收集「文件」根目录链上的文件，folders 为课程内相对目录段', () => {
    expect(collectCourseFileEntries(1, items)).toEqual([
      { sourceId: 'file:1', name: '大纲.pdf', folders: [] },
      { sourceId: 'file:2', name: 'lec1.pdf', folders: ['讲义'] },
      { sourceId: 'file:3', name: 'hw.pdf', folders: ['讲义', '第1周'] },
    ]);
  });

  it('其他课程的根目录链不算，悬空父链被安全放弃', () => {
    const other = [
      item({ id: '2:files', parentId: null, kind: 'folder', name: '文件' }),
      item({
        id: '2:files/file:5',
        parentId: '2:files',
        kind: 'file',
        name: 'a.pdf',
        sourceId: 'file:5',
      }),
      item({
        id: 'folder:99/file:6',
        parentId: 'folder:missing',
        kind: 'file',
        name: 'b.pdf',
        sourceId: 'file:6',
      }),
    ];
    expect(collectCourseFileEntries(2, other)).toEqual([
      { sourceId: 'file:5', name: 'a.pdf', folders: [] },
    ]);
    expect(collectCourseFileEntries(1, other)).toEqual([]);
  });
});
