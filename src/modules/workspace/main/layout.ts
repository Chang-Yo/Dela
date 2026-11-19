// 键 `layout:{projectId}`（首页 = `layout:_general`）存 workspace_settings；损坏数据回退 null，由界面重新种子。
import { hostPorts } from '../../../core/ports';
import { workbenchLayoutSchema, type WorkbenchLayout } from '../contract';

const layoutKey = (projectId: string | null) => `layout:${projectId ?? '_general'}`;

export function loadWorkspaceLayout(projectId: string | null): WorkbenchLayout | null {
  const stored = hostPorts()
    .database()
    .prepare('SELECT value FROM workspace_settings WHERE key=?')
    .get(layoutKey(projectId)) as { value: string } | undefined;
  if (!stored) return null;
  try {
    const parsed = workbenchLayoutSchema.safeParse(JSON.parse(stored.value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function saveWorkspaceLayout(projectId: string | null, layout: WorkbenchLayout): void {
  hostPorts()
    .database()
    .prepare('INSERT OR REPLACE INTO workspace_settings VALUES (?, ?)')
    .run(layoutKey(projectId), JSON.stringify(layout));
}
