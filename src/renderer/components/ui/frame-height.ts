/**
 * 沙箱 iframe 的高度自适应上报。srcDoc 文档会继承应用 CSP（script-src 'self'），
 * 因此外层 CSP 需 pin 本脚本的 sha256 hash（见 index.html）；脚本文本任何改动都要
 * 重新计算 hash——scripts/shuiyuan-smoke.cjs 的零控制台报错断言会拦截漂移。
 * 邮件正文与水源楼层共用同一段脚本，只维护一个 hash。
 */
export const FRAME_HEIGHT_SOURCE = 'dela-frame-height';

export const FRAME_HEIGHT_SCRIPT =
  '(function(){var send=function(){window.parent.postMessage({source:\'dela-frame-height\',height:document.documentElement.scrollHeight},"*")};if("ResizeObserver" in window){new ResizeObserver(send).observe(document.documentElement)}send()})();';

/** 在已消毒文档中注入高度上报脚本；必须在 sanitize 之后调用，避免被剥除。 */
export function injectFrameHeightReport(doc: Document) {
  const policy = doc.querySelector('meta[http-equiv="Content-Security-Policy"]');
  if (policy)
    policy.setAttribute(
      'content',
      `${policy.getAttribute('content') ?? ''}; script-src 'unsafe-inline'`,
    );
  const script = doc.createElement('script');
  script.textContent = FRAME_HEIGHT_SCRIPT;
  doc.body.append(script);
}

/** 校验来自目标 iframe 的高度上报消息，返回高度（px）；无效返回 null。 */
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
