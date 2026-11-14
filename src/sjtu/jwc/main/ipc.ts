import { ipcMain } from 'electron';
import { checkWorkspaceSender } from '../../../main/ipc';
import { downloadJwcAttachment, getJwcCaptcha, getJwcNotice } from './jwc';

export function registerJwcIpc(): void {
  ipcMain.handle('notifications:jwc-notice', (event, id) => {
    checkWorkspaceSender(event);
    return getJwcNotice(id);
  });
  ipcMain.handle('notifications:jwc-captcha', (event, id, attachmentId) => {
    checkWorkspaceSender(event);
    return getJwcCaptcha(id, attachmentId);
  });
  ipcMain.handle('notifications:jwc-download', (event, token, code) => {
    checkWorkspaceSender(event);
    return downloadJwcAttachment(token, code);
  });
}
