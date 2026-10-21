import { describe, expect, it } from 'vitest';
import { isRelativeAssetPath, matchMarkdownImageRefs } from './note-files';

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
