import { renderMailHtml } from '../features/mail/mail-html-display';

/**
 * Canvas 网页正文（作业/讨论/页面等）清洗：剥离脚本类元素与内联事件属性，
 * 相对地址按 Canvas 站点补全，注入禁脚本 CSP，最后套阅读器默认样式，
 * 供沙箱 iframe 的 srcDoc 使用。资料详情与 TODO 详情共用。
 */
export function sanitizeHtml(text: string | null | undefined, baseUrl: string): string {
  const doc = new DOMParser().parseFromString(text || '<p>此内容没有正文。</p>', 'text/html');
  doc
    .querySelectorAll('script,iframe,object,embed,form,base,meta,link')
    .forEach((el) => el.remove());
  doc.querySelectorAll('*').forEach((el) => {
    for (const a of Array.from(el.attributes))
      if (a.name.startsWith('on') || a.name === 'srcdoc') el.removeAttribute(a.name);
  });
  doc.querySelectorAll('a[href],img[src]').forEach((el) => {
    const attr = el.tagName === 'A' ? 'href' : 'src';
    try {
      const url = new URL(el.getAttribute(attr)!, baseUrl);
      if (['https:', 'http:'].includes(url.protocol)) el.setAttribute(attr, url.href);
      else el.removeAttribute(attr);
    } catch {
      el.removeAttribute(attr);
    }
  });
  const csp = doc.createElement('meta');
  csp.httpEquiv = 'Content-Security-Policy';
  csp.content =
    "default-src 'none'; style-src 'unsafe-inline'; img-src data: https: http:; script-src 'none'; form-action 'none'";
  doc.head.prepend(csp);
  return renderMailHtml(doc, true);
}
