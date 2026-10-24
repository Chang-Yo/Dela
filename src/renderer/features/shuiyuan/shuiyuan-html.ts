import { rootFontSize } from '../../lib/root-font-size';
import { SHUIYUAN_HOST } from '../../../shared/shuiyuan';
import { SHUIYUAN_ORIGIN } from './shuiyuan-format';

/**
 * 水源楼层 HTML（Discourse cooked，服务端已消毒）在本应用的二次消毒：
 * 相对链接/图片按水源域名补全，其余策略与邮件正文一致（剥主动内容、
 * 只留 http(s) 链接、no-referrer、CSP 限定图片与内联样式）。
 */
export function sanitizeShuiyuanHtml(html: string): Document {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc
    .querySelectorAll(
      'script, iframe, frame, frameset, object, embed, base, meta, link, input, button, textarea, select, form',
    )
    .forEach((node) => node.remove());
  for (const element of doc.querySelectorAll('*')) {
    for (const attribute of Array.from(element.attributes)) {
      if (
        /^on/i.test(attribute.name) ||
        ['srcdoc', 'autofocus', 'ping', 'action', 'formaction'].includes(attribute.name)
      )
        element.removeAttribute(attribute.name);
    }
  }
  const absolute = (value: string | null): string | null => {
    if (!value) return null;
    if (value.startsWith('#')) return value;
    try {
      const parsed = new URL(value, `${SHUIYUAN_ORIGIN}/`);
      return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : null;
    } catch {
      return null;
    }
  };
  // 同站媒体匿名加载会被水源登录墙拦下（403/302 到登录页），改写为主进程
  // 代理协议由主进程带凭据取回；站外图维持直连。
  const toMediaUrl = (value: string): string => {
    const parsed = new URL(value);
    if (parsed.hostname !== SHUIYUAN_HOST) return value;
    return `dela-resource://shuiyuan${parsed.pathname}${parsed.search}`;
  };
  for (const anchor of doc.querySelectorAll('a, area')) {
    const href = absolute(anchor.getAttribute('href'));
    if (!href || (!href.startsWith('#') && !/^https?:\/\//i.test(href))) {
      anchor.removeAttribute('href');
      anchor.removeAttribute('target');
      continue;
    }
    if (/^https?:\/\//i.test(href)) {
      anchor.setAttribute('href', href);
      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'noopener noreferrer');
    }
  }
  for (const img of doc.querySelectorAll('img')) {
    const src = absolute(img.getAttribute('src'));
    img.referrerPolicy = 'no-referrer';
    img.loading = 'lazy';
    // srcset/sizes 里的候选不走代理改写，留着会覆盖已改写的 src 重新破图。
    img.removeAttribute('srcset');
    img.removeAttribute('sizes');
    if (src && /^https?:\/\//i.test(src)) {
      img.setAttribute('src', toMediaUrl(src));
    } else {
      // 无可用地址（含 # 锚点等非 http(s) 值）的图片换成安静的文字占位，避免浏览器破图图标。
      const fallback = doc.createElement('span');
      fallback.className = 'img-fallback';
      fallback.textContent = img.alt || '图片不可用';
      img.replaceWith(fallback);
    }
  }
  const policy = doc.createElement('meta');
  policy.httpEquiv = 'Content-Security-Policy';
  policy.content =
    "default-src 'none'; style-src 'unsafe-inline'; img-src data: https: http: dela-resource:; font-src https:; form-action 'none'; base-uri 'none'";
  const referrer = doc.createElement('meta');
  referrer.name = 'referrer';
  referrer.content = 'no-referrer';
  doc.head.prepend(policy, referrer);
  return doc;
}

/**
 * 楼层文档的阅读样式：黑白灰阶梯 + 细线分隔 + 少量强调色，块级内容用细边框和浅底分层，不做重卡片。
 * 色值手动镜像 beautiful-ui token（iframe 取不到外层 CSS 变量）；链接色沿用日历蓝（--cal-blue-text），
 * 它是全应用唯一的低饱和内容强调色。
 * 尺寸一律 rem——iframe 是独立文档，rootSize 由调用方传入，字号设置变化时重新渲染；边框与阴影保留 px。
 */
export function renderShuiyuanHtml(
  doc: Document,
  dark: boolean,
  rootSize = rootFontSize(),
): string {
  doc.documentElement.classList.toggle('dark', dark);
  const style = doc.createElement('style');
  style.textContent = `
    :root {
      color-scheme: light;
      font-size: ${rootSize}px;
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
      font: 0.9375rem/1.8 -apple-system, 'Segoe UI Variable', 'Segoe UI', 'Microsoft YaHei UI', sans-serif;
      overflow-wrap: break-word;
    }
    /* 楼层 iframe 靠高度上报自适应增长，纵向滚动由外层话题区承担，内部滚动条禁止出现。 */
    html { overflow-y: hidden; }
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

    /* 行内代码与代码块：浅底无描边，靠底色分层。 */
    code { font-family: ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', monospace;
      background: var(--soft); border-radius: 0.3125rem; padding: 0.12em 0.4em; font-size: 0.88em; }
    pre { margin: 0.85em 0; padding: 0.75em 1em; background: var(--soft); border-radius: 0.5rem;
      overflow-x: auto; font-size: 0.8125rem; line-height: 1.65; }
    pre code { background: none; padding: 0; border-radius: 0; font-size: inherit; }

    blockquote { margin: 0.85em 0; padding: 0.05em 0 0.05em 0.9em;
      border-left: 2px solid var(--line); color: var(--fg-muted); }
    blockquote > :last-child { margin-bottom: 0; }

    /* Discourse 引用：头部一条浅底 + 正文还原全色。 */
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

    /* Discourse onebox（链接卡片）：细边框 + 头部来源行。 */
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

    /* 图片灯箱：隐藏尺寸/文件名 meta，只留图片本体。 */
    .lightbox-wrapper { margin: 0.85em 0; display: inline-block; max-width: 100%; }
    .lightbox-wrapper .meta { display: none; }
    .img-fallback { display: inline-block; padding: 0 0.45em; border-radius: 0.25rem;
      background: var(--soft); color: var(--fg-muted); font-size: 0.85em; }

    /* 提及与话题标签：安静的着色，不带图标。 */
    .mention { font-weight: 500; color: var(--link); background: var(--soft);
      padding: 0 0.35em; border-radius: 0.3125rem; }
    .mention:hover { text-decoration: none; }
    .hashtag { color: var(--fg-muted); }
    .hashtag svg, a.hashtag .d-icon { display: none; }

    details { margin: 0.9em 0; border: 1px solid var(--line); border-radius: 0.5rem;
      padding: 0.4em 0.9em 0.2em; }
    summary { cursor: pointer; color: var(--fg-muted); font-weight: 500; padding: 0.15em 0; }

    /* 投票（按钮被消毒剥离，呈现为选项列表）。 */
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
  doc.head.append(style);
  return doc.documentElement.outerHTML;
}
