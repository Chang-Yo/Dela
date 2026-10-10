import { BrowserWindow, dialog, nativeImage } from 'electron';
import { statSync, readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { MailComposeFile, MailComposeFileKind, MailResult } from '../../shared/api';
import type { MailCredential } from '../credentials';
import { storedMailServer } from './server';

import nodemailer from 'nodemailer';

const SMTP_CONNECT_TIMEOUT = 15_000;
const SMTP_SOCKET_TIMEOUT = 30_000;
// The server advertises 100 MB attachments. Leave room for MIME/base64 expansion.
const MAX_RAW_FILE_BYTES = 70 * 1024 * 1024;

type SelectedFile =
  | (MailComposeFile & { path: string; modifiedAt: number })
  | (MailComposeFile & { content: Buffer });

const selectedFiles = new Map<string, SelectedFile>();

const sendInputSchema = z.object({
  to: z.array(z.email()).min(1).max(50),
  subject: z.string().max(500),
  text: z.string().max(2_000_000),
  html: z.string().max(2_000_000),
  attachmentIds: z.array(z.string().uuid()).max(30),
  inlineImageIds: z.array(z.string().uuid()).max(20),
});

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];

function imageExtensionSupported(path: string): boolean {
  return IMAGE_EXTENSIONS.includes(extname(path).toLowerCase());
}

function previewImage(path: string): string | null {
  const image = nativeImage.createFromPath(path);
  if (image.isEmpty()) return null;
  const size = image.getSize();
  const preview = size.width > 1200 ? image.resize({ width: 1200, quality: 'good' }) : image;
  return preview.toDataURL();
}

export async function pickComposeFiles(
  owner: BrowserWindow,
  kind: MailComposeFileKind,
): Promise<MailComposeFile[]> {
  const result = await dialog.showOpenDialog(owner, {
    properties: ['openFile', 'multiSelections'],
    filters:
      kind === 'inline'
        ? [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }]
        : undefined,
  });
  if (result.canceled) return [];
  const picked: MailComposeFile[] = [];
  for (const path of result.filePaths) {
    if (kind === 'inline' && !imageExtensionSupported(path)) continue;
    const stat = statSync(path);
    if (!stat.isFile()) continue;
    const file: SelectedFile = {
      id: randomUUID(),
      name: basename(path),
      size: stat.size,
      kind,
      previewUrl: kind === 'inline' ? previewImage(path) : null,
      path,
      modifiedAt: stat.mtimeMs,
    };
    if (kind === 'inline' && !file.previewUrl) continue;
    selectedFiles.set(file.id, file);
    picked.push({
      id: file.id,
      name: file.name,
      size: file.size,
      kind: file.kind,
      previewUrl: file.previewUrl,
    });
  }
  return picked;
}

export function releaseComposeFiles(ids: readonly string[]): void {
  for (const id of ids) selectedFiles.delete(id);
}

export function snapshotComposeFiles(attachmentIds: string[], inlineImageIds: string[]) {
  const files = [
    ...resolveFiles(attachmentIds, 'attachment'),
    ...resolveFiles(inlineImageIds, 'inline'),
  ];
  if (files.reduce((total, file) => total + file.size, 0) > MAX_RAW_FILE_BYTES)
    throw new Error('附件总大小超过 70 MB');
  return files.map((file) => ({
    id: file.id,
    name: file.name,
    kind: file.kind,
    data: ('content' in file ? file.content : readFileSync(file.path)).toString('base64'),
  }));
}

export function restoreComposeFile(
  name: string,
  kind: MailComposeFileKind,
  content: Buffer,
): MailComposeFile {
  let file = addComposeAttachment(name, content);
  if (kind === 'inline') {
    const ext = extname(name).toLowerCase();
    if (!IMAGE_EXTENSIONS.includes(ext)) {
      releaseComposeFiles([file.id]);
      throw new Error('草稿图片格式不支持');
    }
    file = {
      ...file,
      kind,
      previewUrl: `data:image/${ext === '.jpg' ? 'jpeg' : ext.slice(1)};base64,${content.toString('base64')}`,
    };
    selectedFiles.set(file.id, { ...file, content });
  }
  return file;
}

export function addComposeAttachment(name: string, content: Buffer): MailComposeFile {
  if (content.length > MAX_RAW_FILE_BYTES) throw new Error('附件过大');
  const file: MailComposeFile = {
    id: randomUUID(),
    name,
    size: content.length,
    kind: 'attachment',
    previewUrl: null,
  };
  selectedFiles.set(file.id, { ...file, content });
  return file;
}

