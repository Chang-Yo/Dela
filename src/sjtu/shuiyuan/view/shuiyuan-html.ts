import type { HtmlFrameDocumentOptions } from '../../../ui/lib/html-frame-document';
import { SHUIYUAN_HOST } from '../contract';
import { SHUIYUAN_ORIGIN } from './shuiyuan-format';

const SNAPSHOT_IMAGE_PREFIX = 'dela-resource://shuiyuan-snapshot/';

/** 楼层的阅读样式。iframe 取不到外层 CSS 变量，色值手动镜像 design token；尺寸一律 rem。 */
const SHUIYUAN_STYLESHEET = `
    :root {
      color-scheme: light;
      --fg: oklch(0.247 0.006 258.361);
      --fg-muted: oklch(0.695 0.009 264.505);
      --line: oklch(0.946 0.003 264.542);
      --soft: oklch(0.979 0.002 247.839);
      --soft-2: oklch(0.933 0.003 247.86);
      --link: oklch(43% 0.083 255);
    }
    html.dark {
      color-scheme: dark;
      --fg: oklch(0.964 0.002 247.839);
      --fg-muted: oklch(0.541 0.01 264.484);
      --line: oklch(0.308 0.006 258.354);
      --soft: oklch(0.243 0.004 264.492);
      --soft-2: oklch(0.318 0.007 274.747);
      --link: oklch(85.8% 0.052 255);
    }
    body {
      margin: 0; padding: 0 0.125rem 0.125rem; background: transparent; color: var(--fg);
      font: 0.9375rem/1.8 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
        'Helvetica Neue', Arial, 'Noto Sans', sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji',
        'Segoe UI Symbol', 'Noto Color Emoji';
      overflow-wrap: break-word;
    }
    ::selection { background: color-mix(in oklch, var(--link) 22%, transparent); }
    ::-webkit-scrollbar { width: 10px; height: 10px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { border: 3px solid transparent; border-radius: 999px;
      background: color-mix(in oklch, var(--fg) 22%, transparent); background-clip: padding-box; }
    ::-webkit-scrollbar-thumb:hover { background-color: color-mix(in oklch, var(--fg) 38%, transparent); }

    p { margin: 0 0 0.85em; }
    h1, h2, h3, h4, h5, h6 { margin: 1.35em 0 0.45em; font-weight: 600; line-height: 1.4; }
    h1 { font-size: 1.3em; } h2 { font-size: 1.18em; } h3 { font-size: 1.08em; }
    h4, h5, h6 { font-size: 1em; }
    ul, ol { margin: 0.75em 0; padding-left: 1.4em; }
    li { margin: 0.25em 0; }
    a { color: var(--link); text-decoration: none; text-underline-offset: 0.125rem; }
    a:hover { text-decoration: underline; }
    img, video { max-width: 100%; height: auto; border-radius: 0.375rem; }
    img.emoji { display: inline-block; width: 1.3em; height: 1.3em; margin: 0 0.05em;
      vertical-align: -0.2em; border-radius: 0; }
    hr { border: 0; border-top: 1px solid var(--line); margin: 1.5em 0; }
    small { color: var(--fg-muted); }

    code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
      'Courier New', monospace;
      background: var(--soft); border-radius: 0.3125rem; padding: 0.12em 0.4em; font-size: 0.88em; }
    pre { margin: 0.85em 0; padding: 0.75em 1em; background: var(--soft); border-radius: 0.5rem;
      overflow-x: auto; font-size: 0.8125rem; line-height: 1.65; }
    pre code { background: none; padding: 0; border-radius: 0; font-size: inherit; }

    blockquote { margin: 0.85em 0; padding: 0.05em 0 0.05em 0.9em;
      border-left: 2px solid var(--line); color: var(--fg-muted); }
    blockquote > :last-child { margin-bottom: 0; }

    aside.quote { margin: 0.9em 0; border: 1px solid var(--line); border-radius: 0.5rem;
      overflow: hidden; }
    aside.quote .title { display: flex; align-items: center; gap: 0.5em;
      padding: 0.4em 0.85em; background: var(--soft); color: var(--fg-muted);
      font-size: 0.86em; font-weight: 500; }
    aside.quote .title img.avatar { width: 1rem; height: 1rem; border-radius: 50%; }
    aside.quote .title a { color: inherit; }
    aside.quote .title .quote-controls { display: none; }
    aside.quote blockquote { margin: 0; padding: 0.5em 0.9em; border: 0; color: var(--fg); }
    aside.quote aside.quote { margin: 0.75em 0.9em; }

    aside.onebox { margin: 0.9em 0; border: 1px solid var(--line); border-radius: 0.5rem;
      overflow: hidden; }
    aside.onebox header { display: flex; align-items: center; gap: 0.45em;
      padding: 0.4em 0.85em; background: var(--soft); color: var(--fg-muted); font-size: 0.85em; }
    aside.onebox header img { width: 1rem; height: 1rem; border-radius: 0.25rem; }
    aside.onebox header a { color: inherit; }
    aside.onebox .onebox-body { padding: 0.65em 0.9em; }
    aside.onebox .onebox-body > :last-child { margin-bottom: 0; }
    aside.onebox h3, aside.onebox h4 { margin: 0 0 0.2em; font-size: 1em; }
    aside.onebox p { margin: 0 0 0.4em; color: var(--fg-muted); font-size: 0.92em; }
    aside.onebox .thumbnail img { border-radius: 0.375rem; }
    aside.onebox .aspect-img, aside.onebox .onebox-avatar { display: none; }

    .lightbox-wrapper { margin: 0.85em 0; display: inline-block; max-width: 100%; }
    .lightbox-wrapper .meta { display: none; }
    a.lightbox { cursor: zoom-in; }
    .img-fallback { display: inline-block; padding: 0 0.45em; border-radius: 0.25rem;
      background: var(--soft); color: var(--fg-muted); font-size: 0.85em; }
    .img-pending { display: flex; align-items: center; justify-content: center;
      max-width: 100%; min-height: 4rem; border-radius: 0.375rem;
      background: var(--soft); color: var(--fg-muted); font-size: 0.85em; }
    a.lightbox:not([href]) { cursor: default; }

    .mention { font-weight: 500; color: var(--link); background: var(--soft);
      padding: 0 0.35em; border-radius: 0.3125rem; }
    .mention:hover { text-decoration: none; }
    .hashtag { color: var(--fg-muted); }
    .hashtag svg, a.hashtag .d-icon { display: none; }

    details { margin: 0.9em 0; border: 1px solid var(--line); border-radius: 0.5rem;
      padding: 0.4em 0.9em 0.2em; }
    summary { cursor: pointer; color: var(--fg-muted); font-weight: 500; padding: 0.15em 0; }

    .poll { margin: 0.9em 0; }
    .poll ul { list-style: none; padding: 0; margin: 0.5em 0; }
    .poll li { margin: 0.35em 0; padding: 0.4em 0.7em; border: 1px solid var(--line);
      border-radius: 0.375rem; }
    .poll-title { font-weight: 600; margin-bottom: 0.3em; }
    .poll-info, .poll-results, .poll-footer { color: var(--fg-muted); font-size: 0.88em; }

    table { border-collapse: collapse; margin: 0.85em 0; display: block; max-width: 100%;
      overflow-x: auto; font-size: 0.92em; }
    th, td { border: 1px solid var(--line); padding: 0.4em 0.65em; text-align: left; }
    th { background: var(--soft); font-weight: 600; }

    section.footnotes, .footnotes { margin-top: 1.5em; padding-top: 0.5em;
      border-top: 1px solid var(--line); color: var(--fg-muted); font-size: 0.9em; }
    sup a { text-decoration: none; }

    audio { max-width: 100%; }
    .dela-post-head { color: var(--fg-muted); font-size: 0.8125rem; margin: 0 0 0.125rem; }
    .dela-post-head b { color: var(--fg); }
  `;

