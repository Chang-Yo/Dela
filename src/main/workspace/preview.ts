import { protocol } from 'electron';
import { createReadStream } from 'node:fs';
import { stat as fileStat } from 'node:fs/promises';
import { extname } from 'node:path';
import { Readable } from 'node:stream';
import { canvasPreviewPath } from '../canvas/api';
import { officeZipMime } from '../resource-parse';
import { handleShuiyuanMediaRequest } from '../shuiyuan/media';
import { remoteById, targetOf, withinRemoteRoot } from '../remotes/api';
import { readRemoteRange, statRemoteFile } from '../remotes/operations';
import { remoteDocumentMime } from '../remotes/documents';
import { projectLocation, resolveWorkspaceAsset, workspacePreviewPath } from './api';

const previewScheme = 'dela-resource';

export function registerPreviewScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: previewScheme,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}
// 预览协议放行的文件类型与响应 content-type；路径放行由 canvasPreviewPath/workspacePreviewPath 决定。
const previewContentType: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': officeZipMime.docx,
  '.xlsx': officeZipMime.xlsx,
  '.pptx': officeZipMime.pptx,
};

async function fileResponse(path: string, request: Request): Promise<Response> {
  const size = (await fileStat(path)).size;
  const contentType = previewContentType[extname(path).toLowerCase()] ?? 'application/octet-stream';
  const headers = documentHeaders(request, contentType);
  const range = rangeOf(request.headers.get('range'), size);
  if (!range) {
    headers.set('content-range', `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }
  if (range.status === 206)
    headers.set('content-range', `bytes ${range.start}-${range.end}/${size}`);
  headers.set('content-length', String(size ? range.end - range.start + 1 : 0));
  const body =
    request.method === 'HEAD' || size === 0
      ? null
      : (Readable.toWeb(createReadStream(path, { start: range.start, end: range.end })) as never);
  return new Response(body, { status: range.status, headers });
}

function documentHeaders(request: Request, contentType: string): Headers {
  return new Headers({
    'accept-ranges': 'bytes',
    'access-control-allow-origin':
      request.headers.get('origin') === 'http://127.0.0.1:5173' ? 'http://127.0.0.1:5173' : 'null',
    'access-control-expose-headers': 'Accept-Ranges, Content-Length, Content-Range',
    'content-disposition': 'inline',
    'content-type': contentType,
    'x-content-type-options': 'nosniff',
  });
}

/** Range 解析：单段区间返回起止与状态码；多段或不满足返回 null（调用方回 416）。 */
function rangeOf(
  header: string | null,
  size: number,
): { start: number; end: number; status: number } | null {
  const end = Math.max(0, size - 1);
  if (!header) return { start: 0, end, status: 200 };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  let start: number;
  let last: number;
  if (match[1]) {
    start = Number(match[1]);
    last = match[2] ? Math.min(Number(match[2]), end) : end;
  } else {
    start = Math.max(0, end + 1 - Number(match[2]));
    last = end;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(last) || start > last || start >= size)
    return null;
  return { start, end: last, status: 206 };
}

/** 远端文档一次拉回的字节数：Range 语义与本地一致，但字节由 helper 分块拉，不整篇进内存。 */
const remoteChunkSize = 1024 * 1024;

/**
 * dela-resource://remote/<projectId>?path=<远端绝对路径>：PDF/Office 预览的字节流。
 * 只服务项目根目录内的文件；每次 pull 只向 helper 要一块，PDF 阅读器跳页取消流即停。
 */
async function remoteFileResponse(
  projectId: string,
  path: string,
  request: Request,
): Promise<Response> {
  const location = projectLocation(projectId);
  if (location.kind !== 'remote') throw new Error('项目不是远端项目');
  if (!withinRemoteRoot(location.path, path)) throw new Error('远端路径不在项目根目录内');
  const target = targetOf(remoteById(location.remoteId));
  const entry = await statRemoteFile(target, path);
  const size = entry.size ?? 0;
  const headers = documentHeaders(request, remoteDocumentMime(path));
  const range = rangeOf(request.headers.get('range'), size);
  if (!range) {
    headers.set('content-range', `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }
  if (range.status === 206)
    headers.set('content-range', `bytes ${range.start}-${range.end}/${size}`);
  headers.set('content-length', String(size ? range.end - range.start + 1 : 0));
  if (request.method === 'HEAD' || size === 0)
    return new Response(null, { status: range.status, headers });
  let offset = range.start;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (offset > range.end) {
        controller.close();
        return;
      }
      try {
        const chunk = await readRemoteRange(
          target,
          path,
          offset,
          Math.min(remoteChunkSize, range.end - offset + 1),
        );
        if (!chunk.length) {
          controller.close();
          return;
        }
        offset += chunk.length;
        controller.enqueue(new Uint8Array(chunk));
      } catch (error) {
        controller.error(error);
      }
    },
  });
  return new Response(body as never, { status: range.status, headers });
}

export function registerPreviewProtocol(): void {
  protocol.handle(previewScheme, async (request) => {
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD')
        return new Response(null, { status: 405 });
      const url = new URL(request.url);
      if (url.hostname === 'shuiyuan') return handleShuiyuanMediaRequest(request);
      // 远端文档：dela-resource://remote/<projectId>?path=<远端绝对路径>（PDF/Office 按 Range 分块拉）；
      // remote-raw 同一实现，供 Markdown 里的相对图片取字节（都只放行项目根目录内的路径）。
      if (url.hostname === 'remote' || url.hostname === 'remote-raw') {
        const projectId = decodeURIComponent(url.pathname.slice(1));
        const path = url.searchParams.get('path');
        if (!projectId || !path) throw new Error('无效的远端文档地址');
        return await remoteFileResponse(projectId, path, request);
      }
      // 笔记/导入文档的相对图片：dela-resource://note-asset/<ref>?id=<条目ID>。
      // 协议只是显示通道；解析按条目目录约束，不向 renderer 开放任意磁盘读取。
      if (url.hostname === 'note-asset') {
        const id = url.searchParams.get('id');
        const ref = decodeURIComponent(url.pathname.slice(1));
        if (!id || !ref || ref.includes('\\')) throw new Error('无效的图片地址');
        const { path, mime } = resolveWorkspaceAsset(id, ref);
        const size = (await fileStat(path)).size;
        const headers = new Headers({
          'content-type': mime,
          'content-length': String(size),
          'cache-control': 'no-cache',
          'x-content-type-options': 'nosniff',
        });
        const body =
          request.method === 'HEAD' || size === 0
            ? null
            : (Readable.toWeb(createReadStream(path)) as never);
        return new Response(body, { status: 200, headers });
      }
      const id = decodeURIComponent(url.pathname.slice(1));
      if (!id || (url.hostname !== 'workspace' && (id.includes('/') || id.includes('\\'))))
        throw new Error('无效的文档地址');
      const path =
        url.hostname === 'canvas'
          ? await canvasPreviewPath(id)
          : url.hostname === 'workspace'
            ? workspacePreviewPath(id)
            : null;
      if (!path) throw new Error('无效的文档地址');
      return await fileResponse(path, request);
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}
