import { randomUUID } from 'node:crypto';
import {
  INLINE_IMAGE_MAX,
  parseChatBlocks,
  stripChatImageTokens,
} from '../../../shared/chat-input';
import type { AgentToolResult, WorkspaceChat } from '../../../shared/api';
import { getDatabase } from '../../database';
import { getActiveLlmProvider } from '../core/providers';
import type { ChatContentPart } from '../core/run';
import { SYSTEM_PROMPT, historyWindow, referencePreamble } from '../context/assemble';
import { readAskReferences } from '../context/references';
import { readChatMediaBytes, releaseChatAttachments } from './media';
import { asking } from './runs';
import { activeSession, persistSession, resolveSession, sessionRow, snapshot } from './store';
import { publishChat } from './subscriptions';

export function newChat(scope: string): WorkspaceChat {
  if (asking.has(scope)) throw new Error('请等待当前回答完成');
  const current = resolveSession(scope);
  // 空会话不进入历史：点“新对话”时清掉上一条从未发送过消息的会话。
  if (current && current.messages === '[]') {
    getDatabase().prepare('DELETE FROM chat_sessions WHERE id=?').run(current.id);
  }
  activeSession.set(scope, null);
  publishChat(scope);
  return snapshot(resolveSession(scope));
}

export function openChat(scope: string, sessionId: string): WorkspaceChat {
  const row = sessionRow(sessionId);
  if (!row || row.scope !== scope) throw new Error('会话不存在');
  if (asking.has(scope) && activeSession.get(scope) !== sessionId)
    throw new Error('请等待当前回答完成');
  activeSession.set(scope, sessionId);
  return snapshot(row);
}

export function deleteChat(scope: string, sessionId: string): void {
  const row = sessionRow(sessionId);
  if (!row || row.scope !== scope) return;
  // 删除正在流式输出的当前会话时先中断本轮（与停止按钮同路径），否则删除后仍会
  // 推送「running 且无消息」的僵尸忙碌态，直到这轮自然跑完。
  if (asking.has(scope) && activeSession.get(scope) === sessionId)
    asking.get(scope)?.controller.abort();
  getDatabase().prepare('DELETE FROM chat_sessions WHERE id=?').run(sessionId);
  if (activeSession.get(scope) === sessionId) activeSession.set(scope, null);
  publishChat(scope);
}

// 图片扩展名 → data URL 的 MIME。
const imageMimeByExtension: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

export async function ask(
  scope: string,
  input: { text: string; attachments: string[]; context: string[]; replaceLastUser?: boolean },
): Promise<WorkspaceChat> {
  if (asking.has(scope)) throw new Error('请等待当前回答完成');
  const provider = getActiveLlmProvider();
  if (!provider) throw new Error('请先在设置中配置模型服务');
  const run = { controller: new AbortController(), tool: undefined as string | undefined };
  asking.set(scope, run);
  try {
    // 图文混排：按出现顺序拆分 blocks；图片 token 之外的文字作为消息正文。
    const blocks = parseChatBlocks(input.text);
    const images = blocks.filter((block) => block.type === 'image');
    if (images.length > INLINE_IMAGE_MAX)
      throw new Error(`一条消息最多插入 ${INLINE_IMAGE_MAX} 张图片`);
    const userText = stripChatImageTokens(input.text);
    if (!userText && !images.length) throw new Error('请输入内容或添加图片');
    const { documents, attachmentDocs } = await readAskReferences(input.context, input.attachments);
    let row = resolveSession(scope);
    if (!row) {
      if (input.replaceLastUser) throw new Error('没有可编辑的消息');
      row = {
        id: randomUUID(),
        scope,
        title: (userText || '图片请求').slice(0, 60),
        messages: '[]',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      getDatabase()
        .prepare(
          'INSERT INTO chat_sessions (id, scope, title, messages, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(row.id, row.scope, row.title, row.messages, row.created_at, row.updated_at);
      activeSession.set(scope, row.id);
    }
    const chat = snapshot(row);
    if (input.replaceLastUser) {
      // 编辑重发：丢弃最后一条用户消息及其后的回答，引用/附件以本次输入为准。
      const lastUserIndex = chat.messages.map((message) => message.role).lastIndexOf('user');
      if (lastUserIndex < 0) throw new Error('没有可编辑的消息');
      chat.messages.length = lastUserIndex;
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
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...historyWindow(chat.messages),
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
      row!.messages = JSON.stringify(chat.messages);
      persistSession(row!);
      publishChat(scope);
    };
    // 思考与正文增量共用 ~100ms 节流推送；工具事件与最终结果即时持久化并推送。
    let lastStreamPublish = 0;
    const publishStream = () => {
      const now = Date.now();
      if (now - lastStreamPublish < 100) return;
      lastStreamPublish = now;
      // 携带内存中的活跃消息数组：持久化的 row.messages 尚未更新，直接读库会回退内容。
      publishChat(scope, { messages: chat.messages, running: true, activeTool: run.tool });
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
      } else {
        reply.interrupted = true;
        // 中断文案以新 text 部分落地前，先为流式中的思考段收尾计时。
        closeTrailingReasoning();
        reply.parts!.push({ type: 'text', text: '' });
        updateText(
          `本次执行中断：${error instanceof Error ? error.message : '未知错误'}。已完成的操作保留，请查看工具结果。`,
        );
        throw error;
      }
    } finally {
      run.tool = undefined;
      closeTrailingReasoning();
      reply.finishedAt = Date.now();
      persist();
    }
    return { ...chat, running: false, activeTool: undefined };
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'TypeError'))
      throw new Error('模型请求超时或网络连接失败，请重试');
    throw error;
  } finally {
    asking.delete(scope);
    publishChat(scope);
  }
}

export function cancelAsk(scope: string) {
  asking.get(scope)?.controller.abort();
}
