// layout:* 通道与持久化。键 `layout:{projectId}`（通用 = `layout:_general`）存 workspace_settings。
// 读写都经 zod 校验，损坏数据回退 null，不抛错给 renderer。
import { ipcMain } from 'electron';
import { z } from 'zod';
import { getDatabase } from '../database';
import { checkWorkspaceSender } from '../ipc';
import { workbenchLayoutSchema, type WorkbenchLayout } from '../../shared/layout';

const generalLayoutKey = '_general';

const layoutKey = (projectId: string | null) => `layout:${projectId ?? generalLayoutKey}`;
const projectIdSchema = z.string().uuid().nullable();

function loadWorkspaceLayout(projectId: string | null): WorkbenchLayout | null {
  const key = layoutKey(projectIdSchema.parse(projectId));
  const stored = getDatabase()
    .prepare('SELECT value FROM workspace_settings WHERE key=?')
    .get(key) as { value: string } | undefined;
  if (!stored) return null;
  try {
    const parsed = workbenchLayoutSchema.safeParse(JSON.parse(stored.value));
    return parsed.success ? parsed.data : null;
  } catch {
    // 损坏或非法 JSON：按未保存处理，由 renderer 重新种子。
    return null;
  }
}

function saveWorkspaceLayout(projectId: string | null, input: unknown): void {
  const key = layoutKey(projectIdSchema.parse(projectId));
  const layout = workbenchLayoutSchema.parse(input);
  getDatabase()
    .prepare('INSERT OR REPLACE INTO workspace_settings VALUES (?, ?)')
    .run(key, JSON.stringify(layout));
}

export function registerLayoutIpc() {
  ipcMain.handle('layout:get', (event, projectId) => {
    checkWorkspaceSender(event);
    return loadWorkspaceLayout(projectId);
  });
  ipcMain.handle('layout:save', (event, projectId, layout) => {
    checkWorkspaceSender(event);
    saveWorkspaceLayout(projectId, layout);
  });
}
