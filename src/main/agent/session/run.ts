// 会话运行：打开 Pi 实例、跑一轮、插队与后台任务通知、把 Pi 事件推给界面。
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type {
  AgentToolResult,
  ChatAskInput,
  ChatQueuedDraft,
  RunStatus,
  TaskNoticeDetails,
  WorkspaceChat,
} from '../../../shared/api';
import { TASK_NOTICE } from '../../../shared/api';
import { hostPorts } from '../../host';
import { remoteBackend } from '../../remotes/operations';
import * as changes from '../changes';
import { agentEnvironment } from '../environment';
import { chatAttachmentView, releaseChatAttachments } from '../media';
import { openPiSession } from '../pi';
import { taskTool, type SubagentResult } from '../subagent';
import { backgroundTools, stopAllTasks, type TaskNotice, type TaskParent } from '../tasks';
import { live, liveSteps, type Live, type Run } from './live';
import {
  encodeMeta,
  projectMessages,
  publish,
  queuedTexts,
  snapshot,
  toolOutput,
  usageOf,
  withoutToolImages,
} from './projection';
import { composePrompt } from './prompt';
import {
  isRemoteSession,
  readySelection,
  row,
  sessionCwd,
  storeActivity,
  storeModel,
  storeSessionFile,
  storeTitle,
} from './store';

export async function ensureLive(id: string): Promise<Live> {
  const existing = live.get(id);
  if (existing) return existing;
  const meta = row(id);
  const choice = readySelection(meta);
  const { selection } = choice;
  // 沿用来的选择在会话开始使用时写下，之后别的会话换模型不再影响它。
  if (!choice.stored) storeModel(id, selection.provider.id, selection.model, selection.effort);
  const cwd = sessionCwd(meta.project_id, meta.cwd);
  const options = await agentEnvironment().sessionOptions(meta.project_id, cwd);
  // 子 Agent 不再派子 Agent，也不开后台任务。
  const delegates = !meta.parent_id;
  const remote = meta.project_id ? hostPorts().projects.remoteOf(meta.project_id) : null;
  const parent: TaskParent = {
    id,
    publish: () => publish(id),
    deliver: (notice, wake) => deliverTaskNotice(id, notice, wake),
  };
  const session = await openPiSession({
    cwd,
    file: existsSync(meta.file) ? meta.file : undefined,
    selection,
    ...options,
    ...(delegates
      ? {
          customTools: [
            ...options.customTools,
            ...(await backgroundTools(
              parent,
              cwd,
              options.shellPath,
              options.commandPrefix,
              remote && remoteBackend(remote.target),
            )),
            taskTool(parent, cwd, runSubagent),
          ],
        }
      : {}),
    ...(meta.parent_id ? { parentSession: row(meta.parent_id).file } : {}),
  });
  if (session.sessionFile && session.sessionFile !== meta.file)
    storeSessionFile(id, session.sessionFile);
  const entry: Live = { session, cwd, providerId: selection.provider.id, unsubscribe: () => {} };
  entry.unsubscribe = session.subscribe((event) => onEvent(id, entry, event));
  live.set(id, entry);
  return entry;
}

export function disposeLive(id: string, entry: Live): void {
  entry.unsubscribe();
  live.delete(id);
  entry.session.dispose();
}

