import { htmlToMarkdown } from '@mdream/js';
import { clean } from '@mdream/js/clean';
import { extractionPlugin, filterPlugin } from '@mdream/js/plugins';
import { open } from 'node:fs/promises';
import { prepareDocumentFile } from '../resources';
import { fetchDeepSeek } from './deepseek';

// 抓取的站点没有官方契约；使用桌面 Chrome UA，降低被判定为机器人的概率。
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const REQUEST_TIMEOUT_MS = 15000;
const PAGE_BYTE_LIMIT = 2 * 1024 * 1024;
const DOCUMENT_BYTE_LIMIT = 128 * 1024 * 1024;
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
  readable?: false;
  document?: Awaited<ReturnType<typeof prepareDocumentFile>>;
  note?: string;
}

export async function fetchWebPage(
  rawUrl: string,
  offset = 0,
  deepseek?: { apiKey: string },
): Promise<WebPageContent> {
  const fetchedAt = new Date().toISOString();
  const finish = (
    url: URL,
    title: string | null,
    contentType: string,
    fullText: string,
    bytesTruncated: boolean,
    extraNotes: string[] = [],
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
      ...(notes.length ? { note: notes.join('；') } : {}),
    };
  };
  let url = httpUrl(rawUrl);
  if (deepseek && !looksLikePdfUrl(url)) {
    try {
      const page = await fetchDeepSeek(url.toString(), deepseek.apiKey);
      if (page.text.trim())
        return finish(url, page.title, 'text/markdown', page.text.replace(/\r\n/g, '\n'), false);
    } catch {
      // 注册了 DeepSeek 也不该让抓取失去可用性：取不到正文（404）或临时故障时回退本地抓取。
    }
  }
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
    await response.body?.cancel();
    if (hop >= MAX_REDIRECTS) throw new Error('网页重定向次数过多');
    url = httpUrl(new URL(location, url).toString());
  }
  if (!response!.ok) throw new Error(`网页请求失败（HTTP ${response!.status}）`);
  const contentType = response!.headers.get('content-type') ?? '';
  const peeked = await peekResponse(response!);
  const looksLikePdf =
    contentType.toLowerCase().includes('pdf') ||
    new TextDecoder('latin1').decode(peeked.prefix.subarray(0, 5)) === '%PDF-';
  if (looksLikePdf) {
    try {
      const document = await prepareDocumentFile((path) => saveDocument(peeked.response, path));
      return {
        ...finish(url, null, contentType || 'application/pdf', '', false),
        readable: false,
        document,
        note: '此地址返回 PDF，已保存完整临时文件。使用 document-reading skill，直接用 document 中的 python、script、input、output 解析并读取正文或页面图片，无需再次 prepare_document；完成后用 document.jobId 调用 dela release_document。',
      };
    } finally {
      await peeked.response.body?.cancel().catch(() => {});
    }
  }
  if (/^(image|audio|video)\//.test(contentType)) {
    await peeked.response.body?.cancel();
    throw new Error('该地址是媒体文件，不是网页');
  }
  const { bytes, truncated: bytesTruncated } = await readCapped(peeked.response);
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

async function peekResponse(response: Response) {
  if (!response.body) return { response, prefix: new Uint8Array() };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (length < 5) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    length += value.length;
  }
  const prefix = Buffer.concat(chunks);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
    },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel: (reason) => reader.cancel(reason),
  });
  return { response: new Response(body, { headers: response.headers }), prefix };
}

async function saveDocument(response: Response, path: string): Promise<void> {
  if (Number(response.headers.get('content-length')) > DOCUMENT_BYTE_LIMIT)
    throw new Error('文档超过 128 MiB 下载上限，未解析截断内容');
  const reader = response.body?.getReader();
  const file = await open(path, 'wx');
  let length = 0;
  try {
    if (!reader) throw new Error('文档响应为空');
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > DOCUMENT_BYTE_LIMIT)
        throw new Error('文档超过 128 MiB 下载上限，未解析截断内容');
      await file.writeFile(value);
    }
  } finally {
    await file.close();
    await reader?.cancel().catch(() => {});
    reader?.releaseLock();
  }
}

const looksLikePdfUrl = (url: URL) => /\.pdf$/i.test(url.pathname);

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
