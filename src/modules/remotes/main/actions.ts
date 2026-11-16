import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { BrowserWindow, dialog, type OpenDialogOptions, type WebContents } from 'electron';
import { hostPorts } from '../../../core/ports';

/** 私钥常常没有后缀，不按扩展名过滤。 */
export async function pickKeyFile(): Promise<string | null> {
  const home = homedir();
  const sshDirectory = join(home, '.ssh');
  const options: OpenDialogOptions = {
    title: '选择私钥文件',
    defaultPath: existsSync(sshDirectory) ? sshDirectory : home,
    properties: ['openFile'],
  };
  const client = hostPorts().workspaceClient();
  const parent = client && BrowserWindow.fromWebContents(client as WebContents);
  const result = await (parent
    ? dialog.showOpenDialog(parent, options)
    : dialog.showOpenDialog(options));
  return result.canceled ? null : (result.filePaths[0] ?? null);
}
