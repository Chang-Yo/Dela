import { randomUUID } from 'node:crypto';
import {
  INLINE_IMAGE_MAX,
  parseChatBlocks,
  stripChatImageTokens,
} from '../../../shared/chat-input';
import type { AgentToolResult, ChatSessionSummary, WorkspaceChat } from '../../../shared/api';
import { getDatabase } from '../../database';
import { getActiveLlmProvider } from '../core/providers';
import type { ChatContentPart } from '../core/run';
import {
  assembleModelContext,
  compactSplitIndex,
  SYSTEM_PROMPT,
  referencePreamble,
  summaryContextText,
} from '../context/assemble';
import {
  IMAGE_TOKEN_EST,
  SUMMARY_RESERVE_TOKENS,
  contextBudget,
  estimateTokens,
  shouldCompact,
} from '../context/budget';
import { parseSessionSummary, summarizeHistory, type SessionSummary } from '../context/compaction';
import { readAskReferences } from '../context/references';
import { ensureProjectProfile } from '../../workspace/projects';
import { readChatMediaBytes, releaseChatAttachments } from './media';
import {
  activeRuns,
  appendRunStep,
  completeRunStep,
  createRun,
  finishRun,
  markRunRunning,
  type ActiveRun,
  type RunRequest,
} from './runs';
import {
  activeSession,
  compactingSessions,
  persistSession,
  resolveSession,
  saveSessionSummary,
  sessionRow,
  snapshot,
} from './store';
import type { SessionRow } from './store';
import {
  clearOriginScope,
  publishChat,
  publishRunEvent,
  publishSession,
  setOriginScope,
} from './subscriptions';

type AskInput = {
  text: string;
  attachments: string[];
  context: string[];
  replaceLastUser?: boolean;
};

function nowIso(): string {
  return new Date().toISOString();
}

// ===== Session 新身份 API（session:* 通道；renderer 阶段三接入） =====

