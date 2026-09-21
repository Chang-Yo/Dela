import { describe, expect, it } from 'vitest';
import {
  buildMarkdownImage,
  externalOpenTarget,
  isRelativeAssetPath,
  markdownRequiresSourceMode,
  matchMarkdownImageRefs,
  noteAssetUrl,
} from './note-files';

describe('matchMarkdownImageRefs', () => {
  it('提取 alt、路径与偏移，含 title 的引用不吞 title', () => {
    const text = '前文\n![截图](assets/pic.png "标题")\n![说明](img/pic2.png)';
    expect(matchMarkdownImageRefs(text)).toEqual([
      { path: 'assets/pic.png', alt: '截图', index: 3, length: 26 },
      { path: 'img/pic2.png', alt: '说明', index: 30, length: 19 },
    ]);
  });

  it('空 alt 能匹配；未编码空格的路径与普通链接不匹配', () => {
    expect(matchMarkdownImageRefs('![](a.png)')).toEqual([
      { path: 'a.png', alt: '', index: 0, length: 10 },
    ]);
    expect(matchMarkdownImageRefs('![a](my pic.png)')).toEqual([]);
    expect(matchMarkdownImageRefs('[链接](a.png)')).toEqual([]);
  });
});

describe('buildMarkdownImage', () => {
  it('路径中的空格与括号被编码，alt 内方括号被清理', () => {
    expect(buildMarkdownImage('截图', 'assets/my pic (1).png')).toBe(
      '![截图](assets/my%20pic%20%281%29.png)',
    );
    expect(buildMarkdownImage('图[1]\n注', 'a.png')).toBe('![图 1  注](a.png)');
  });
});

describe('isRelativeAssetPath', () => {
  it('接受仓库内相对路径', () => {
    expect(isRelativeAssetPath('assets/pic.png')).toBe(true);
    expect(isRelativeAssetPath('pic.png')).toBe(true);
  });
  it('拒绝协议、锚点、绝对路径与盘符', () => {
    expect(isRelativeAssetPath('https://example.com/a.png')).toBe(false);
    expect(isRelativeAssetPath('dela-img:0123')).toBe(false);
    expect(isRelativeAssetPath('#section')).toBe(false);
    expect(isRelativeAssetPath('/abs/a.png')).toBe(false);
    expect(isRelativeAssetPath('\\abs\\a.png')).toBe(false);
    expect(isRelativeAssetPath('E:\\Users\\a.png')).toBe(false);
    expect(isRelativeAssetPath('')).toBe(false);
  });
});

describe('noteAssetUrl', () => {
  it('路径编码一次并携带条目 ID', () => {
    expect(noteAssetUrl('id-1', 'assets/my pic.png')).toBe(
      'dela-resource://note-asset/assets%2Fmy%20pic.png?id=id-1',
    );
  });
});

describe('externalOpenTarget', () => {
  it('文本/代码文件进 VS Code，Markdown 与二进制交给系统', () => {
    expect(externalOpenTarget('main.cpp')).toBe('vscode');
    expect(externalOpenTarget('App.tsx')).toBe('vscode');
    expect(externalOpenTarget('data.json')).toBe('vscode');
    expect(externalOpenTarget('笔记.md')).toBe('system');
    expect(externalOpenTarget('论文.pdf')).toBe('system');
    expect(externalOpenTarget('logo.png')).toBe('system');
    expect(externalOpenTarget('README')).toBe('system');
  });
});

describe('markdownRequiresSourceMode', () => {
  it('frontmatter 文档强制源码模式', () => {
    expect(markdownRequiresSourceMode('---\ntitle: A\n---\n\n正文')).toBe(true);
    expect(markdownRequiresSourceMode('---\r\ntitle: A\r\n---\r\n正文')).toBe(true);
  });
  it('正文分隔线与空文档不误判', () => {
    expect(markdownRequiresSourceMode('正文\n\n---\n\n结尾')).toBe(false);
    expect(markdownRequiresSourceMode('')).toBe(false);
    expect(markdownRequiresSourceMode('# 标题\n\n---\n\n内容')).toBe(false);
  });
});
