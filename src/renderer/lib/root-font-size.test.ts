// @vitest-environment jsdom
// 沙箱 iframe 文档不继承外层根字号：邮件正文与水源楼层靠注入的 :root font-size 跟随字号设置。
import { describe, expect, it } from 'vitest';
import { renderMailHtml } from '../features/mail/mail-html-display';
import { renderShuiyuanHtml } from '../features/shuiyuan/shuiyuan-html';

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');

describe('injected root font size', () => {
  it('writes the current root size into the mail document and keeps body text at 0.875rem', () => {
    const html = renderMailHtml(parse('<p>正文</p>'), true, 12);
    expect(html).toContain(':root{color-scheme:light;font-size:12px}');
    expect(html).toContain('font-size:0.875rem');
    expect(renderMailHtml(parse('<p>正文</p>'), true, 20)).toContain('font-size:20px');
  });

  it('writes the current root size into the shuiyuan document', () => {
    expect(renderShuiyuanHtml(parse('<p>楼层</p>'), false, 20)).toContain('font-size: 20px;');
    // 暗色主题只换色，不改字号口径。
    expect(renderShuiyuanHtml(parse('<p>楼层</p>'), true, 12)).toContain('font-size: 12px;');
  });
});
