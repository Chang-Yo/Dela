import { describe, expect, it } from 'vitest';
import { uploadMarkdown } from './shuiyuan-format';

const upload = (
  originalFilename: string,
  size: { width: number; height: number } | null = null,
) => ({
  shortUrl: 'upload://abc.png',
  url: '/uploads/default/original/1X/abc.png',
  originalFilename,
  width: size?.width ?? null,
  height: size?.height ?? null,
});

describe('uploadMarkdown', () => {
  it('图片带显示尺寸、去扩展名，与网页端编辑器写法一致', () => {
    expect(
      uploadMarkdown(
        { name: 'shot.png', type: 'image/png', size: 1 },
        upload('shot.png', { width: 690, height: 388 }),
      ),
    ).toBe('![shot|690x388](upload://abc.png)');
  });

  it('文件名里的 | 与方括号不会破坏 Markdown 结构', () => {
    expect(
      uploadMarkdown({ name: 'a|b[1].jpg', type: 'image/jpeg', size: 1 }, upload('a|b[1].jpg')),
    ).toBe('![a b 1 ](upload://abc.png)');
  });

  it('音视频用 |video / |audio，站点据此渲染播放器', () => {
    expect(
      uploadMarkdown({ name: 'clip.mp4', type: 'video/mp4', size: 1 }, upload('clip.mp4')),
    ).toBe('![clip.mp4|video](upload://abc.png)');
  });

  it('其他文件按 |attachment 写出并附大小', () => {
    expect(
      uploadMarkdown(
        { name: 'notes.pdf', type: 'application/pdf', size: 2 * 1024 * 1024 },
        upload('notes.pdf'),
      ),
    ).toBe('[notes.pdf|attachment](upload://abc.png) (2.0 MB)');
  });
});
