/**
 * Pi Coding Agent 接线：Dela 的 agent 内核就是 pi-coding-agent SDK 本身。
 * 这里只做三件事：加载纯 ESM 的 SDK、把 Dela 的提供商配置注册成 Pi 模型、
 * 以项目目录为 cwd 创建/打开会话。工具、会话树、压缩、skills、AGENTS.md 都交给 Pi。
 */
import { app } from 'electron';
import { join } from 'node:path';
import type { AgentSession, ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { Model } from '@earendil-works/pi-ai';
import type { StoredLlmProvider } from '../credentials';
import { llmModelSettings, LLM_DEFAULT_CONTEXT_WINDOW } from '../../shared/llm-presets';

type Sdk = typeof import('@earendil-works/pi-coding-agent');

let sdk: Promise<Sdk> | undefined;
/** Pi 包是纯 ESM：主进程 CJS 产物只能动态 import。 */
export function loadPi(): Promise<Sdk> {
  sdk ??= import('@earendil-works/pi-coding-agent');
  return sdk;
}

/** Pi 的全局目录（auth/models/settings/skills/bin）：放在应用数据下，与用户的 ~/.pi 隔离。 */
export function piAgentDir(): string {
  return join(app.getPath('userData'), 'pi');
}

export function piSessionsDir(): string {
  return join(piAgentDir(), 'sessions');
}

const PROVIDER = 'dela';

/** Dela 档位 → Pi ThinkingLevel；超出 Pi 档位集的扩展档位挂到最高档。 */
function thinkingLevel(effort: string | undefined) {
  if (!effort || effort === 'none') return 'off' as const;
  const known = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
  return (known as readonly string[]).includes(effort)
    ? (effort as (typeof known)[number])
    : ('max' as const);
}

/** 当前提供商注册为 Pi 的 OpenAI 兼容提供商，返回当前模型与思考档位。 */
export async function resolveModel(provider: StoredLlmProvider, modelId = provider.model) {
  const runtime = await modelRuntime();
  const settings = llmModelSettings(provider, modelId);
  const reasoning = settings.effortLevels.length > 0;
  runtime.registerProvider(PROVIDER, {
    baseUrl: provider.baseUrl.replace(/\/+$/, ''),
    api: 'openai-completions',
    apiKey: provider.apiKey,
    models: provider.models.map((id) => {
      const model = llmModelSettings(provider, id);
      return {
        id,
        name: id,
        reasoning: model.effortLevels.length > 0,
        input: ['text', 'image'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: model.contextWindow ?? LLM_DEFAULT_CONTEXT_WINDOW,
        maxTokens: model.maxOutputTokens ?? 32000,
      };
    }),
  });
  const model = runtime.getModel(PROVIDER, modelId) as Model<'openai-completions'> | undefined;
  if (!model) throw new Error('模型不在当前提供商的模型列表中');
  return { model, thinking: reasoning ? thinkingLevel(settings.effort) : ('off' as const) };
}

let runtimePromise: ReturnType<Sdk['ModelRuntime']['create']> | undefined;
async function modelRuntime() {
  const pi = await loadPi();
  runtimePromise ??= pi.ModelRuntime.create({
    authPath: join(piAgentDir(), 'auth.json'),
    modelsPath: join(piAgentDir(), 'models.json'),
  });
  return runtimePromise;
}

export interface OpenSessionInput {
  cwd: string;
  /** 已有会话文件；缺省新建。 */
  file?: string;
  provider: StoredLlmProvider;
  /** 追加到 Pi 默认系统提示之后（项目背景、用户自定义指令、dela 命令说明）。 */
  appendSystemPrompt: string[];
  customTools: ToolDefinition[];
  /** Git Bash 路径（与终端同源）。 */
  shellPath: string;
  /** bash 每条命令前置的脚本（dela 函数定义）。远程会话不注入。 */
  commandPrefix?: string;
  /** 额外的 skill 目录（Dela 内置 skills）。 */
  skillPaths: string[];
  disabledSkills: ReadonlySet<string>;
  disabledTools: string[];
}

export async function openPiSession(input: OpenSessionInput): Promise<AgentSession> {
  const pi = await loadPi();
  const runtime = await modelRuntime();
  const { model, thinking } = await resolveModel(input.provider);
  const agentDir = piAgentDir();
  const settingsManager = pi.SettingsManager.inMemory({
    shellPath: input.shellPath,
    shellCommandPrefix: input.commandPrefix,
    defaultTools: ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'],
  });
  const resourceLoader = new pi.DefaultResourceLoader({
    cwd: input.cwd,
    agentDir,
    settingsManager,
    additionalSkillPaths: input.skillPaths,
    appendSystemPrompt: input.appendSystemPrompt,
    skillsOverride: (base) => ({
      ...base,
      skills: base.skills.filter((skill) => !input.disabledSkills.has(skill.name)),
    }),
  });
  await resourceLoader.reload();
  const sessionManager = input.file
    ? pi.SessionManager.open(input.file, piSessionsDir(), input.cwd)
    : pi.SessionManager.create(input.cwd, piSessionsDir());
  const { session } = await pi.createAgentSession({
    cwd: input.cwd,
    agentDir,
    model,
    thinkingLevel: thinking,
    modelRuntime: runtime,
    settingsManager,
    resourceLoader,
    sessionManager,
    customTools: input.customTools,
    excludeTools: input.disabledTools,
  });
  return session;
}

/** 设置页的模型检测：一次无工具的短请求，失败抛出 pi-ai 的错误文案（"<status>: …"）。 */
export async function verifyModel(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  reasoning: boolean;
}): Promise<string> {
  const { completeSimple } = await import('@earendil-works/pi-ai/compat');
  const model: Model<'openai-completions'> = {
    id: input.model,
    name: input.model,
    api: 'openai-completions',
    provider: 'dela-verify',
    baseUrl: input.baseUrl.replace(/\/+$/, ''),
    reasoning: input.reasoning,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: LLM_DEFAULT_CONTEXT_WINDOW,
    maxTokens: 256,
  };
  const reply = await completeSimple(
    model,
    { messages: [{ role: 'user', content: 'Reply with OK.', timestamp: Date.now() }] },
    { apiKey: input.apiKey, maxTokens: 256, signal: AbortSignal.timeout(30000) },
  );
  if (reply.stopReason === 'error') throw new Error(reply.errorMessage ?? '请求失败');
  return reply.content
    .map((block) =>
      block.type === 'text' ? block.text : block.type === 'thinking' ? block.thinking : '',
    )
    .join('');
}
