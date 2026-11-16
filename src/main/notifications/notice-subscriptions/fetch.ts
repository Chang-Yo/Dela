import { validateNoticeUrl } from './parser';

export const PAGE_BYTE_LIMIT = 2 * 1024 * 1024;

export async function fetchNoticePage(rawUrl: string, fetcher: typeof fetch = fetch) {
  let url = validateNoticeUrl(rawUrl);
  const signal = AbortSignal.timeout(20_000);
  for (let hop = 0; hop <= 5; hop++) {
    const response = await fetcher(url, {
      redirect: 'manual',
      signal,
      headers: {
        'user-agent': 'Dela-notice-prototype/0.1',
        accept:
          'text/html,application/xhtml+xml,application/rss+xml,application/atom+xml,application/xml,text/xml',
      },
    });
    const location =
      response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
    if (location) {
      await response.body?.cancel();
      if (hop === 5) throw new Error('订阅页面重定向次数过多');
      url = validateNoticeUrl(new URL(location, url).href);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`订阅页面请求失败（HTTP ${response.status}）`);
    }
    const type = response.headers.get('content-type') ?? '';
    if (
      type &&
      !/^(?:text\/(?:html|xml|plain)|application\/(?:xhtml\+xml|rss\+xml|atom\+xml|xml))(?:;|$)/i.test(
        type,
      )
    ) {
      await response.body?.cancel();
      throw new Error('订阅地址没有返回 HTML 或 XML；原型不处理该响应类型');
    }
    if (Number(response.headers.get('content-length')) > PAGE_BYTE_LIMIT) {
      await response.body?.cancel();
      throw new Error('订阅页面超过 2 MiB 上限');
    }
    const chunks: Uint8Array[] = [];
    let length = 0;
    if (response.body) {
      const reader = response.body.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > PAGE_BYTE_LIMIT) {
            await reader.cancel();
            throw new Error('订阅页面超过 2 MiB 上限');
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
    }
    return {
      url,
      body: Buffer.concat(chunks, length),
      charset: /charset=["']?([\w-]+)/i.exec(type)?.[1],
      fetchedAt: new Date().toISOString(),
    };
  }
  throw new Error('订阅页面重定向失败');
}
