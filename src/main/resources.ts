import { app, shell } from 'electron';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { resourceRefSchema, type ResourceRef } from '../shared/resources';
import { cachedFile, canvasFilePath, getSource, readCanvasPage } from './canvas/api';
import { mailAttachment, readMailMessage, saveMailAttachment } from './mail/api';
import { entry, importWorkspaceFiles, workspaceFilePath } from './workspace/api';
import { readShuiyuanSource } from './shuiyuan/api';
import { imageFileExtensions, textFileExtensions } from '../shared/chat-input';
import { diskName } from './storage';
import { workspaceEntryIdSchema } from '../shared/workspace';
import { DOCUMENT_SKILL, assertDocumentDependency, documentPython } from './documents/runtime';

interface ResourceContent {
  title: string;
  format: 'file' | 'text' | 'markdown' | 'html' | 'image' | 'unsupported';
  text?: string;
  bytes?: Uint8Array;
  mime?: string;
  revision?: string;
  url?: string;
}

async function readCanvasResource(id: string): Promise<ResourceContent> {
  const source = getSource(id);
  if (source.kind !== 'file') return readCanvasPage(id);
  if (!imageFileExtensions.some((ext) => source.mime === `image/${ext === 'jpg' ? 'jpeg' : ext}`))
    return { title: source.title, format: 'file' };
  const cached = await cachedFile(source);
  return {
    title: source.title,
    format: 'image',
    bytes: await readFile(cached.path),
    mime: cached.mime,
  };
}

/** Agent 的资源读取不生成预览地址、不查询 Office 导出，也不枚举解析格式。 */
export async function readResourceContent(
  ref: Extract<ResourceRef, { type: 'workspace' | 'canvas' | 'attachment' }>,
): Promise<ResourceContent> {
  if (ref.type === 'canvas') return readCanvasResource(ref.id);
  if (ref.type === 'attachment') {
    const { attachment } = mailAttachment(ref.messageId, ref.part);
    return { title: attachment.filename, format: 'file' };
  }
  const item = entry(ref.id);
  if (item.kind === 'source' && item.sourceId) {
    if (item.sourceId.startsWith('shuiyuan-topic:')) {
      const content = await readShuiyuanSource(
        Number(item.sourceId.slice('shuiyuan-topic:'.length)),
      );
      return {
        title: content.title,
        format: content.format === 'text' ? 'text' : 'html',
        text: content.text,
        url: content.url,
      };
    }
    return readCanvasResource(item.sourceId);
  }
  if (item.kind !== 'note' && item.kind !== 'local' && item.kind !== 'imported')
    throw new Error('请选择要读取的文件或笔记');
  const extension = extname(item.path ?? item.name)
    .slice(1)
    .toLowerCase();
  const text = item.kind === 'note' || textFileExtensions.includes(extension);
  const image = imageFileExtensions.includes(extension);
  if (!text && !image) return { title: item.name, format: 'file' };
  const path = await workspaceFilePath(ref.id);
  const stats = await stat(path);
  if (stats.size > 128 * 1024 * 1024) throw new Error('文件较大，请在外部应用中打开');
  const bytes = await readFile(path);
  if (text) {
    const content = bytes.toString('utf8');
    return {
      title: item.name,
      format: extension === 'md' || extension === 'markdown' ? 'markdown' : 'text',
      text: content,
      revision: createHash('sha256').update(content).digest('hex'),
    };
  }
  return {
    title: item.name,
    format: 'image',
    bytes,
    mime: `image/${extension === 'jpg' ? 'jpeg' : extension}`,
    revision: `${stats.mtimeMs}-${stats.size}`,
  };
}

const documentJobs = () => join(app.getPath('temp'), 'dela-document-reading');
const jobIdSchema = z.string().regex(/^job-[A-Za-z0-9]{6}$/);

export async function prepareDocumentResource(ref: ResourceRef) {
  return prepareDocumentFile((input) => withResourceFile(ref, (path) => copyFile(path, input)));
}

export async function prepareDocumentFile(writeInput: (path: string) => Promise<void>) {
  assertDocumentDependency();
  const root = documentJobs();
  await mkdir(root, { recursive: true });
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !jobIdSchema.safeParse(entry.name).success) continue;
    const path = join(root, entry.name);
    if (Date.now() - (await stat(path)).mtimeMs > 24 * 60 * 60 * 1000)
      await rm(path, { recursive: true, force: true });
  }
  const job = await mkdtemp(join(root, 'job-'));
  try {
    const input = join(job, 'input');
    await writeInput(input);
    return {
      jobId: basename(job),
      python: documentPython(),
      script: join(app.getPath('home'), '.dela', 'skills', DOCUMENT_SKILL, 'scripts', 'read.py'),
      input,
      output: join(job, 'output'),
    };
  } catch (error) {
    await rm(job, { recursive: true, force: true });
    throw error;
  }
}

export async function releaseDocumentResource(jobId: unknown): Promise<void> {
  await rm(join(documentJobs(), jobIdSchema.parse(jobId)), { recursive: true, force: true });
}

export async function withResourceFile<T>(
  source: ResourceRef,
  consume: (path: string) => Promise<T> | T,
): Promise<T> {
  source = resourceRefSchema.parse(source);
  if (source.type === 'canvas') return consume(await canvasFilePath(source.id));
  if (source.type === 'workspace') return consume(await workspaceFilePath(source.id));
  if (source.type !== 'attachment') throw new Error('请选择项目文件、Canvas 文件或邮件附件');
  const mail = await readMailMessage(source.messageId);
  const attachment = mail.attachments.find((item) => item.part === source.part);
  if (!attachment) throw new Error('附件不存在，请先同步邮件');
  const temporaryDirectory = await mkdtemp(join(app.getPath('temp'), 'dela-attachment-'));
  try {
    const path = join(temporaryDirectory, diskName(attachment.filename));
    await saveMailAttachment(source.messageId, source.part, path);
    return await consume(path);
  } finally {
    // Only remove the temporary directory created by this call.
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function copyResourceToProject(input: unknown) {
  const { source, parentId } = z
    .object({ source: resourceRefSchema, parentId: workspaceEntryIdSchema })
    .strict()
    .parse(input);
  return withResourceFile(source, (path) => {
    const [entry] = importWorkspaceFiles(parentId, [path]);
    return { ref: { type: 'workspace' as const, id: entry!.id }, entry: entry! };
  });
}

/** 用系统默认应用打开资源的本地源文件（pptx 关联通常指向 PowerPoint）。与导出 PDF 一样
 *  只支持 Canvas 资料与我的资料条目；邮件附件要落临时目录，启动竞态下会被清理，不放行。 */
export async function openResourceFile(ref: ResourceRef): Promise<void> {
  const parsed = resourceRefSchema.parse(ref);
  if (parsed.type !== 'canvas' && parsed.type !== 'workspace')
    throw new Error('仅支持资料文件与我的资料条目');
  const path =
    parsed.type === 'canvas' ? await canvasFilePath(parsed.id) : await workspaceFilePath(parsed.id);
  const error = await shell.openPath(path);
  if (error) throw new Error(`无法用系统默认程序打开：${error}`);
}
