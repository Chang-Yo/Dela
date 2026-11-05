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

it('keeps images already saved into the local snapshot', () => {
  const local = 'dela-resource://shuiyuan-snapshot/42/0123456789abcdef0123456789abcdef.jpg';
  const doc = sanitizeShuiyuanHtml(`<a class="lightbox"><img src="${local}"></a>`);
  expect(doc.querySelector('img')!.hasAttribute('src')).toBe(false);
  expect(doc.querySelector('img')!.getAttribute('data-dela-original')).toBe(local);
  expect(doc.querySelector('img')!.getAttribute('data-dela-image')).toBe(`${local}?thumbnail=1`);
});

it('replaces image markup the site escaped into a quote excerpt with a link to the post', () => {
  const doc = sanitizeShuiyuanHtml(
    `<aside class="quote" data-post="152" data-topic="22873"><div class="title">` +
      `<a href="https://shuiyuan.sjtu.edu.cn/t/topic/22873/152">长帖</a></div><blockquote>` +
      `<details><summary>Day1</summary>&lt;a class="lightbox" href="${upload}/original/a.jpeg" data-download-href=&amp;quo…</details>` +
      `</blockquote></aside>`,
  );
  const details = doc.querySelector('details')!;
  expect(details.textContent).not.toContain('lightbox');
  expect(details.querySelector('a')!.getAttribute('href')).toBe(
    'https://shuiyuan.sjtu.edu.cn/t/topic/22873/152',
  );
});

it('holds the place of snapshot images not saved yet without loading them', () => {
  const doc = sanitizeShuiyuanHtml(
    `<a class="lightbox" href="${upload}/original/a.jpeg">` +
      `<img src="${upload}/original/a.jpeg" width="690" height="432" data-snapshot-pending></a>` +
      `<img class="emoji" alt=":smile:" src="https://shuiyuan.sjtu.edu.cn/images/emoji/smile.png" data-snapshot-pending>`,
  );
  expect(doc.querySelectorAll('img')).toHaveLength(0);
  expect(doc.querySelector('a.lightbox')!.hasAttribute('href')).toBe(false);
  expect(doc.querySelector<HTMLElement>('.img-pending')!.style.aspectRatio).toBe('690 / 432');
  expect(doc.body.textContent).toContain(':smile:');
});
