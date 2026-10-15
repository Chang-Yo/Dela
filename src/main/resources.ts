import { app } from 'electron';
import { copyFile, mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { z } from 'zod';
import { resourceRefSchema, type ResourceRef } from '../shared/resources';
import { canvasFilePath } from './canvas/api';
import { readMailMessage, saveMailAttachment } from './mail/api';
import { importWorkspaceFiles, workspaceFilePath } from './workspace/api';
import { diskName } from './storage';
import { workspaceEntryIdSchema } from '../shared/workspace';
import { DOCUMENT_SKILL, assertDocumentDependency, documentPython } from './documents/runtime';

const documentJobs = () => join(app.getPath('temp'), 'dela-document-reading');
const jobIdSchema = z.string().regex(/^job-[A-Za-z0-9]{6}$/);

export async function prepareDocumentResource(ref: ResourceRef) {
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
    const input = await withResourceFile(ref, async (path) => {
      const copy = join(job, 'input');
      await copyFile(path, copy);
      return copy;
    });
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
