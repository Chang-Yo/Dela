import { ipcMain } from 'electron';
import { checkWorkspaceSender } from '../ipc';
import {
  addVsjtuSourceRef,
  getVsjtuChapters,
  getVsjtuPpt,
  getVsjtuPlayInfo,
  getVsjtuSourceRef,
  getVsjtuState,
  getVsjtuTranscript,
  listVsjtu,
  openVsjtuLink,
  openVsjtuLoginWindow,
  syncVsjtu,
} from './api';

export function registerVsjtuIpc(): void {
  ipcMain.handle('vsjtu:get-state', () => getVsjtuState());
  ipcMain.handle('vsjtu:login', (event) => openVsjtuLoginWindow(event.sender));
  ipcMain.handle('vsjtu:sync', () => syncVsjtu());
  ipcMain.handle('vsjtu:list', () => listVsjtu());
  ipcMain.handle('vsjtu:play-info', (_event, courseId: unknown) => getVsjtuPlayInfo(courseId));
  ipcMain.handle('vsjtu:get-source-ref', (_event, videoId: unknown) => getVsjtuSourceRef(videoId));
  ipcMain.handle('vsjtu:transcript', (_event, courseId: unknown) => getVsjtuTranscript(courseId));
  ipcMain.handle('vsjtu:chapters', (_event, courseId: unknown) => getVsjtuChapters(courseId));
  ipcMain.handle('vsjtu:ppt', (_event, courseId: unknown) => getVsjtuPpt(courseId));
  // 引用行写入与外链打开是不可逆/出网动作，仅主 frame 可调。
  ipcMain.handle('vsjtu:add-source-ref', (event, videoId: unknown) => {
    checkWorkspaceSender(event);
    return addVsjtuSourceRef(videoId);
  });
  ipcMain.handle('vsjtu:open-link', (event, url: unknown) => {
    checkWorkspaceSender(event);
    return openVsjtuLink(url);
  });
}
