import { rootFontSize } from '../../lib/root-font-size';

// iframe 依赖高度上报自适应增长，纵向滚动由外层阅读区承担：html 禁止出现纵向滚动条
// （滚动条挤占宽度引起重新折行，再反过来改变上报高度，来回振荡即正文闪烁）；
// padding-bottom 带 !important 兜底横向滚动条占住的 10px 高度，防止其遮住正文末尾；
// 它随字号缩放，但下限保持原来的 12px——小字号下 0.75rem 只有 9px，反而不够。
// 内层文档的 rem 不继承外层，正文尺寸全部由 rem 派生，根字号由 rootSize 注入。
// htmlScrollY 传 'auto' 时内层文档自己滚：预览 iframe 固定为可视高度、没有高度上报
// 回路，不存在上述振荡，纵向滚动条画在 iframe 内部。
const readerDefaults = (rootSize: number, htmlScrollY: 'hidden' | 'auto' = 'hidden') =>
  `:root{color-scheme:light;font-size:${rootSize}px}body{margin:0;padding:1rem;padding-bottom:max(0.75rem,12px)!important;font-family:Arial,"Microsoft YaHei",sans-serif;font-size:0.875rem;line-height:1.6;color:#202124;background:#fff;overflow-wrap:break-word}img{max-width:100%;height:auto}a{text-decoration:underline!important;text-underline-offset:0.125rem}blockquote{margin:1rem 0;padding:.75rem 1rem;border-inline-start:0.1875rem solid #cbd5e1;border-radius:0 .5rem .5rem 0;background:#f8fafc;color:#475569}blockquote>:first-child{margin-top:0}blockquote>:last-child{margin-bottom:0}blockquote blockquote{margin:.75rem 0 0;border-color:#e2e8f0;background:#fff}code{padding:.125rem .375rem;border-radius:.25rem;background:#f1f5f9;color:#334155;font-family:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;font-size:.9em}pre{margin:1rem 0;padding:.875rem 1rem;overflow:auto;border:1px solid #1e293b;border-radius:.5rem;background:#0f172a;color:#e2e8f0;font-family:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;font-size:.875em;line-height:1.6;white-space:pre}pre code{padding:0;border:0;border-radius:0;background:transparent;color:inherit;font:inherit}hr{height:1px;margin:1.5rem 0;border:0;background:#e2e8f0}footer{margin-top:2rem;padding-top:1rem;border-top:1px solid #e2e8f0;color:#64748b;font-size:.8125em;line-height:1.55}figcaption{margin-top:.5rem;color:#64748b;font-size:.8125em;text-align:center}table{border-collapse:collapse}html{overflow-x:auto;overflow-y:${htmlScrollY}}::-webkit-scrollbar{width:10px;height:10px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{border:3px solid transparent;border-radius:999px;background:rgba(0,0,0,.22);background-clip:padding-box}::-webkit-scrollbar-thumb:hover{background-color:rgba(0,0,0,.38)}`;

/**
 * Add only fallback reader styles; source styles added later in the head take precedence.
 * rootSize 是外层根字号（lib/root-font-size），内层文档靠它把 rem 换算成用户设置的字号。
 */
export function renderMailHtml(
  doc: Document,
  fitWidth: boolean,
  rootSize = rootFontSize(),
  htmlScrollY: 'hidden' | 'auto' = 'hidden',
): string {
  const defaults = doc.createElement('style');
  defaults.textContent = readerDefaults(rootSize, htmlScrollY);
  doc.head.prepend(defaults);
  if (fitWidth) {
    const fit = doc.createElement('style');
    fit.textContent =
      'body{min-width:0!important}table{max-width:100%!important}img{max-width:100%!important;height:auto!important}';
    doc.head.append(fit);
  }
  return '<!doctype html>' + doc.documentElement.outerHTML;
}