/** 新建会话：显式身份（区别于旧入口的懒创建）；projectId 需为现存 project 条目。 */
function createSessionRow(projectId: string | null): SessionRow {
  if (projectId !== null) {
    const entry = getDatabase()
      .prepare('SELECT kind FROM workspace_entries WHERE id=?')
      .get(projectId) as { kind: string } | undefined;
    if (!entry || entry.kind !== 'project') throw new Error('项目不存在');
    // v13 后新建/由 folder 转换的项目条目没有档案行，首次挂会话时补建。
    ensureProjectProfile(projectId);
  }
  const row: SessionRow = {
    id: randomUUID(),
    project_id: projectId,
    title: '新对话',
    messages: '[]',
    summary: null,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  getDatabase()
    .prepare(
      'INSERT INTO sessions (id, project_id, title, messages, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(row.id, row.project_id, row.title, row.messages, row.created_at, row.updated_at);
  return row;
}

export function newSession(projectId: string | null): WorkspaceChat {
  return snapshot(createSessionRow(projectId));
}

export function openSession(sessionId: string): WorkspaceChat {
  const row = sessionRow(sessionId);
  if (!row) throw new Error('会话不存在');
  return snapshot(row);
}

/** 删除会话（运行中先中断本轮）；关联 Run 行经外键级联删除。 */
export function deleteSession(sessionId: string): void {
  const row = sessionRow(sessionId);
  if (!row) return;
  // 与停止按钮同路径：避免删除后仍推送「running 且无消息」的僵尸忙碌态。
  activeRuns.get(sessionId)?.controller.abort();
  getDatabase().prepare('DELETE FROM sessions WHERE id=?').run(sessionId);
  for (const [scope, current] of activeSession) {
    if (current === sessionId) activeSession.set(scope, null);
  }
}

export function listSessions(projectId: string | null, query: string): ChatSessionSummary[] {
  const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
  const sql = query
    ? "SELECT id, title, updated_at AS updatedAt, json_array_length(messages) AS messageCount FROM sessions WHERE project_id IS ? AND (title LIKE ? ESCAPE '\\' OR messages LIKE ? ESCAPE '\\') ORDER BY updated_at DESC LIMIT 100"
    : 'SELECT id, title, updated_at AS updatedAt, json_array_length(messages) AS messageCount FROM sessions WHERE project_id IS ? ORDER BY updated_at DESC LIMIT 100';
  return getDatabase()
    .prepare(sql)
    .all(
      ...(query ? [projectId, pattern, pattern] : [projectId]),
    ) as unknown as ChatSessionSummary[];
}

export function cancelRun(sessionId: string) {
  activeRuns.get(sessionId)?.controller.abort();
}

// 图片扩展名 → data URL 的 MIME。
const imageMimeByExtension: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

/** 发起一轮执行：同 session 串行（活跃 Run 互斥）、跨 session 并行；Run 生命周期落 runs 表。 */
export async function askSession(sessionId: string, input: AskInput): Promise<WorkspaceChat> {
  if (activeRuns.has(sessionId)) throw new Error('请等待当前回答完成');
  const row = sessionRow(sessionId);
  if (!row) throw new Error('会话不存在');
  // Run 先落 pending：发送前校验失败（未配置模型、输入解析、引用读取）由此态转 failed。
  const run: ActiveRun = {
    runId: createRun(sessionId, row.project_id, {
      text: stripChatImageTokens(input.text).slice(0, 200),
    }),
    controller: new AbortController(),
    steps: [],
  };
  activeRuns.set(sessionId, run);
  publishRunEvent(sessionId, run.runId, 'pending');
  // 终态在出口统一写库：成功 completed、用户停止 stopped、其余 failed。
  let terminal: 'completed' | 'stopped' | 'failed' = 'failed';
  let runError: string | undefined;
  try {
    const provider = getActiveLlmProvider();
    if (!provider) throw new Error('请先在设置中配置模型服务');
    // 图文混排：按出现顺序拆分 blocks；图片 token 之外的文字作为消息正文。
    const blocks = parseChatBlocks(input.text);
    const images = blocks.filter((block) => block.type === 'image');
    if (images.length > INLINE_IMAGE_MAX)
      throw new Error(`一条消息最多插入 ${INLINE_IMAGE_MAX} 张图片`);
    const userText = stripChatImageTokens(input.text);
    if (!userText && !images.length) throw new Error('请输入内容或添加图片');
    const { documents, attachmentDocs } = await readAskReferences(input.context, input.attachments);
    const chat = snapshot(row);
    if (input.replaceLastUser) {
      // 编辑重发：丢弃最后一条用户消息及其后的回答，引用/附件以本次输入为准。
      const lastUserIndex = chat.messages.map((message) => message.role).lastIndexOf('user');
      if (lastUserIndex < 0) throw new Error('没有可编辑的消息');
      chat.messages.length = lastUserIndex;
    }
    // 引用读取与输入校验通过、首次模型请求前转 running，并写请求摘要（不含正文全文）。
    const request: RunRequest = {
      text: userText.slice(0, 200),
      sources: documents.map(({ key, title }) => ({ key, title })),
      attachments: attachmentDocs.map(({ name }) => ({ name })),
    };
    markRunRunning(run.runId, request);
    publishRunEvent(sessionId, run.runId, 'running');
    // 首条消息为会话命名（沿用旧懒创建路径的标题语义）。
    if (row.messages === '[]') {
      row.title = (userText || '图片请求').slice(0, 60);
      getDatabase().prepare('UPDATE sessions SET title=? WHERE id=?').run(row.title, row.id);
    }
    const { runAgent } = await import('../core/run');
    const { modelToolDefinitions, executeAgentTool } = await import('../tools/registry');
    // 模型侧用户消息：引用资料与附件作为前言，其后按用户输入顺序排列文字与图片。
    const contentParts: ChatContentPart[] = [
      { type: 'text', text: referencePreamble(documents, attachmentDocs) },
    ];
    for (const block of blocks) {
      if (block.type === 'text') {
        if (block.text.trim()) contentParts.push({ type: 'text', text: block.text });
      } else {
        const bytes = readChatMediaBytes(block.id);
        const extension = block.name.slice(block.name.lastIndexOf('.') + 1).toLowerCase();
        const mime = imageMimeByExtension[extension] ?? 'image/png';
        contentParts.push({
          type: 'image_url',
          image_url: { url: `data:${mime};base64,${bytes.toString('base64')}` },
        });
      }
    }
    // ===== 上下文预算与压缩（计划 §6.1）：估算计入指令、工具定义、摘要、全量历史、本轮引用与图片 =====
    const toolTokens = estimateTokens(JSON.stringify(modelToolDefinitions()));
    const currentRoundTokens = contentParts.reduce(
      (total, part) => total + (part.type === 'text' ? estimateTokens(part.text) : IMAGE_TOKEN_EST),
      0,
    );
    let summary: SessionSummary | null = parseSessionSummary(row.summary);
    const estimate =
      estimateTokens(
        summary ? `${SYSTEM_PROMPT}\n\n${summaryContextText(summary)}` : SYSTEM_PROMPT,
      ) +
      chat.messages.reduce((total, message) => total + estimateTokens(message.content), 0) +
      currentRoundTokens +
      toolTokens;
    if (shouldCompact(estimate)) {
      // 覆盖范围 = 本次估算中放不进触发阈值的较早历史（为输出、工具交互与摘要块留余量）。
      const { budget, compactThreshold } = contextBudget();
      const affordable =
        compactThreshold -
        currentRoundTokens -
        toolTokens -
        estimateTokens(SYSTEM_PROMPT) -
        SUMMARY_RESERVE_TOKENS;
      const priorCovered = summary?.coveredUpTo ?? 0;
      const splitIndex = compactSplitIndex(chat.messages, priorCovered, affordable);
      if (splitIndex > priorCovered) {
        compactingSessions.add(sessionId);
        publishSession(sessionId);
        try {
          const generated = await summarizeHistory(
            { baseUrl: provider.baseUrl, key: provider.apiKey, model: provider.model },
            {
              messages: chat.messages.slice(priorCovered, splitIndex),
              startIndex: priorCovered,
              messageCount: chat.messages.length,
              priorSummary: summary,
            },
          );
          // 压缩成功才替换模型上下文：摘要持久化后跨 Run 生效（重启续接读取同一列）。
          summary = generated;
          row.summary = JSON.stringify(generated);
          saveSessionSummary(sessionId, row.summary);
        } catch (error) {
          // 失败保留原始历史；不压缩也放得下时照常发送，放不下则明确失败，不静默回退条数截断。
          if (estimate > budget)
            throw new Error(
              `上下文压缩失败，请重试或减少引用资料（${error instanceof Error ? error.message : '未知错误'}）`,
            );
        } finally {
          compactingSessions.delete(sessionId);
          publishSession(sessionId);
        }
      }
    }
    const assembled = assembleModelContext({
      history: chat.messages,
      summary,
      reservedTokens: currentRoundTokens + toolTokens,
    });
    const messages = [
      { role: 'system', content: assembled.system },
      ...assembled.history,
      { role: 'user', content: contentParts },
    ];
    const reply: WorkspaceChat['messages'][number] = {
      role: 'assistant',
      content: '',
      toolResults: [],
      parts: [],
      startedAt: Date.now(),
    };
    chat.messages.push(
      {
        role: 'user',
        content: userText,
        sources: documents.map(({ key, title }) => ({ key, title })),
        images: images.map(({ id, name }) => ({ id, name })),
        attachments: attachmentDocs.map(({ name }) => ({ name })),
      },
      reply,
    );
    const persist = () => {
      row.messages = JSON.stringify(chat.messages);
      persistSession(row);
      publishSession(sessionId, { messages: chat.messages });
    };
    // 思考与正文增量共用 ~100ms 节流推送；工具事件与最终结果即时持久化并推送。
    let lastStreamPublish = 0;
    const publishStream = () => {
      const now = Date.now();
      if (now - lastStreamPublish < 100) return;
      lastStreamPublish = now;
      // 携带内存中的活跃消息数组：持久化的 row.messages 尚未更新，直接读库会回退内容。
      publishSession(sessionId, { messages: chat.messages, running: true, activeTool: run.tool });
    };
    // 思考段进入正文或工具阶段时收尾计时，供 UI 显示“已思考 · X 秒”。
    const closeTrailingReasoning = () => {
      const last = reply.parts!.at(-1);
      if (last?.type === 'reasoning' && last.finishedAt === undefined) last.finishedAt = Date.now();
    };
    // 思考内容独立于公开正文（content）：不进复制、笔记与回灌模型的上下文。
    const updateReasoning = (text: string) => {
      if (!text) return;
      const last = reply.parts!.at(-1);
      if (last?.type === 'reasoning') last.text = text;
      else reply.parts!.push({ type: 'reasoning', text, startedAt: Date.now() });
    };
    const updateText = (text: string) => {
      if (!text) return;
      closeTrailingReasoning();
      const last = reply.parts!.at(-1);
      if (last?.type === 'text') last.text = text;
      else reply.parts!.push({ type: 'text', text });
      reply.content = reply
        .parts!.flatMap((part) => (part.type === 'text' ? [part.text] : []))
        .join('\n\n');
    };
    persist();
    // 附件内容已进入消息与模型上下文，释放内存暂存；图片落盘文件由消息引用，交给启动 GC。
    releaseChatAttachments(input.attachments);
    try {
      const result = await runAgent({
        baseUrl: provider.baseUrl,
        model: provider.model,
        key: provider.apiKey,
        // 已开启推理强度时随请求下发 reasoning_effort；未开启不携带该字段。
        effort: provider.effortLevels?.length
          ? (provider.effort ?? provider.effortLevels[0]!)
          : undefined,
        messages,
        tools: modelToolDefinitions(),
        signal: run.controller.signal,
        execute: executeAgentTool,
        // 运行内修剪：多轮工具结果撑大上下文时在每次模型请求前修剪较早工具结果（core/pi.ts）。
        prunePolicy: {},
        onText: (text) => {
          updateText(text);
          publishStream();
        },
        onReasoning: (text) => {
          updateReasoning(text);
          publishStream();
        },
        onToolStart: (call) => {
          run.tool = call.name;
          appendRunStep(run, call);
          publishRunEvent(sessionId, run.runId, 'running', call.name);
          closeTrailingReasoning();
          if (reply.parts!.at(-1)?.type !== 'tools')
            reply.parts!.push({ type: 'tools', results: [] });
          const group = reply.parts!.at(-1);
          // 占位步骤先入组：UI 实时展示动作链；完成时按 id 回填并补 finishedAt。
          if (group && group.type === 'tools')
            group.results.push({
              id: call.id,
              name: call.name,
              input: call.input,
              startedAt: Date.now(),
            });
          persist();
        },
        onToolResult: (result) => {
          run.tool = undefined;
          const failed =
            typeof result.output === 'object' &&
            result.output !== null &&
            (result.output as { ok?: unknown }).ok === false;
          completeRunStep(run, result.id, failed);
          publishRunEvent(sessionId, run.runId, 'running');
          const last = reply.parts!.at(-1);
          const group = last && last.type === 'tools' ? last : undefined;
          const placeholder = group?.results.find((item) => item.id === result.id);
          const completed: AgentToolResult = {
            ...result,
            startedAt: placeholder?.startedAt,
            finishedAt: Date.now(),
          };
          reply.toolResults!.push(completed);
          if (placeholder) group!.results[group!.results.indexOf(placeholder)] = completed;
          else group?.results.push(completed);
          persist();
        },
      });
      updateText(result.content);
    } catch (error) {
      if (run.controller.signal.aborted) {
        // 用户主动停止：保留已生成的部分内容并正常返回，不追加中断说明；
        // 请求超时用 AbortSignal.timeout 的独立信号，不会误入此分支。
        reply.stopped = true;
        terminal = 'stopped';
      } else {
        reply.interrupted = true;
        runError = error instanceof Error ? error.message : '未知错误';
        terminal = 'failed';
        // 中断文案以新 text 部分落地前，先为流式中的思考段收尾计时。
        closeTrailingReasoning();
        reply.parts!.push({ type: 'text', text: '' });
        updateText(`本次执行中断：${runError}。已完成的操作保留，请查看工具结果。`);
        throw error;
      }
    } finally {
      run.tool = undefined;
      closeTrailingReasoning();
      reply.finishedAt = Date.now();
      persist();
    }
    // 内层未抛错即成功收尾；stopped 已在中止分支写好。
    if (terminal !== 'stopped') terminal = 'completed';
    return { ...chat, running: false, activeTool: undefined };
  } catch (error) {
    if (runError === undefined) runError = error instanceof Error ? error.message : '未知错误';
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'TypeError'))
      throw new Error('模型请求超时或网络连接失败，请重试');
    throw error;
  } finally {
    activeRuns.delete(sessionId);
    finishRun(run.runId, terminal, runError);
    publishRunEvent(sessionId, run.runId, terminal);
    publishSession(sessionId);
  }
}

