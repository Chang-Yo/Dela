// 水源快照保存状态：主进程推送进度与结果，文件树与来源卡共用；首次用到某帖时读引用行补齐初值。
import { useEffect } from 'react';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { ShuiyuanSnapshotState, ShuiyuanSourceRef } from '../../../shared/api';
import { showToast } from '../../app/toasts';
import { useWorkspaceStore } from '../../workspace/store';

const useSnapshotStore = create<{
  states: Record<number, ShuiyuanSnapshotState | null>;
  refs: Record<number, ShuiyuanSourceRef | null>;
}>(() => ({ states: {}, refs: {} }));
const requested = new Set<number>();

function setSnapshot(topicId: number, state: ShuiyuanSnapshotState | null): void {
  useSnapshotStore.setState((store) => ({ states: { ...store.states, [topicId]: state } }));
}

/** App 挂载一次：推送进 store；保存结束（只有结束时才会推送非 saving 状态）弹提示。 */
export function subscribeShuiyuanSnapshots(): (() => void) | undefined {
  return window.dela?.shuiyuan?.onSnapshot((state) => {
    setSnapshot(state.topicId, state);
    if (state.status === 'saving') return;
    const name = useWorkspaceStore
      .getState()
      .workspace.entries.find(
        (entry) => entry.sourceId === `shuiyuan-topic:${state.topicId}`,
      )?.name;
    if (state.status === 'done')
      showToast({ variant: 'success', title: '水源快照已保存', description: name });
    else
      showToast({
        variant: 'error',
        title: '水源快照保存失败',
        description: `${name ? `「${name}」：` : ''}${state.error ?? '未知错误'}。可在项目中打开该帖子重试。`,
      });
  });
}

export function useShuiyuanSnapshots(
  topicIds: readonly number[],
): Readonly<Record<number, ShuiyuanSnapshotState | null>> {
  useSnapshotInitialization(topicIds);
  const states = useSnapshotStore(
    useShallow((store) => Object.fromEntries(topicIds.map((id) => [id, store.states[id] ?? null]))),
  );
  return states;
}

export function useShuiyuanSnapshotBadges(
  topicIds: readonly number[],
): Readonly<Record<number, string | undefined>> {
  useSnapshotInitialization(topicIds);
  return useSnapshotStore(
    useShallow((store) =>
      Object.fromEntries(
        topicIds.map((id) => {
          const state = store.states[id];
          const progress = state?.progress;
          const badge =
            state?.status === 'failed'
              ? '!'
              : state?.status === 'saving'
                ? progress?.total
                  ? `${progress.phase === 'posts' ? '楼层' : '图片'} ${Math.floor((progress.done / progress.total) * 100)}%`
                  : '…'
                : undefined;
          return [id, badge];
        }),
      ),
    ),
  );
}

export function useShuiyuanSourceRef(topicId: number): ShuiyuanSourceRef | null {
  useSnapshotInitialization([topicId]);
  return useSnapshotStore((store) => store.refs[topicId] ?? null);
}

function useSnapshotInitialization(topicIds: readonly number[]): void {
  const key = topicIds.join(',');
  useEffect(() => {
    for (const topicId of topicIds) {
      if (requested.has(topicId)) continue;
      requested.add(topicId);
      void window.dela?.shuiyuan
        .getSourceRef(topicId)
        .then((ref) => {
          useSnapshotStore.setState((store) => ({
            refs: { ...store.refs, [topicId]: ref },
            states:
              topicId in store.states
                ? store.states
                : { ...store.states, [topicId]: ref?.snapshot ?? null },
          }));
        })
        .catch(() => requested.delete(topicId));
    }
  }, [key]);
}
