import { app } from 'electron';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { resourceRefSchema, type ResourceRef } from '../shared/resources';
import { canvasFilePath } from './canvas/api';
import { readMailMessage, saveMailAttachment } from './mail/api';
import { importWorkspaceFiles, workspaceFilePath } from './workspace/api';
import { diskName } from './storage';

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
    .object({ source: resourceRefSchema, parentId: z.string().uuid() })
    .strict()
    .parse(input);
  return withResourceFile(source, (path) => {
    const [entry] = importWorkspaceFiles(parentId, [path]);
    return { ref: { type: 'workspace' as const, id: entry!.id }, entry: entry! };
  });
}
