import {
  app,
  BrowserWindow,
  clipboard,
  Menu,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
  type WebContents,
} from 'electron';

// Only the app's main frame can invoke credential, file and workspace operations.
export function checkWorkspaceSender(event: IpcMainInvokeEvent) {
  const frame = event.senderFrame;
  if (!frame || frame !== event.sender.mainFrame) throw new Error('不允许的调用来源');
  const url = new URL(frame.url);
  if (url.protocol !== 'file:' && (app.isPackaged || url.origin !== 'http://127.0.0.1:5173')) {
    throw new Error('不允许的调用来源');
  }
}

/** 右键菜单：按位置提供基本编辑操作，与 macOS 原生编辑菜单共用 Electron role。 */
export function attachContextMenu(webContents: WebContents): void {
  webContents.on('context-menu', (_event, params) => {
    const items: MenuItemConstructorOptions[] = [];
    if (params.isEditable) {
      if (params.editFlags.canUndo) items.push({ role: 'undo', label: '撤销' });
      if (params.editFlags.canRedo) items.push({ role: 'redo', label: '重做' });
      if (items.length) items.push({ type: 'separator' });
      if (params.editFlags.canCut) items.push({ role: 'cut', label: '剪切' });
    }
    if (params.editFlags.canCopy) items.push({ role: 'copy', label: '复制' });
    if (params.isEditable && params.editFlags.canPaste)
      items.push({ role: 'paste', label: '粘贴' });
    if (params.linkURL) {
      items.push({ type: 'separator' });
      items.push({
        label: '复制链接地址',
        click: () => clipboard.writeText(params.linkURL),
      });
    }
    if (params.selectionText || params.isEditable) items.push({ role: 'selectAll', label: '全选' });
    if (!items.length) return;
    Menu.buildFromTemplate(items).popup({
      window: BrowserWindow.fromWebContents(webContents) ?? undefined,
    });
  });
}
