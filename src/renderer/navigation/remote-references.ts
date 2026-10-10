// 远程项目的 @ 引用候选：本地镜像里没有远端文件，改为向主进程要一次远端文件索引
// （优先 rg --files，缺失时退到 find），同一个项目在一次运行里只拉一次。
// 索引失败不报错也不阻塞输入：候选退化为空，用户仍可手打远端路径。
import { useEffect, useState } from 'react';

export interface RemoteReference {
  key: string;
  title: string;
}

const pending = new Map<string, Promise<RemoteReference[]>>();
const loaded = new Map<string, RemoteReference[]>();

export function useRemoteReferences(projectId: string | null): RemoteReference[] {
  const [entries, setEntries] = useState<RemoteReference[]>([]);

  useEffect(() => {
    if (!projectId) {
      // 传同一个空数组回去，避免每次渲染都触发一次状态更新。
      setEntries((prev) => (prev.length ? [] : prev));
      return;
    }
    const cached = loaded.get(projectId);
    if (cached) {
      setEntries(cached);
      return;
    }
    const workspace = window.dela?.workspace;
    if (!workspace) return;
    let live = true;
    const request = pending.get(projectId) ?? workspace.remoteReferences(projectId);
    pending.set(projectId, request);
    void request.then(
      (items) => {
        loaded.set(projectId, items);
        if (live) setEntries(items);
      },
      () => {
        // 索引只是便利：失败时留空，不打扰用户。
        pending.delete(projectId);
      },
    );
    return () => {
      live = false;
    };
  }, [projectId]);

  return entries;
}
