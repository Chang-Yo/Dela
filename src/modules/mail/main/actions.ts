import { BrowserWindow, dialog, type WebContents } from 'electron';
import { basename } from 'node:path';
import { hostPorts } from '../../../core/ports';
import type { MailComposeFileKind, MailResult } from '../contract';
import { friendlyError, mailAttachment, saveMailAttachment } from './api';
import { pickComposeFiles } from './send';

function workspaceWindow() {
  const client = hostPorts().workspaceClient();
  return client ? BrowserWindow.fromWebContents(client as WebContents) : null;
}

// 只有一个工作窗口，写信中的状态用一个布尔记录。
let composing = false;

export function hasMailComposer() {
  return composing;
}

export function setComposeActive(active: boolean) {
  composing = active;
}

export async function confirmDraftClose(): Promise<'save' | 'discard' | 'cancel'> {
  const owner = workspaceWindow();
  if (!owner) return 'cancel';
  // 隐藏窗口（如托盘退出触发）上的模态对话框不可见，问题永远无人应答会把渲染侧导航闸门卡死。
  if (!owner.isVisible()) owner.show();
  const { response } = await dialog.showMessageBox(owner, {
    type: 'question',
    title: '保存邮件草稿',
    message: '是否保存这封邮件为本地草稿？',
    buttons: ['保存草稿', '不保存', '继续编辑'],
    defaultId: 0,
    cancelId: 2,
  });
  return (['save', 'discard', 'cancel'] as const)[response] ?? 'cancel';
}

export async function downloadAttachment({
  messageId,
  part,
}: {
  messageId: number;
  part: string;
}): Promise<MailResult> {
  let attachment;
  try {
    ({ attachment } = mailAttachment(messageId, part));
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
  const owner = workspaceWindow();
  if (!owner) return { ok: false, error: '窗口不可用' };
  const save = await dialog.showSaveDialog(owner, {
    defaultPath: basename(attachment.filename) || '附件',
    buttonLabel: '保存附件',
  });
  if (save.canceled || !save.filePath) return { ok: true };
  try {
    await saveMailAttachment(messageId, part, save.filePath);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
}

export function pickComposeAttachments(kind: MailComposeFileKind) {
  const owner = workspaceWindow();
  if (!owner) throw new Error('窗口不可用');
  return pickComposeFiles(owner, kind);
}
