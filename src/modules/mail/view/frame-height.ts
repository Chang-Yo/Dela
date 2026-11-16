/**
 * 沙箱 iframe 高度上报脚本（邮件与水源共用）。外层 CSP 要 pin 其 sha256（见 index.html），改脚本须同步，
 * scripts/shuiyuan-smoke.cjs 会拦下漂移。测 body.scrollHeight 而非 documentElement，否则短内容被垫高。
 */
const FRAME_HEIGHT_SOURCE = 'dela-frame-height';
const FRAME_LINK_SOURCE = 'dela-frame-link';
const FRAME_IMAGE_SOURCE = 'dela-frame-image';

const FRAME_HEIGHT_SCRIPT =
  '(function(){var send=function(){var b=document.body;var h=(b?b.scrollHeight:document.documentElement.scrollHeight)||0;window.parent.postMessage({source:\'dela-frame-height\',height:h},"*")};document.addEventListener("click",function(e){var t=e.target;var l=document.documentElement.hasAttribute("data-dela-lightbox")&&t&&t.closest?t.closest("a.lightbox"):null;var m=l&&l.querySelector("img");if(m){e.preventDefault();window.parent.postMessage({source:\'dela-frame-image\',src:m.getAttribute("data-dela-original")||m.src,alt:m.alt},"*");return}var a=t&&t.closest?t.closest("a[href]"):null;var host=document.documentElement.getAttribute("data-dela-internal-link-host");if(!a||!host)return;try{var u=new URL(a.href);var p=u.pathname.split("/").filter(Boolean);if((u.protocol==="https:"||u.protocol==="http:")&&u.hostname===host&&p[0]==="t"&&(/^\\d+$/.test(p[1]||"")||/^\\d+$/.test(p[2]||""))){e.preventDefault();window.parent.postMessage({source:\'dela-frame-link\',href:u.href},"*")}}catch(_){}});if("IntersectionObserver" in window){var io=new IntersectionObserver(function(es){es.forEach(function(e){var m=e.target;if(e.isIntersecting){m.src=m.getAttribute("data-dela-image")}else{m.removeAttribute("src")}})});document.querySelectorAll("img[data-dela-image]").forEach(function(m){m.addEventListener("load",function(){if(m.naturalWidth){m.style.aspectRatio=m.naturalWidth+" / "+m.naturalHeight} });io.observe(m)})}if("ResizeObserver" in window){new ResizeObserver(send).observe(document.documentElement)}send()})();';

/** 在已消毒文档中注入高度上报脚本；必须在 sanitize 之后调用，避免被剥除。 */
export function injectFrameHeightReport(
  doc: Document,
  { internalLinkHost, lightbox = false }: { internalLinkHost?: string; lightbox?: boolean } = {},
) {
  if (internalLinkHost)
    doc.documentElement.setAttribute('data-dela-internal-link-host', internalLinkHost);
  if (lightbox) doc.documentElement.setAttribute('data-dela-lightbox', '');
  const policy = doc.querySelector('meta[http-equiv="Content-Security-Policy"]');
  if (policy)
    policy.setAttribute(
      'content',
      `${policy.getAttribute('content') ?? ''}; script-src 'sha256-RbRPCJBHkLzV/2Z8RaEC5NLqTK4EYlW7lcJQ7nmJMnA='`,
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

export function frameImageFromEvent(
  event: MessageEvent,
  iframe: HTMLIFrameElement | null,
): { src: string; alt: string } | null {
  if (iframe === null || event.source !== iframe.contentWindow) return null;
  const data = event.data as { source?: unknown; src?: unknown; alt?: unknown } | null;
  return data?.source === FRAME_IMAGE_SOURCE &&
    typeof data.src === 'string' &&
    typeof data.alt === 'string'
    ? { src: data.src, alt: data.alt }
    : null;
}
