/**
 * 远端目录 watch：渲染端把「当前展开的远端目录」交上来，这里换成 helper 的监视集合，
 * 再把 helper 推回来的变化转成已有的 `notifyRemoteChange` —— 目录树因此也能看到
 * Dela 之外改的远端文件（工具自己写文件那条路在 operations 里已经直接通知了）。
 *
 * **只监视展开的目录、不递归**：大仓库递归要几千个 inotify watch，而折叠着的目录变了
 * 也看不见，没有监视的价值。代价是「展开之后」才有实时性。
 *
 * **同时只服务一个目标，由「通道实际在用谁」决定**：Dela 全局只保一条 helper 通道
 * （切连接就放掉旧的），所以这里也只有一个目标在跑事件流 —— 否则两边的流会互相把通道
 * 抢回来，每次抢占都要在远端重起一个 helper。`operations.withHelper` 每次用到通道都会
 * 喊一声 `syncRemoteWatch`，于是「谁在用通道谁被监视」自动成立；集合按目标留着不丢，
 * 切回来就能立刻恢复。
 *
 * helper 起不来（远端非 Linux、noexec、缺产物）不是错误：watch 整条缺席，调用方拿到
 * watching=0，工具改动触发的刷新照常工作。
 */
import { notifyRemoteChange } from './events';
import { helperSession, type HelperSession, type WatchEvent } from './helper';
import type { RemoteTarget } from './transport';

export interface RemoteWatchInput {
  projectId: string;
  target: RemoteTarget;
  /** 项目根：reset（丢事件）时按它报一次，目录树会重读根以下所有层。 */
  root: string;
  paths: string[];
}

interface WatchSet extends RemoteWatchInput {
  targetKey: string;
}

/** 重连退避：通道刚被换掉、helper 还没起来都会走到这里，别用固定 1 秒去反复起远端进程。 */
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

/** 所有想要监视的集合（按目标分组留着：切走的那些等通道回到它身上再恢复）。 */
const desired = new Map<string, WatchSet>();
/** 当前正在跑事件流的目标；全局只有一条 helper 通道，所以最多一个。 */
let serving: { key: string; target: RemoteTarget; controller: AbortController } | null = null;

function targetKey(target: RemoteTarget): string {
  return `${target.host}|${target.port ?? ''}|${target.keyPath ?? ''}`;
}

function setsOf(key: string): WatchSet[] {
  return [...desired.values()].filter((set) => set.targetKey === key);
}

function handleEvent(event: WatchEvent): void {
  if (!serving) return;
  if (event.type === 'change') {
    for (const path of event.paths) notifyRemoteChange(path);
    return;
  }
  // reset（内核队列溢出、订阅者卡住、丢事件）：按根路径报一次就够 ——
  // 目录树会把根以下所有已缓存的层重读，比逐层猜哪些丢了更省事也更可靠。
  const affected = event.id === '*' ? setsOf(serving.key) : [desired.get(event.id)];
  for (const set of affected) if (set) notifyRemoteChange(set.root);
}

async function apply(session: HelperSession, set: WatchSet): Promise<number> {
  const { watching, skipped } = await session.setWatch(set.projectId, set.paths);
  // 挂不上的目录（不存在、不是目录、inotify 额度满）只影响实时性，但得能从日志查出来。
  if (skipped.length) console.warn(`[remotes] 这些目录没挂上 watch：${skipped.join(' ')}`);
  return watching;
}

/** 一个目标一条流：连上、重报它的所有集合、然后一直收事件，断了就退避重连。 */
async function runStream(key: string, target: RemoteTarget, signal: AbortSignal): Promise<void> {
  let backoff = RECONNECT_MIN_MS;
  while (!signal.aborted) {
    const session = await helperSession(target).catch(() => null);
    if (session) {
      // 重连后必须重报：换了 helper 实例，旧集合跟着旧进程一起没了。
      for (const set of setsOf(key)) await apply(session, set).catch(() => {});
      try {
        await session.watchEvents(handleEvent, signal);
        backoff = RECONNECT_MIN_MS;
      } catch (error) {
        if (!signal.aborted) console.warn('[remotes] watch 流中断，退避重连', error);
      }
    }
    if (signal.aborted) break;
    await new Promise((resolve) => setTimeout(resolve, backoff));
    backoff = Math.min(backoff * 2, RECONNECT_MAX_MS);
  }
}

function stopServing(): void {
  serving?.controller.abort();
  serving = null;
}

/**
 * 让某个目标成为被监视的那个：别的目标的流收掉（它的集合留着），本目标有集合就起流。
 * 由「通道刚被谁用了」驱动，所以既不会互相抢通道，也不会在 helper 不可用时反复重试。
 */
export function syncRemoteWatch(target: RemoteTarget): void {
  const key = targetKey(target);
  if (serving?.key === key) return;
  stopServing();
  if (!setsOf(key).length) return;
  const controller = new AbortController();
  serving = { key, target, controller };
  void runStream(key, target, controller.signal).catch((error: unknown) => {
    console.warn('[remotes] watch 循环退出', error);
  });
}

/** 替换某个项目的监视集合；paths 为空等于取消监视。回报真正被监视的目录数。 */
export async function watchRemoteProject(input: RemoteWatchInput): Promise<{ watching: number }> {
  if (!input.paths.length) {
    await unwatchRemoteProject(input.projectId);
    return { watching: 0 };
  }
  desired.set(input.projectId, { ...input, targetKey: targetKey(input.target) });
  syncRemoteWatch(input.target);
  const session = await helperSession(input.target).catch(() => null);
  if (!session) return { watching: 0 };
  const set = desired.get(input.projectId);
  return { watching: set ? await apply(session, set).catch(() => 0) : 0 };
}

export async function unwatchRemoteProject(projectId: string): Promise<void> {
  const set = desired.get(projectId);
  if (!set) return;
  desired.delete(projectId);
  const session = await helperSession(set.target).catch(() => null);
  await session?.clearWatch(projectId).catch(() => {});
  // 这个目标一套集合都不剩了：流收掉（helper 侧随上下文断开清理订阅者）。
  if (serving?.key === set.targetKey && !setsOf(set.targetKey).length) stopServing();
}

/** 放掉通道/退出时收掉流与集合（不等远端回应，流一断 helper 自己就清理订阅者）。 */
export function closeRemoteWatch(): void {
  stopServing();
  desired.clear();
}
