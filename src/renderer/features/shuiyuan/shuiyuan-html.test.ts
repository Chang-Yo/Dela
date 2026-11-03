// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { sanitizeShuiyuanHtml } from './shuiyuan-html';

const upload = 'https://shuiyuan.sjtu.edu.cn/secure-uploads';

it('shows the lightbox original instead of the optimized thumbnail', () => {
  const doc = sanitizeShuiyuanHtml(
    `<div class="lightbox-wrapper"><a class="lightbox" href="${upload}/original/4X/a/b/c/abc.jpeg">` +
      `<img src="${upload}/optimized/4X/a/b/c/abc_2_690x432.jpeg" width="690" height="432"` +
      ` srcset="${upload}/optimized/4X/a/b/c/abc_2_1035x648.jpeg 1.5x"></a></div>` +
      `<p><img src="${upload}/original/4X/d/e/f/small.png"></p>`,
  );
  const [lightboxed, plain] = doc.querySelectorAll('img');
  expect(lightboxed!.getAttribute('src')).toBe(
    'dela-resource://shuiyuan/secure-uploads/original/4X/a/b/c/abc.jpeg',
  );
  expect(lightboxed!.hasAttribute('srcset')).toBe(false);
  expect(plain!.getAttribute('src')).toBe(
    'dela-resource://shuiyuan/secure-uploads/original/4X/d/e/f/small.png',
  );
});