export function addComposeImage(dataUrl: string): MailComposeFile {
  const match = /^data:image\/(png|jpeg|gif|webp);base64,([a-z0-9+/=\r\n]+)$/i.exec(dataUrl);
  if (!match) throw new Error('只能粘贴 PNG、JPEG、GIF 或 WebP 图片');
  const [, imageType, encoded] = match;
  if (!imageType || !encoded) throw new Error('图片数据无效');
  if (dataUrl.length > Math.ceil((MAX_RAW_FILE_BYTES * 4) / 3)) {
    throw new Error('图片过大，请控制在 70 MB 以内');
  }
  const content = Buffer.from(encoded, 'base64');
  if (!content.length || content.length > MAX_RAW_FILE_BYTES) {
    throw new Error('图片过大，请控制在 70 MB 以内');
  }
  const id = randomUUID();
  const file: SelectedFile = {
    id,
    name: `clipboard-image.${imageType === 'jpeg' ? 'jpg' : imageType}`,
    size: content.length,
    kind: 'inline',
    previewUrl: dataUrl,
    content,
  };
  selectedFiles.set(id, file);
  return {
    id: file.id,
    name: file.name,
    size: file.size,
    kind: file.kind,
    previewUrl: file.previewUrl,
  };
}

function resolveFiles(ids: readonly string[], expectedKind: MailComposeFileKind): SelectedFile[] {
  return ids.map((id) => {
    const selected = selectedFiles.get(id);
    if (!selected || selected.kind !== expectedKind) throw new Error('所选文件已失效，请重新添加');
    if ('content' in selected) return selected;
    const current = statSync(selected.path);
    if (
      !current.isFile() ||
      current.size !== selected.size ||
      current.mtimeMs !== selected.modifiedAt
    ) {
      throw new Error(`${selected.name} 已被修改，请重新添加`);
    }
    return selected;
  });
}

function attachmentSource(file: SelectedFile): { path: string } | { content: Buffer } {
  return 'content' in file ? { content: file.content } : { path: file.path };
}

function friendlySendError(error: unknown): string {
  if (error instanceof Error) {
    if (/auth|login|password|credential|invalid/i.test(error.message)) {
      return '发件服务器拒绝登录，请检查邮箱账号状态';
    }
    if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|certificate|TLS|SSL/i.test(error.message)) {
      return `无法连接发件服务器：${error.message}`;
    }
    return error.message;
  }
  return String(error);
}

export async function sendMailMessage(
  credential: MailCredential,
  input: unknown,
  appendSent: (message: Buffer) => Promise<string | null>,
): Promise<MailResult> {
  const parsed = sendInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: '请检查收件人、主题和正文' };
  let attachments: SelectedFile[];
  let inlineImages: SelectedFile[];
  try {
    attachments = resolveFiles(parsed.data.attachmentIds, 'attachment');
    inlineImages = resolveFiles(parsed.data.inlineImageIds, 'inline');
  } catch (error) {
    return { ok: false, error: friendlySendError(error) };
  }
  const allFiles = [...attachments, ...inlineImages];
  const totalBytes = allFiles.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_RAW_FILE_BYTES) {
    return { ok: false, error: '附件总大小过大，请控制在 70 MB 以内' };
  }

  const server = storedMailServer();
  const transporter = nodemailer.createTransport({
    host: server.smtpHost,
    port: server.smtpPort,
    secure: true,
    auth: { user: credential.address, pass: credential.password },
    connectionTimeout: SMTP_CONNECT_TIMEOUT,
    greetingTimeout: SMTP_CONNECT_TIMEOUT,
    socketTimeout: SMTP_SOCKET_TIMEOUT,
  });
  try {
    const message = {
      from: credential.address,
      to: parsed.data.to,
      subject: parsed.data.subject.trim() || '(无主题)',
      text: parsed.data.text,
      html: parsed.data.html,
      attachments: [
        ...attachments.map((file) => ({ filename: file.name, ...attachmentSource(file) })),
        ...inlineImages.map((file) => ({
          filename: file.name,
          ...attachmentSource(file),
          cid: `${file.id}@dela`,
        })),
      ],
    };
    const composer = nodemailer.createTransport({ streamTransport: true, buffer: true });
    const built = await composer.sendMail(message);
    if (!Buffer.isBuffer(built.message)) throw new Error('邮件内容生成失败');
    const info = await transporter.sendMail({
      envelope: { from: credential.address, to: parsed.data.to },
      raw: built.message,
    });
    if (info.accepted.length === 0) {
      return { ok: false, error: '发件服务器没有接受任何收件人' };
    }
    releaseComposeFiles(allFiles.map((file) => file.id));
    const warning = await appendSent(built.message);
    return warning ? { ok: true, warning } : { ok: true };
  } catch (error) {
    return { ok: false, error: friendlySendError(error) };
  } finally {
    transporter.close();
  }
}
