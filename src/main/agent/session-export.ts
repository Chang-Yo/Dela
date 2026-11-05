import { createWriteStream } from 'node:fs';
import { mkdtemp, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { dialog, type BrowserWindow } from 'electron';
import type { ImageContent } from '@earendil-works/pi-ai';
import { ZipFile } from 'yazl';
import { extensionOf } from '../../shared/files';
import { chatMediaPath } from './media';
import { row, sessionExportBranch, splitMeta, textOf } from './session';

const imageExtensions: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
const documentStart = '用户上传了文档附件：';
const textEnd = '\n</attachment>\n';
const textStart = (name: string) => '<attachment name="' + name + '">\n';

function inlineTextEnd(embedded: string, start: number, nextName?: string) {
  for (
    let end = embedded.indexOf(textEnd, start);
    end !== -1;
    end = embedded.indexOf(textEnd, end + textEnd.length)
  ) {
    const next = end + textEnd.length;
    if (nextName === undefined) {
      if (
        next === embedded.length ||
        embedded.startsWith('用户选中了你之前回复中的片段并留下评论', next)
      )
        return end;
    } else if (
      embedded.startsWith(textStart(nextName), next) ||
      embedded.startsWith(documentStart, next)
    ) {
      return end;
    }
  }
  return -1;
}

function safeName(name: string) {
  return Array.from(name.replace(/[<>:"/\\|?*\p{Cc}]/gu, '_'))
    .slice(0, 60)
    .join('')
    .replace(/[. ]+$/g, '');
}

function safeArchiveName(name: string) {
  const extension = extensionOf(name);
  const suffix = /^\.[a-z0-9]{1,12}$/.test(extension) ? name.slice(-extension.length) : '';
  return (safeName(name.slice(0, name.length - suffix.length)) || '文件') + suffix;
}

export async function exportSession(id: string, owner: BrowserWindow | null) {
  const { title } = row(id);
  const options = {
    title: '导出会话',
    defaultPath: 'Dela - ' + (safeName(title) || '会话') + '.zip',
    filters: [{ name: 'ZIP', extensions: ['zip'] }],
  };
  const { canceled, filePath } = owner
    ? await dialog.showSaveDialog(owner, options)
    : await dialog.showSaveDialog(options);
  if (canceled || !filePath) return { saved: false, missing: [] };
  if (!filePath.toLowerCase().endsWith('.zip')) throw new Error('请选择 .zip 保存位置');

  const branch = await sessionExportBranch(id);
  if (!branch.some((entry) => entry.type === 'message'))
    throw new Error('这个会话还没有可导出的记录');
  const staging = await mkdtemp(join(dirname(filePath), '.dela-export-'));
  const temporaryZip = join(staging, 'session.zip');
  try {
    const missing = await writeSessionArchive(temporaryZip, title, branch);
    await rename(temporaryZip, filePath);
    return { saved: true, missing };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function writeSessionArchive(
  path: string,
  title: string,
  branch: Awaited<ReturnType<typeof sessionExportBranch>>,
) {
  const missing: string[] = [];
  const zip = new ZipFile();
  const records: unknown[] = [{ type: 'session', version: 1, title }];
  let fileNumber = 0;
  let imageNumber = 0;
  const addImage = (image: ImageContent, name?: string) => {
    const extension = imageExtensions[image.mimeType] ?? 'bin';
    const path = 'media/' + ++imageNumber + '.' + extension;
    zip.addReadStreamLazy(path, { compress: false }, (open) =>
      open(null, Readable.from(Buffer.from(image.data, 'base64'))),
    );
    return { path, name, mimeType: image.mimeType };
  };

  for (const entry of branch) {
    if (entry.type !== 'message') continue;
    const message = entry.message;
    const { timestamp } = message;
    if (message.role === 'user') {
      const { meta, text, rest = '' } = splitMeta(textOf(message.content));
      const images = (typeof message.content === 'string' ? [] : message.content)
        .filter((block) => block.type === 'image')
        .map((image, index) => addImage(image, meta.images?.[index]?.name));
      // 文本附件没有磁盘副本，正文来自 Dela 写入提示词的附件块。
      const sourcePrefix = meta.sources?.length
        ? '用户引用了这些文件（需要时用 read 读取）：\n' +
          meta.sources.map(({ key }) => '- ' + key).join('\n') +
          '\n'
        : '';
      let embedded = rest.slice(sourcePrefix.length, rest.length - text.length);
      const attachments = meta.attachments ?? [];
      const files = attachments.map(({ id, name }, index) => {
        const path = 'files/' + ++fileNumber + '-' + safeArchiveName(name);
        const source = id && chatMediaPath(id);
        const start = textStart(name);
        if (embedded.startsWith(start)) {
          const end = inlineTextEnd(embedded, start.length, attachments[index + 1]?.name);
          if (end !== -1) {
            zip.addBuffer(Buffer.from(embedded.slice(start.length, end)), path);
            embedded = embedded.slice(end + textEnd.length);
            return { name, path };
          }
        }
        if (embedded.startsWith(documentStart))
          embedded = embedded.slice(embedded.indexOf('\n') + 1);
        if (source) {
          zip.addFile(source, path);
          return { name, path };
        }
        missing.push(name);
        return { name, path: null };
      });
      records.push({
        type: 'user',
        timestamp,
        turnId: meta.turnId,
        text,
        images,
        files,
        comments: meta.comments,
        sources: meta.sources,
      });
    } else if (message.role === 'assistant') {
      for (const block of message.content) {
        if (block.type === 'text' && block.text)
          records.push({ type: 'assistant', timestamp, text: block.text });
        if (block.type === 'toolCall')
          records.push({
            type: 'tool_call',
            timestamp,
            id: block.id,
            name: block.name,
            arguments: block.arguments,
          });
      }
    } else if (message.role === 'toolResult') {
      records.push({
        type: 'tool_result',
        timestamp,
        callId: message.toolCallId,
        name: message.toolName,
        isError: message.isError,
        text: textOf(message.content),
        images: message.content
          .filter((block) => block.type === 'image')
          .map((image) => addImage(image)),
      });
    }
  }

  zip.addBuffer(
    Buffer.from(records.map((record) => JSON.stringify(record)).join('\n') + '\n'),
    'session.jsonl',
  );
  const output = createWriteStream(path, { flags: 'wx' });
  zip.on('error', (error) => output.destroy(error));
  const written = pipeline(zip.outputStream, output);
  zip.end();
  await written;
  return missing;
}
