// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { htmlFrameDocument } from '../../../../ui/lib/html-frame-document';
import { shuiyuanFrame } from '../shuiyuan-html';

const upload = 'https://shuiyuan.sjtu.edu.cn/secure-uploads';
const render = (html: string) =>
  new DOMParser().parseFromString(
    htmlFrameDocument(html, { ...shuiyuanFrame(false), rootSize: 16 }),
    'text/html',
  );

it('shows the lightbox original instead of the optimized thumbnail', () => {
  const doc = render(
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
  const doc = render(`<a class="lightbox"><img src="${local}"></a>`);
  expect(doc.querySelector('img')!.hasAttribute('src')).toBe(false);
  expect(doc.querySelector('img')!.getAttribute('data-dela-zoom')).toBe(local);
  expect(doc.querySelector('img')!.getAttribute('data-dela-lazy')).toBe(`${local}?thumbnail=1`);
});

it('holds the place of snapshot images not saved yet without loading them', () => {
  const doc = render(
    `<a class="lightbox" href="${upload}/original/a.jpeg">` +
      `<img src="${upload}/original/a.jpeg" width="690" height="432" data-snapshot-pending></a>` +
      `<img class="emoji" alt=":smile:" src="https://shuiyuan.sjtu.edu.cn/images/emoji/smile.png" data-snapshot-pending>`,
  );
  expect(doc.querySelectorAll('img')).toHaveLength(0);
  expect(doc.querySelector('a.lightbox')!.hasAttribute('href')).toBe(false);
  expect(doc.querySelector<HTMLElement>('.img-pending')!.style.aspectRatio).toBe('690 / 432');
  expect(doc.body.textContent).toContain(':smile:');
});
