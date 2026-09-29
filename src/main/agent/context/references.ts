import { z } from 'zod';
import { readCanvasSource } from '../../canvas/api';
import { readShuiyuanSource } from '../../shuiyuan/api';
import { readWorkspaceEntry } from '../../workspace/api';
import { readChatAttachment } from '../session/media';

const idSchema = z.string().uuid();

export type ReferenceDocument = { key: string; title: string; text: string };
export type AttachmentDocument = { name: string; text: string };

/** @ 引用与附件的读取、净化、体积校验；正文超限在持久化前拒绝。 */
export async function readAskReferences(
  context: string[],
  attachments: string[],
): Promise<{ documents: ReferenceDocument[]; attachmentDocs: AttachmentDocument[] }> {
  const documents = await Promise.all(
    context.map(async (key) => {
      const sourceKey = key.startsWith('source:') ? key.slice(7) : null;
      const content = sourceKey
        ? sourceKey.startsWith('shuiyuan-topic:')
          ? await readShuiyuanSource(Number(sourceKey.slice('shuiyuan-topic:'.length)))
          : await readCanvasSource(sourceKey)
        : await readWorkspaceEntry(idSchema.parse(key));
      if (!['markdown', 'text', 'html'].includes(content.format))
        throw new Error(`“${content.title}”暂不支持全文问答，可粘贴需要讨论的文字`);
      const text =
        content.format === 'html'
          ? (content.text ?? '')
              .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
              .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
              .replace(/<[^>]*>/g, ' ')
          : (content.text ?? '');
      return { key, title: content.title, text };
    }),
  );
  // 附件是内存暂存：读出即消费；失败发生在持久化前，composer 会原样恢复草稿。
  const attachmentDocs = attachments.map((id) => {
    const attachment = readChatAttachment(id);
    return { name: attachment.name, text: attachment.bytes.toString('utf8') };
  });
  if (
    documents.reduce((total, doc) => total + doc.text.length, 0) +
      attachmentDocs.reduce((total, doc) => total + doc.text.length, 0) >
    100000
  )
    throw new Error('所选资料与附件过长，请减少资料或粘贴相关段落');
  return { documents, attachmentDocs };
}
