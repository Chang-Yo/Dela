// 远程项目的 @ 引用候选：本地镜像没有远端文件，改向主进程要远端文件索引（优先 rg --files，
// 缺失时退到 find）。成功后缓存到本次运行结束；失败不报错也不阻塞输入，候选为空仍可手打远端路径。
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { WorkspaceEntry } from '../../shared/api';
import { onWorkspaceEvent, workspaceClient } from '../../modules/workspace/view';

export interface RemoteReference {
  key: string;
  title: string;
}

const noRemoteReferences: RemoteReference[] = [];
const noLocalFiles: WorkspaceEntry[] = [];

/** 本地目录变动后合并这个窗口内的通知再重读，别一次写入一次请求。 */
const LOCAL_CHANGE_DEBOUNCE_MS = 300;

const normalized = (value: string) =>
  /^[a-z]:[\\/]/i.test(value) ? value.replaceAll('\\', '/').toLowerCase() : value;

const localReferencesKey = (cwd: string | null) => ['workspace', 'localReferenceFiles', cwd];

export function useLocalReferences(cwd: string | null): WorkspaceEntry[] {
  const queryClient = useQueryClient();
  const files = useQuery({
    queryKey: localReferencesKey(cwd),
    queryFn: cwd
      ? () =>
          workspaceClient.localReferenceFiles(cwd).catch((error: unknown) => {
            console.error('[workspace] 读取引用候选失败', error);
            throw error;
          })
      : skipToken,
  });

  useEffect(() => {
    if (!cwd) return;
    const root = normalized(cwd).replace(/\/$/, '');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = onWorkspaceEvent('changed', (paths) => {
      if (
        !paths.some((path) => normalized(path) === root || normalized(path).startsWith(`${root}/`))
      )
        return;
      clearTimeout(timer);
      timer = setTimeout(
        () =>
          void queryClient.invalidateQueries({ queryKey: localReferencesKey(cwd), exact: true }),
        LOCAL_CHANGE_DEBOUNCE_MS,
      );
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [cwd, queryClient]);

  return files.data ?? noLocalFiles;
}

/** 索引只是便利：失败时留空；同一项目一次运行只拉一次。 */
export function useRemoteReferences(projectId: string | null): RemoteReference[] {
  return (
    useQuery({
      queryKey: ['workspace', 'remoteReferences', projectId],
      queryFn: projectId ? () => workspaceClient.remoteReferences(projectId) : skipToken,
      staleTime: Infinity,
      gcTime: Infinity,
    }).data ?? noRemoteReferences
  );
}
