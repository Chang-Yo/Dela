/**
 * 远端目录 watch：渲染端交上「当前展开的远端目录」，这里换成 helper 的监视集合，事件再转成
 * `notifyRemoteChange`，目录树因此也能看到 Dela 之外改的远端文件。
 * 只监视展开的目录、不递归（大仓库递归要几千个 inotify watch，折叠的目录变了也看不见），代价是
 * 「展开之后」才有实时性；每个目标一条流。通道重连期间流断开，回来后重报集合并让目录树整片重读。
 */
import { notifyRemoteChange } from './events';
import { helperSession, type HelperSession, type WatchEvent } from './helper';
import { targetKey, type RemoteTarget } from './transport';

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

/** 流断开后的退避：通道在重连时 watchEvents 会排队等它回来，这里只防不可用时空转。 */
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

/** 所有想要监视的集合（按目标分组）：有集合的目标各有一条流，收起/切走的那些留着等再报上来。 */
const desired = new Map<string, WatchSet>();
/** 正在跑事件流的目标：一个连接一条（一条通道一条流）。 */
const streams = new Map<string, { target: RemoteTarget; controller: AbortController }>();

function setsOf(key: string): WatchSet[] {
  return [...desired.values()].filter((set) => set.targetKey === key);
}

function handleEvent(key: string, event: WatchEvent): void {
  if (event.type === 'change') {
    for (const path of event.paths) notifyRemoteChange(path);
    return;
  }
  // reset（内核队列溢出、订阅者卡住、丢事件）：按根路径报一次就够 ——
  // 目录树会把根以下所有已缓存的层重读，比逐层猜哪些丢了更省事也更可靠。
  const affected = event.id === '*' ? setsOf(key) : [desired.get(event.id)];
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
  let connected = false;
  while (!signal.aborted) {
    const session = helperSession(target);
    // 每次接上都重报：通道重连可能换了 helper 实例（远端被杀后重起），旧集合跟着旧进程一起没了。
    for (const set of setsOf(key)) await apply(session, set).catch(() => {});
    // 断流期间没有订阅者，那段时间的事件 helper 侧直接丢掉了（队列都没有）：
    // 重连后让目录树把根重读一遍，别指望下一轮事件把状态补齐。
    if (connected) for (const set of setsOf(key)) notifyRemoteChange(set.root);
    connected = true;
    try {
      await session.watchEvents((event) => handleEvent(key, event), signal);
      backoff = RECONNECT_MIN_MS;
    } catch (error) {
      if (!signal.aborted) console.warn('[remotes] watch 流中断，退避重连', error);
    }
    if (signal.aborted) break;
    await new Promise((resolve) => setTimeout(resolve, backoff));
    backoff = Math.min(backoff * 2, RECONNECT_MAX_MS);
  }
}

function stopStream(key: string): void {
  const stream = streams.get(key);
  if (!stream) return;
  streams.delete(key);
  stream.controller.abort();
}

/**
 * 让某个目标有事件流：本目标有集合就起一条，已经有了就什么都不做（别的目标的流不受影响）。
 * 由「通道刚被谁用了」驱动，所以既不会互相抢通道，也不会在 helper 不可用时反复重试。
 */
export function syncRemoteWatch(target: RemoteTarget): void {
  const key = targetKey(target);
  if (streams.has(key) || !setsOf(key).length) return;
  const controller = new AbortController();
  streams.set(key, { target, controller });
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
  const set = desired.get(input.projectId);
  return { watching: set ? await apply(helperSession(input.target), set).catch(() => 0) : 0 };
}

export async function unwatchRemoteProject(projectId: string): Promise<void> {
  const set = desired.get(projectId);
  if (!set) return;
  desired.delete(projectId);
  await helperSession(set.target)
    .clearWatch(projectId)
    .catch(() => {});
  // 这个目标一套集合都不剩了：流收掉（helper 侧随上下文断开清理订阅者）。
  if (!setsOf(set.targetKey).length) stopStream(set.targetKey);
}

/** 放掉通道/退出时收掉所有流与集合（不等远端回应，流一断 helper 自己就清理订阅者）。 */
export function closeRemoteWatch(): void {
  for (const key of [...streams.keys()]) stopStream(key);
  desired.clear();
}
