import {
  sendMessage,
  markMailSeen,
  listMailFolders,
  getMailState,
  friendlyError,
  configureMailAccount,
  disconnectMailAccount,
  startMailSync,
  listMailMessages,
  readMailMessage,
  mailAttachment,
  saveMailAttachment,
  deleteMailMessage,
  restoreMailMessage,
  purgeMailMessage,
  emptyMailTrash,
  listMailTrash,
  getMailTrashRetention,
  setMailTrashRetention,
} from './api';
import { BrowserWindow, dialog, ipcMain } from 'electron';
import { checkWorkspaceSender } from '../ipc';
import { saveLocalDraft, listLocalDrafts, deleteLocalDraft, openEmailDraft } from './drafts';
import { basename } from 'node:path';
import { z } from 'zod';
import type { MailResult } from '../../shared/api';
import { addComposeImage, pickComposeFiles, releaseComposeFiles } from './send';

const composingClients = new Set<number>();
export function hasMailComposer(id: number) {
  return composingClients.has(id);
}

export function registerMailIpc(): void {
  const handle = (name: string, fn: (...args: unknown[]) => unknown) =>
    ipcMain.handle(`mail:${name}`, (event, ...args) => {
      checkWorkspaceSender(event);
      return fn(...args);
    });
  handle('save-draft', saveLocalDraft);
  handle('list-drafts', listLocalDrafts);
  handle('delete-draft', deleteLocalDraft);
  handle('open-draft', openEmailDraft);
  ipcMain.handle('mail:compose-active', (event, active: unknown) => {
    checkWorkspaceSender(event);
    const senderId = event.sender.id;
    if (z.boolean().parse(active)) {
      if (!composingClients.has(senderId))
        event.sender.once('destroyed', () => composingClients.delete(senderId));
      composingClients.add(senderId);
    } else composingClients.delete(senderId);
  });
  ipcMain.handle('mail:confirm-draft-close', async (event) => {
    checkWorkspaceSender(event);
    const owner = BrowserWindow.fromWebContents(event.sender);
    if (!owner) return 'cancel';
    const { response } = await dialog.showMessageBox(owner, {
      type: 'question',
      title: '保存邮件草稿',
      message: '是否保存这封邮件为本地草稿？',
      buttons: ['保存草稿', '不保存', '继续编辑'],
      defaultId: 0,
      cancelId: 2,
    });
    return ['save', 'discard', 'cancel'][response];
  });
  ipcMain.handle('mail:get-state', () => getMailState());

  ipcMain.handle('mail:configure', (_event, input: unknown): Promise<MailResult> => {
    const parsed = z.object({ address: z.string(), password: z.string() }).safeParse(input);
    if (!parsed.success) return Promise.resolve({ ok: false, error: '请输入完整的邮箱地址和密码' });
    return configureMailAccount(parsed.data.address, parsed.data.password);
  });

  ipcMain.handle('mail:disconnect', (): MailResult => disconnectMailAccount());

  ipcMain.handle('mail:list-folders', () => listMailFolders());

  ipcMain.handle('mail:list-messages', (_event, folderId: unknown, limit: unknown) =>
    listMailMessages(folderId, limit),
  );

  ipcMain.handle('mail:get-message', (_event, messageId: unknown) => readMailMessage(messageId));

  ipcMain.handle('mail:mark-seen', async (_event, messageId: unknown) => markMailSeen(messageId));

  handle('delete-message', (messageId: unknown) => deleteMailMessage(messageId));
  handle('restore-message', (messageId: unknown) => restoreMailMessage(messageId));
  handle('purge-message', (messageId: unknown) => purgeMailMessage(messageId));
  handle('empty-trash', () => emptyMailTrash());
  handle('list-trash', () => listMailTrash());
  handle('get-trash-retention', () => getMailTrashRetention());
  handle('set-trash-retention', (retention: unknown) => setMailTrashRetention(retention));

  ipcMain.handle(
    'mail:download-attachment',
    async (event, messageId: unknown, part: unknown): Promise<MailResult> => {
      let attachment;
      try {
        ({ attachment } = mailAttachment(messageId, part));
      } catch (error) {
        return { ok: false, error: friendlyError(error) };
      }
      const owner = BrowserWindow.fromWebContents(event.sender);
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
    },
  );

  ipcMain.handle('mail:pick-compose-files', async (event, kind: unknown) => {
    const parsed = z.enum(['attachment', 'inline']).safeParse(kind);
    if (!parsed.success) throw new Error('参数无效');
    const owner = BrowserWindow.fromWebContents(event.sender);
    if (!owner) throw new Error('窗口不可用');
    return pickComposeFiles(owner, parsed.data);
  });

  ipcMain.handle('mail:add-compose-image', (_event, dataUrl: unknown) => {
    if (typeof dataUrl !== 'string') throw new Error('参数无效');
    return addComposeImage(dataUrl);
  });

  ipcMain.handle('mail:release-compose-files', (_event, ids: unknown) => {
    const parsed = z.array(z.string().uuid()).max(50).safeParse(ids);
    if (!parsed.success) throw new Error('参数无效');
    releaseComposeFiles(parsed.data);
  });

  ipcMain.handle('mail:send-message', (_event, input: unknown) => sendMessage(input));

  ipcMain.handle('mail:sync', () => {
    startMailSync();
  });
}