// 同站媒体匿名加载会被水源登录墙拦下（403/302 到登录页），改写为主进程
// 代理协议由主进程带凭据取回；站外图维持直连。
const toMediaUrl = (value: string): string => {
  const parsed = new URL(value);
  if (parsed.hostname !== SHUIYUAN_HOST) return value;
  return `dela-resource://shuiyuan${parsed.pathname}${parsed.search}`;
};

/** 水源楼层 HTML（Discourse cooked）在通用消毒之后的改写，主题随应用明暗。 */
export function shuiyuanFrame(dark: boolean): HtmlFrameDocumentOptions {
  return {
    baseUrl: `${SHUIYUAN_ORIGIN}/`,
    localImages: SNAPSHOT_IMAGE_PREFIX,
    fitWidth: false,
    stylesheet: SHUIYUAN_STYLESHEET,
    transform: (doc) => {
      doc.documentElement.classList.toggle('dark', dark);
      // 站点给引用生成摘要时会把楼层里的图片等标签转义成文字并截断（如 `<a class="lightbox" href=…`），
      // 网页上同样显示为乱码；截掉这段文字，换成指向被引楼层的链接。
      for (const quote of doc.querySelectorAll('aside.quote')) {
        const source = quote.querySelector('.title a[href]')?.getAttribute('href');
        const walker = doc.createTreeWalker(
          quote.querySelector('blockquote') ?? quote,
          NodeFilter.SHOW_TEXT,
        );
        for (
          let node = walker.nextNode() as Text | null;
          node;
          node = walker.nextNode() as Text | null
        ) {
          const start = node.data.search(/<[a-z][a-z0-9]*\s+[a-z-]+=/i);
          if (start < 0) continue;
          node.data = node.data.slice(0, start);
          const link = doc.createElement('a');
          link.textContent = '引用内容未完整显示，查看原楼层';
          if (source) link.setAttribute('href', source);
          node.after(link);
          break;
        }
      }
      for (const img of doc.querySelectorAll('img')) {
        img.loading = 'lazy';
        const lightbox = img.closest('a.lightbox');
        // 本地快照图片进入视野才加载缩略图，点开看原图。
        if (img.getAttribute('src')?.startsWith(SNAPSHOT_IMAGE_PREFIX)) {
          const src = img.getAttribute('src')!;
          if (lightbox) img.setAttribute('data-dela-zoom', src);
          img.setAttribute(
            'data-dela-lazy',
            /\.(jpg|png|webp|bmp)$/i.test(src) ? `${src}?thumbnail=1` : src,
          );
          img.removeAttribute('src');
          const width = Number(img.getAttribute('width'));
          const height = Number(img.getAttribute('height'));
          if (width > 0 && height > 0) img.style.aspectRatio = `${width} / ${height}`;
          else {
            img.width = 690;
            img.height = 518;
            img.style.aspectRatio = '690 / 518';
          }
          img.decoding = 'async';
          continue;
        }
        // 快照草稿里还没存到本地的图片不联网加载，按原尺寸占位，存好后刷新正文即显示。
        if (img.hasAttribute('data-snapshot-pending')) {
          lightbox?.removeAttribute('href');
          if (img.classList.contains('emoji')) {
            img.replaceWith(img.alt);
            continue;
          }
          const placeholder = doc.createElement('span');
          placeholder.className = 'img-pending';
          placeholder.textContent = '图片保存中';
          const width = Number(img.getAttribute('width'));
          const height = Number(img.getAttribute('height'));
          if (width > 0 && height > 0)
            placeholder.style.cssText = `width: ${width}px; aspect-ratio: ${width} / ${height};`;
          img.replaceWith(placeholder);
          continue;
        }
        // 灯箱链接指向原图，比 img 上的缩略图清晰。
        const original = lightbox?.getAttribute('href');
        const src = original?.startsWith('http') ? original : img.getAttribute('src');
        if (src) {
          img.setAttribute('src', toMediaUrl(src));
          if (lightbox) img.setAttribute('data-dela-zoom', toMediaUrl(src));
        } else {
          // 无可用地址的图片换成安静的文字占位，避免浏览器破图图标。
          const fallback = doc.createElement('span');
          fallback.className = 'img-fallback';
          fallback.textContent = img.alt || '图片不可用';
          img.replaceWith(fallback);
        }
      }
    },
  };
}