// ===== 旧 scope 语义 shim（过渡兼容，阶段三随 renderer 接入 session:* 移除） =====

/** scope → project_id：'home'/'sources'/'projects' 并入通用池（NULL），project 条目 UUID 原样。 */
export function scopeToProjectId(scope: string): string | null {
  return scope === 'home' || scope === 'sources' || scope === 'projects' ? null : scope;
}

/** 旧入口的互斥语义：scope 当前打开的会话正在执行时拒绝操作（指针在执行期不可切换）。 */
function scopeBusy(scope: string): boolean {
  const current = activeSession.get(scope);
  return current !== undefined && current !== null && activeRuns.has(current);
}

export function newChat(scope: string): WorkspaceChat {
  if (scopeBusy(scope)) throw new Error('请等待当前回答完成');
  const current = resolveSession(scope);
  // 空会话不进入历史：点“新对话”时清掉上一条从未发送过消息的会话。
  if (current && current.messages === '[]') deleteSession(current.id);
  activeSession.set(scope, null);
  publishChat(scope);
  return snapshot(resolveSession(scope));
}

export function openChat(scope: string, sessionId: string): WorkspaceChat {
  const row = sessionRow(sessionId);
  if (!row || row.project_id !== scopeToProjectId(scope)) throw new Error('会话不存在');
  if (scopeBusy(scope) && activeSession.get(scope) !== sessionId)
    throw new Error('请等待当前回答完成');
  activeSession.set(scope, sessionId);
  return snapshot(row);
}

export function deleteChat(scope: string, sessionId: string): void {
  const row = sessionRow(sessionId);
  if (!row || row.project_id !== scopeToProjectId(scope)) return;
  deleteSession(sessionId);
  publishChat(scope);
}

export function listChats(scope: string, query: string): ChatSessionSummary[] {
  return listSessions(scopeToProjectId(scope), query);
}

export function cancelAsk(scope: string) {
  const current = activeSession.get(scope);
  if (current) cancelRun(current);
}

export async function ask(scope: string, input: AskInput): Promise<WorkspaceChat> {
  if (scopeBusy(scope)) throw new Error('请等待当前回答完成');
  let sessionId = activeSession.get(scope) ?? null;
  if (!sessionId || !sessionRow(sessionId)) {
    // 旧入口懒创建：首次发送时落会话行并记住指针（新对话闲置态到此结束）。
    sessionId = createSessionRow(scopeToProjectId(scope)).id;
    activeSession.set(scope, sessionId);
  }
  // 过渡期：旧通道按发起入口的 scope 广播该会话的更新。
  setOriginScope(sessionId, scope);
  try {
    return await askSession(sessionId, input);
  } finally {
    clearOriginScope(sessionId);
    publishChat(scope);
  }
}
