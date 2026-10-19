/**
 * 沙箱 iframe 的高度自适应与可选站内链接上报。srcDoc 文档会继承应用 CSP（script-src 'self'），
 * 外层 CSP 因此要 pin 本脚本的 sha256（见 index.html）；脚本改动必须同步内外层 hash，
 * scripts/shuiyuan-smoke.cjs 的零控制台报错断言会拦下漂移。邮件正文与水源楼层共用这段脚本。
 * 测量 body.scrollHeight 而非 documentElement：后者不小于 iframe 视口高，短楼层会被垫出空白；
 * 两处消费方的 body 均为 margin:0 的内容自适应高度。
 */
const FRAME_HEIGHT_SOURCE = 'dela-frame-height';
const FRAME_LINK_SOURCE = 'dela-frame-link';

const FRAME_HEIGHT_SCRIPT =
  '(function(){var send=function(){var b=document.body;var h=(b?b.scrollHeight:document.documentElement.scrollHeight)||0;window.parent.postMessage({source:\'dela-frame-height\',height:h},"*")};document.addEventListener("click",function(e){var t=e.target;var a=t&&t.closest?t.closest("a[href]"):null;var host=document.documentElement.getAttribute("data-dela-internal-link-host");if(!a||!host)return;try{var u=new URL(a.href);var p=u.pathname.split("/").filter(Boolean);if((u.protocol==="https:"||u.protocol==="http:")&&u.hostname===host&&p[0]==="t"&&(/^\\d+$/.test(p[1]||"")||/^\\d+$/.test(p[2]||""))){e.preventDefault();window.parent.postMessage({source:\'dela-frame-link\',href:u.href},"*")}}catch(_){}});if("ResizeObserver" in window){new ResizeObserver(send).observe(document.documentElement)}send()})();';

/** 在已消毒文档中注入高度上报脚本；必须在 sanitize 之后调用，避免被剥除。 */
export function injectFrameHeightReport(doc: Document, internalLinkHost?: string) {
  if (internalLinkHost)
    doc.documentElement.setAttribute('data-dela-internal-link-host', internalLinkHost);
  const policy = doc.querySelector('meta[http-equiv="Content-Security-Policy"]');
  if (policy)
    policy.setAttribute(
      'content',
      `${policy.getAttribute('content') ?? ''}; script-src 'sha256-6ls+Tslxjo93SL4NSk/hvwnI1MIUdUKBi4JQp3N7X0o='`,
    );
  const script = doc.createElement('script');
  script.textContent = FRAME_HEIGHT_SCRIPT;
  doc.body.append(script);
}

export function frameHeightFromEvent(
  event: MessageEvent,
  iframe: HTMLIFrameElement | null,
): number | null {
  if (iframe === null || event.source !== iframe.contentWindow) return null;
  const data = event.data as { source?: unknown; height?: unknown } | null;
  if (!data || data.source !== FRAME_HEIGHT_SOURCE) return null;
  const { height } = data;
  return typeof height === 'number' && Number.isFinite(height)
    ? Math.max(0, Math.ceil(height))
    : null;
}

export function frameLinkFromEvent(
  event: MessageEvent,
  iframe: HTMLIFrameElement | null,
): string | null {
  if (iframe === null || event.source !== iframe.contentWindow) return null;
  const data = event.data as { source?: unknown; href?: unknown } | null;
  return data?.source === FRAME_LINK_SOURCE && typeof data.href === 'string' ? data.href : null;
}
