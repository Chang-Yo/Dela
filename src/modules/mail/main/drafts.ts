import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { z } from 'zod';
import type { MailComposeFile, PreparedEmail, MailDraftSummary } from '../../shared/api';
import { resourceRefSchema } from '../../shared/resources';
import { getDatabase } from '../database';
import { withResourceFile } from '../resources';
import {
  addComposeAttachment,
  releaseComposeFiles,
  restoreComposeFile,
  snapshotComposeFiles,
} from './send';

const localDraftSchema = z.object({
  id: z.string().uuid(),
  account: z.string().max(320),
  recipientText: z.string().max(20000),
  subject: z.string().max(500),
  text: z.string().max(2000000),
  html: z.string().max(2000000),
  updatedAt: z.string().datetime(),
  files: z
    .array(
      z.object({
        id: z.string().uuid(),
        name: z.string().max(1000),
        kind: z.enum(['attachment', 'inline']),
        data: z.string(),
      }),
    )
    .max(50),
});

/** 调用方均已将 id 校验为 uuid；此函数只负责拼出草稿文件路径。 */
function draftPath(id: string) {
  return join(app.getPath('userData'), 'mail-drafts', `${id}.json`);
}

export function saveLocalDraft(input: unknown): MailDraftSummary {
  const args = z
    .object({
      id: z.string().uuid().optional(),
      account: z.string().max(320),
      recipientText: z.string().max(20000),
      subject: z.string().max(500),
      text: z.string().max(2000000),
      html: z.string().max(2000000),
      attachmentIds: z.array(z.string().uuid()).max(30),
      inlineImageIds: z.array(z.string().uuid()).max(20),
    })
    .strict()
    .parse(input);
  const id = args.id ?? randomUUID();
  const files = snapshotComposeFiles(args.attachmentIds, args.inlineImageIds);
  const updatedAt = new Date().toISOString();
  const path = draftPath(id),
    temporary = `${path}.${randomUUID()}.tmp`;
  mkdirSync(join(app.getPath('userData'), 'mail-drafts'), { recursive: true });
  const summary = { id, subject: args.subject, recipientText: args.recipientText, updatedAt };
  try {
    writeFileSync(
      temporary,
      JSON.stringify({
        ...summary,
        account: args.account,
        text: args.text,
        html: args.html,
        files,
      }),
      { flag: 'wx' },
    );
    renameSync(temporary, path);
    getDatabase()
      .prepare('INSERT OR REPLACE INTO workspace_settings VALUES (?, ?)')
      .run(`mail-draft:${id}`, JSON.stringify({ ...summary, account: args.account }));
    return summary;
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

export function listLocalDrafts(account: unknown): MailDraftSummary[] {
  const address = z.string().max(320).parse(account);
  const rows = getDatabase()
    .prepare("SELECT value FROM workspace_settings WHERE key LIKE 'mail-draft:%'")
    .all() as { value: string }[];
  return rows
    .map((row) => JSON.parse(row.value) as MailDraftSummary & { account: string })
    .filter((row) => row.account === address)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function deleteLocalDraft(value: unknown): void {
  const id = z.string().uuid().parse(value),
    path = draftPath(id);
  if (existsSync(path)) unlinkSync(path);
  getDatabase().prepare('DELETE FROM workspace_settings WHERE key=?').run(`mail-draft:${id}`);
}

function openLocalDraft(id: string): PreparedEmail {
  const path = draftPath(id);
  if (statSync(path).size > 105 * 1024 * 1024) throw new Error('草稿文件过大');
  const draft = localDraftSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  const files: MailComposeFile[] = [];
  let html = draft.html,
    total = 0;
  try {
    for (const stored of draft.files) {
      const content = Buffer.from(stored.data, 'base64');
      total += content.length;
      if (total > 70 * 1024 * 1024) throw new Error('附件总大小超过 70 MB');
      const file = restoreComposeFile(stored.name, stored.kind, content);
      files.push(file);
      html = html.replaceAll(`cid:${stored.id}@dela`, `cid:${file.id}@dela`);
    }
    return {
      id,
      to: [],
      recipientText: draft.recipientText,
      subject: draft.subject,
      text: draft.text,
      html,
      files,
      savedLocally: true,
    };
  } catch (error) {
    releaseComposeFiles(files.map((file) => file.id));
    throw error;
  }
}

export const emailDraftSchema = z
  .object({
    to: z.array(z.email()).min(1).max(50),
    subject: z.string().max(500),
    text: z.string().max(1000000),
    attachments: z.array(resourceRefSchema).max(30).default([]),
  })
  .strict();

export function prepareEmail(input: unknown) {
  const draft = emailDraftSchema.parse(input);
  if (draft.attachments.some((ref) => ref.type === 'mail'))
    throw new Error('附件必须引用文件或邮件附件，不能引用整封邮件');
  const id = randomUUID();
  getDatabase()
    .prepare('INSERT INTO workspace_settings VALUES (?, ?)')
    .run(`email-draft:${id}`, JSON.stringify(draft));
  return {
    draftId: id,
    to: draft.to,
    subject: draft.subject,
    text: draft.text,
    attachments: draft.attachments,
    status: 'draft',
    sent: false,
  };
}

export async function openEmailDraft(id: unknown): Promise<PreparedEmail> {
  const key = z.string().uuid().parse(id);
  if (existsSync(draftPath(key))) return openLocalDraft(key);
  const row = getDatabase()
    .prepare('SELECT value FROM workspace_settings WHERE key=?')
    .get(`email-draft:${key}`) as { value: string } | undefined;
  if (!row) throw new Error('草稿不存在');
  const draft = emailDraftSchema.parse(JSON.parse(row.value));
  const files: MailComposeFile[] = [];
  let total = 0;
  try {
    for (const ref of draft.attachments)
      await withResourceFile(ref, async (path) => {
        const info = await stat(path);
        total += info.size;
        if (total > 70 * 1024 * 1024) throw new Error('附件总大小超过 70 MB');
        files.push(addComposeAttachment(basename(path), await readFile(path)));
      });
    return { id: key, to: draft.to, subject: draft.subject, text: draft.text, files };
  } catch (error) {
    releaseComposeFiles(files.map((file) => file.id));
    throw error;
  }
}
