import { protocol } from 'electron';
import { createReadStream } from 'node:fs';
import { stat as fileStat } from 'node:fs/promises';
import { extname } from 'node:path';
import { Readable } from 'node:stream';
import { canvasPreviewPath } from '../canvas/api';
import { officeZipMime } from '../resource-parse';
import { handleShuiyuanMediaRequest } from '../shuiyuan/media';
import { resolveWorkspaceAsset, workspacePreviewPath } from './api';

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
  const headers = new Headers({
    'accept-ranges': 'bytes',
    'access-control-allow-origin':
      request.headers.get('origin') === 'http://127.0.0.1:5173' ? 'http://127.0.0.1:5173' : 'null',
    'access-control-expose-headers': 'Accept-Ranges, Content-Length, Content-Range',
    'content-disposition': 'inline',
    'content-type': contentType,
    'x-content-type-options': 'nosniff',
  });
  let start = 0;
  let end = Math.max(0, size - 1);
  let status = 200;
  const range = request.headers.get('range');
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) {
      headers.set('content-range', `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }
    if (match[1]) {
      start = Number(match[1]);
      end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    } else {
      const suffix = Number(match[2]);
      start = Math.max(0, size - suffix);
      end = size - 1;
    }
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start > end ||
      start >= size
    ) {
      headers.set('content-range', `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }
    status = 206;
    headers.set('content-range', `bytes ${start}-${end}/${size}`);
  }
  headers.set('content-length', String(size ? end - start + 1 : 0));
  const body =
    request.method === 'HEAD' || size === 0
      ? null
      : (Readable.toWeb(createReadStream(path, { start, end })) as never);
  return new Response(body, { status, headers });
}

export function registerPreviewProtocol(): void {
  protocol.handle(previewScheme, async (request) => {
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD')
        return new Response(null, { status: 405 });
      const url = new URL(request.url);
      if (url.hostname === 'shuiyuan') return handleShuiyuanMediaRequest(request);
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