/** 应用退出前停掉后台任务并结束全部会话；最多等 timeoutMs。 */
export async function shutdownSessions(timeoutMs: number): Promise<void> {
  const tasks = stopAllTasks();
  for (const [id, entry] of [...live]) {
    if (entry.run) entry.run.cancelled = true;
    disposeLive(id, entry);
  }
  await Promise.race([tasks, new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
}

export function hasLiveSessions(): boolean {
  return live.size > 0;
}

/** 模型或能力配置改变：空闲实例立即丢弃，运行中的轮末丢弃，下次使用时按新配置重建。
 *  给了 providerId 就只处理用这个提供商的会话。 */
export function invalidateSessions(providerId?: string) {
  for (const [id, entry] of live) {
    if (providerId && entry.providerId !== providerId) continue;
    // 压缩也算忙：此时丢弃会话会中止压缩（dispose 里的 abortCompaction）。
    if (!entry.run && !entry.session.isCompacting) disposeLive(id, entry);
    else {
      entry.stale = true;
    }
  }
}

const streamTimers = new Map<string, number>();

function onEvent(id: string, entry: Live, event: AgentSessionEvent) {
  const steps = liveSteps.get(id) ?? new Map<string, AgentToolResult>();
  liveSteps.set(id, steps);
  switch (event.type) {
    case 'tool_execution_start':
      steps.set(event.toolCallId, {
        id: event.toolCallId,
        name: event.toolName,
        input: event.args,
        startedAt: Date.now(),
      });
      if (entry.run) entry.run.tool = event.toolName;
      runEvent(id, 'running', event.toolName);
      publish(id);
      break;
    case 'tool_execution_update': {
      const step = steps.get(event.toolCallId);
      if (step) step.output = toolOutput(event.partialResult ?? {});
      stream(id, entry);
      break;
    }
    case 'tool_execution_end': {
      const step = steps.get(event.toolCallId);
      if (step) {
        step.output = {
          ...toolOutput(event.result ?? {}),
          ...(event.isError ? { isError: true } : {}),
        };
        step.finishedAt = Date.now();
      }
      if (entry.run) entry.run.tool = undefined;
      runEvent(id, 'running');
      publish(id);
      break;
    }
    case 'message_update':
      stream(id, entry);
      break;
    case 'compaction_end':
      if (event.result?.estimatedTokensAfter !== undefined)
        entry.compactedTokens = event.result.estimatedTokensAfter;
      touch(id, entry);
      publish(id);
      break;
    case 'message_end':
    case 'compaction_start':
      touch(id, entry);
      publish(id);
      break;
    case 'queue_update':
      hostPorts().broadcaster.send('session:on-queue', {
        sessionId: id,
        queued: queuedTexts(event.steering),
      });
      break;
  }
}

/** 流式增量不带工具图片：图片已随工具结束的全量快照到过渲染端，

/** 流式期 ~100ms 节流推送末条 assistant 消息（含未完成的流式消息）。 */
function stream(id: string, entry: Live) {
  const now = Date.now();
  if (now - (streamTimers.get(id) ?? 0) < 100) return;
  streamTimers.set(id, now);
  const streaming = entry.session.state.streamingMessage;
  const messages = projectMessages(
    streaming ? [...entry.session.messages, streaming] : entry.session.messages,
    liveSteps.get(id),
    true,
  );
  const last = messages.at(-1);
  if (last?.role === 'assistant')
    hostPorts().broadcaster.send('session:on-stream', {
      sessionId: id,
      message: withoutToolImages(last),
      activeTool: entry.run?.tool,
      contextUsage: usageOf(entry),
    });
}

function touch(id: string, entry: Live) {
  storeActivity(id, entry.session.messages.filter((m) => m.role === 'user').length);
}

function runEvent(
  sessionId: string,
  status: RunStatus,
  activeTool?: string,
  finishedRunId?: string,
  changesError?: string,
) {
  const entry = live.get(sessionId);
  hostPorts().broadcaster.send('session:on-run-event', {
    sessionId,
    runId: finishedRunId ?? entry?.run?.id ?? '',
    status,
    activeTool,
    ...(changesError ? { changesError } : {}),
  });
}

/** 子 Agent 跑一轮：signal 中止时连带停止；只交回本轮的最终回复。 */
export async function runSubagent(
  id: string,
  prompt: string,
  signal: AbortSignal | undefined,
  onEvent: (event: AgentSessionEvent) => void,
): Promise<SubagentResult> {
  const entry = await ensureLive(id);
  if (entry.run || entry.session.isCompacting)
    throw new Error('这个子 Agent 还在运行，等它结束再续接');
  if (signal?.aborted) return { status: 'stopped', reply: null };
  const turnId = randomUUID();
  const priorCount = entry.session.messages.length;
  const unsubscribe = entry.session.subscribe(onEvent);
  const stop = () => cancelRun(id);
  signal?.addEventListener('abort', stop, { once: true });
  try {
    const status = await runTurn(id, entry, turnId, [], () =>
      entry.session.prompt(`${encodeMeta({ turnId, body: prompt })}${prompt}`),
    );
    const last = entry.session.messages.slice(priorCount).findLast((m) => m.role === 'assistant');
    if (last?.role !== 'assistant') return { status, reply: null };
    const reply = last.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('\n\n')
      .trim();
    return {
      status,
      reply: reply || null,
      ...(last.stopReason === 'error' ? { error: last.errorMessage ?? '未知错误' } : {}),
    };
  } finally {
    signal?.removeEventListener('abort', stop);
    unsubscribe();
  }
}

/** 停止时先撤回还没送达的插队消息，与 Pi 终端界面一致：它们回到输入框，不随本轮丢掉。 */
export function cancelRun(id: string): ChatQueuedDraft | null {
  const entry = live.get(id);
  const queued = entry?.run ? queuedDraft(takeSteers(entry, entry.run)) : null;
  if (entry?.run) entry.run.cancelled = true;
  void entry?.session.abort();
  return queued;
}

export function withdrawQueued(id: string): ChatQueuedDraft | null {
  const entry = live.get(id);
  if (!entry?.run) return null;
  const draft = queuedDraft(takeSteers(entry, entry.run));
  // 清空队列时一并丢掉的任务通知重新插进本轮。
  for (const notice of undeliveredNotices(entry, entry.run))
    void entry.session.sendCustomMessage(noticeMessage(notice));
  return draft;
}

const noticeMessage = (notice: TaskNotice) => ({
  customType: TASK_NOTICE,
  content: notice.text,
  display: true,
  details: notice.details,
});

function undeliveredNotices(entry: Live, run: Run): TaskNotice[] {
  const delivered = new Set(
    entry.session.messages.flatMap((message) =>
      message.role === 'custom' && message.customType === TASK_NOTICE
        ? [(message.details as TaskNoticeDetails).noticeId]
        : [],
    ),
  );
  return run.notices.filter((notice) => !delivered.has(notice.details.noticeId));
}

/**
 * 后台任务结束的通知：父会话运行中插进本轮，收尾中等它结束，空闲时开一轮（界面显示运行中）。
 * wake=false 时（用户在面板上手动停止）只追加进记录，不开新的一轮。
 */
export async function deliverTaskNotice(
  id: string,
  notice: TaskNotice,
  wake: boolean,
): Promise<void> {
  const entry = await ensureLive(id);
  if (!wake) {
    // 运行中 Pi 把它留到本轮结束再追加，不插进工具调用与结果之间。
    await entry.session.sendCustomMessage(noticeMessage(notice), { triggerTurn: false });
    return;
  }
  const run = entry.run;
  if (run && !run.finishing && !run.cancelled && entry.session.isStreaming) {
    run.notices.push(notice);
    await entry.session.sendCustomMessage(noticeMessage(notice));
    return;
  }
  if (run || entry.session.isCompacting) {
    await (run ? run.done : entry.session.waitForIdle());
    return deliverTaskNotice(id, notice, wake);
  }
  const turnId = randomUUID();
  const message = noticeMessage({ ...notice, details: { ...notice.details, turnId } });
  await runTurn(id, entry, turnId, [], () =>
    entry.session.sendCustomMessage(message, { triggerTurn: true }),
  );
}

/** 清空 Pi 的插队队列，取回这些消息的原始输入；已送达的留在 run 里等轮末释放附件。 */
function takeSteers(entry: Live, run: Run) {
  return entry.session.clearQueue().steering.flatMap((prompt) => {
    const index = run.steers.findIndex((steer) => steer.prompt === prompt);
    return index < 0 ? [] : run.steers.splice(index, 1).map(({ input }) => input);
  });
}

function queuedDraft(inputs: ChatAskInput[]): ChatQueuedDraft | null {
  if (!inputs.length) return null;
  return {
    text: inputs
      .map(({ text }) => text)
      .filter((text) => text.trim())
      .join('\n\n'),
    comments: inputs.flatMap(({ comments }) => comments),
    attachments: inputs.flatMap(({ attachments }) => attachments.map(chatAttachmentView)),
  };
}

/** 一轮对话：文本直接入上下文，文档附件仅传本地引用，由 skill 按需解析。运行中发来的消息插进本轮。 */
export async function askSession(id: string, input: ChatAskInput): Promise<WorkspaceChat> {
  if (row(id).parent_id) throw new Error('子 Agent 的会话只读');
  const entry = await ensureLive(id);
  const current = entry.run;
  if (current && !input.replaceLastUser) {
    if (!current.finishing && !current.cancelled) return steerRun(id, entry, current, input);
    // 实例可能在轮末按新配置重建，等完从头再来。
    await current.done;
    return askSession(id, input);
  }
  if (entry.run) throw new Error('请等待当前回答完成');
  if (entry.session.isCompacting) throw new Error('正在压缩上下文，请稍候');
  const { prompt, userText, images, attachments, comments, turnId } = composePrompt(
    input,
    row(id).project_id,
  );
  if (input.replaceLastUser) {
    // 编辑重发：从最后一条用户消息之前分支（Pi 会话树保留旧分支）。
    const branch = entry.session.sessionManager.getBranch();
    const lastUser = [...branch]
      .reverse()
      .find((item) => item.type === 'message' && item.message.role === 'user');
    if (!lastUser) throw new Error('没有可编辑的消息');
    if (lastUser.parentId) entry.session.sessionManager.branch(lastUser.parentId);
    else entry.session.sessionManager.resetLeaf();
    entry.session.agent.state.messages =
      entry.session.sessionManager.buildSessionContext().messages;
  }
  if (row(id).title === '新对话')
    storeTitle(
      id,
      userText || comments[0]?.comment || comments[0]?.quote || attachments[0]?.name || '图片请求',
    );
  await runTurn(id, entry, turnId, input.attachments, () =>
    entry.session.prompt(prompt, images.length ? { images } : undefined),
  );
  return snapshot(id);
}

type TurnStatus = 'completed' | 'failed' | 'stopped';

/**
 * 一轮执行的记账：登记 run、拍目录快照、冻结本轮改动、推送状态与提醒、轮末释放附件并丢弃过期实例。
 * start 只负责把这一轮交给 Pi；不经这里开的一轮界面不显示运行中，改动也不进审阅。
 * 子 Agent 的改动落在父会话这一轮的快照里，自己不拍快照、不记改动，也不弹完成提醒。
 */
async function runTurn(
  id: string,
  entry: Live,
  turnId: string,
  attachments: string[],
  start: () => Promise<void>,
): Promise<TurnStatus> {
  const meta = row(id);
  const child = meta.parent_id !== null;
  let finishRun!: () => void;
  const run: Run = {
    id: turnId,
    cancelled: false,
    steers: [],
    notices: [],
    done: new Promise<void>((resolve) => {
      finishRun = resolve;
    }),
  };
  entry.run = run;
  liveSteps.set(id, new Map());
  runEvent(id, 'running');
  let status: TurnStatus = 'completed';
  const startedAt = new Date().toISOString();
  let before: changes.DirectorySnapshot | null = null;
  let captureError: string | undefined;
  try {
    if (isRemoteSession(meta)) captureError = '远程会话暂不记录目录快照';
    else if (!child) {
      try {
        before = await changes.captureDirectory(entry.cwd);
      } catch (error) {
        captureError = error instanceof Error ? error.message : String(error);
      }
    }
    // 只看本轮新产生的回复：扩展命令可能一条消息都不发，不能拿上一轮的结果来判本轮成败。
    const priorCount = entry.session.messages.length;
    if (run.cancelled) status = 'stopped';
    else await start();
    const last = entry.session.messages.slice(priorCount).findLast((m) => m.role === 'assistant');
    if (run.cancelled || (last?.role === 'assistant' && last.stopReason === 'aborted'))
      status = 'stopped';
    else if (last?.role === 'assistant' && last.stopReason === 'error') status = 'failed';
  } catch (error) {
    status = 'failed';
    throw error;
  } finally {
    run.finishing = true;
    let changesError: string | undefined;
    try {
      if (!child)
        await changes.freezeTurnChanges(
          id,
          turnId,
          entry.cwd,
          startedAt,
          status,
          before,
          captureError,
        );
    } catch (error) {
      changesError = error instanceof Error ? error.message : String(error);
    }
    // Pi 最后一次取队列之后才插进来的消息没人送达，收尾后作为新一轮发出。
    const orphaned = takeSteers(entry, run);
    // 没送达的任务通知同样补投；用户停止了这一轮时只追加，不立刻再开一轮。
    const lostNotices = undeliveredNotices(entry, run);
    try {
      releaseChatAttachments([
        ...attachments,
        ...run.steers.flatMap((steer) => steer.input.attachments),
      ]);
      entry.run = undefined;
      liveSteps.delete(id);
      if (entry.session.sessionFile) storeSessionFile(id, entry.session.sessionFile);
      touch(id, entry);
      runEvent(id, status, undefined, turnId, changesError);
      publish(id);
      if (status !== 'stopped' && !child) hostPorts().notifier.notifyRunFinished(id, status);
      if (entry.stale) disposeLive(id, entry);
    } finally {
      finishRun();
    }
    for (const steer of orphaned)
      void askSession(id, steer).catch((error: unknown) =>
        console.error('插队消息发送失败', error),
      );
    for (const notice of lostNotices)
      void deliverTaskNotice(id, notice, !run.cancelled).catch((error: unknown) =>
        console.error('后台任务通知投递失败', error),
      );
  }
  return status;
}

async function steerRun(id: string, entry: Live, run: Run, input: ChatAskInput) {
  const { prompt, images } = composePrompt(input, row(id).project_id, run.id);
  await entry.session.steer(prompt, images.length ? images : undefined);
  run.steers.push({ prompt, input });
  return snapshot(id);
}
