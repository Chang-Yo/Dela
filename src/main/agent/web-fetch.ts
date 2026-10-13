import { htmlToMarkdown } from '@mdream/js';
import { clean } from '@mdream/js/clean';
import { extractionPlugin, filterPlugin } from '@mdream/js/plugins';
import { extractDocumentBytes } from '../documents/parse';

// 抓取的站点没有官方契约；使用桌面 Chrome UA，降低被判定为机器人的概率。
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const REQUEST_TIMEOUT_MS = 15000;
const PAGE_BYTE_LIMIT = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;
// 单次返回的字符数；超出部分经 offset 续读，分页本身不截断。
const TEXT_LIMIT = 20000;

interface WebPageContent {
  source: { url: string; fetchedAt: string };
  title: string | null;
  contentType: string;
  text: string;
  totalCharacters: number;
  nextOffset: number | null;
  truncated: boolean;
  pages?: number;
  hasTextLayer?: boolean;
  note?: string;
}

export async function fetchWebPage(rawUrl: string, offset = 0): Promise<WebPageContent> {
  const fetchedAt = new Date().toISOString();
  const finish = (
    url: URL,
    title: string | null,
    contentType: string,
    fullText: string,
    bytesTruncated: boolean,
    extraNotes: string[] = [],
    extra?: Pick<WebPageContent, 'pages' | 'hasTextLayer'>,
  ): WebPageContent => {
    const notes = [...extraNotes];
    if (bytesTruncated) notes.push('页面超过 2MB 读取上限，内容可能不完整');
    const nextOffset = offset + TEXT_LIMIT < fullText.length ? offset + TEXT_LIMIT : null;
    if (nextOffset !== null)
      notes.push(
        `正文共 ${fullText.length} 字符，本次返回第 ${offset}–${nextOffset} 字符；传 offset=${nextOffset} 续读`,
      );
    return {
      source: { url: url.toString(), fetchedAt },
      title,
      contentType,
      text: fullText.slice(offset, offset + TEXT_LIMIT),
      totalCharacters: fullText.length,
      nextOffset,
      truncated: bytesTruncated,
      ...(extra ?? {}),
      ...(notes.length ? { note: notes.join('；') } : {}),
    };
  };
  let url = httpUrl(rawUrl);
  let response: Response | null = null;
  for (let hop = 0; ; hop += 1) {
    response = await fetch(url, {
      redirect: 'manual',
      headers: {
        'user-agent': BROWSER_UA,
        accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const location =
      response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
    if (!location) break;
    if (hop >= MAX_REDIRECTS) throw new Error('网页重定向次数过多');
    url = httpUrl(new URL(location, url).toString());
  }
  if (!response!.ok) throw new Error(`网页请求失败（HTTP ${response!.status}）`);
  const { bytes, truncated: bytesTruncated } = await readCapped(response!);
  const contentType = response!.headers.get('content-type') ?? '';
  const looksLikePdf =
    contentType.toLowerCase().includes('pdf') ||
    new TextDecoder('latin1').decode(bytes.subarray(0, 5)) === '%PDF-';
  if (looksLikePdf) {
    const parsed = await extractDocumentBytes(bytes, 'page.pdf');
    return finish(
      url,
      null,
      contentType || 'application/pdf',
      parsed.text,
      bytesTruncated,
      parsed.hasTextLayer ? [] : ['PDF 无文本层（扫描件），提取不到文字'],
      { pages: parsed.pages, hasTextLayer: parsed.hasTextLayer },
    );
  }
  if (/^(image|audio|video)\//.test(contentType)) throw new Error('该地址是媒体文件，不是网页');
  const charset = /charset=([\w-]+)/i.exec(contentType)?.[1];
  let source: string;
  try {
    source = new TextDecoder(charset).decode(bytes);
  } catch {
    source = new TextDecoder().decode(bytes);
  }
  const isMarkup = /text\/html|application\/xhtml/i.test(contentType) || !contentType;
  const { title, text } = isMarkup
    ? htmlToPage(source, url.toString())
    : { title: null, text: source };
  const normalized = text.replace(/\r\n/g, '\n');
  return finish(url, title, contentType || 'text/html', normalized, bytesTruncated);
}

function httpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('不是有效的 URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('只支持 http(s) 地址');
  return url;
}

async function readCapped(response: Response): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!response.body)
    return { bytes: new Uint8Array(await response.arrayBuffer()), truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (length + value.length > PAGE_BYTE_LIMIT) {
      chunks.push(value.subarray(0, PAGE_BYTE_LIMIT - length));
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
    length += value.length;
  }
  return { bytes: Buffer.concat(chunks), truncated };
}

function htmlToPage(html: string, origin: string): { title: string | null; text: string } {
  let title: string | null = null;
  // 不用 minimal 的正文启发式与 Tailwind 过滤，避免无标题或定位布局的正文被误删。
  const text = htmlToMarkdown(html, {
    origin,
    clean: clean(),
    plugins: [
      extractionPlugin({
        title: (element) => {
          title = element.textContent.trim() || null;
        },
      }),
      filterPlugin({
        exclude: ['nav', 'footer', 'script', 'style', 'noscript', 'svg', 'template'],
      }),
    ],
  });
  return { title, text };
}
