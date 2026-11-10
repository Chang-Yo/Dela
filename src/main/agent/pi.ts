/** Pi Coding Agent 接线：内核就是 pi-coding-agent SDK；这里只做加载、提供商注册与按 cwd 建会话，工具与会话树仍归 Pi。 */
import { app } from 'electron';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import type {
  AgentSession,
  FileEntry,
  SessionManager,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import type { Api, Model } from '@earendil-works/pi-ai';
import type { StoredLlmProvider } from '../credentials';
import type { LlmCatalogProvider } from '../../shared/llm';
import {
  llmModelSettings,
  LLM_DEFAULT_CONTEXT_WINDOW,
  LLM_DEFAULT_OUTPUT_TOKENS,
} from '../../shared/llm-models';

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

function piSessionsDir(): string {
  return join(piAgentDir(), 'sessions');
}

/** 每个 Dela 提供商注册成独立的 Pi 提供商：鉴权按名字查，共用一个名字时各会话的地址与密钥会互相覆盖。 */
const piProviderName = (provider: StoredLlmProvider) => `dela-${provider.id}`;

/** 会话的模型选择：提供商连同其中的一个模型与推理档位。 */
export interface SessionModel {
  provider: StoredLlmProvider;
  model: string;
  effort: string | null;
}

/** Dela 档位 → Pi ThinkingLevel；超出 Pi 档位集的扩展档位挂到最高档。 */
function thinkingLevel(effort: string | undefined) {
  if (!effort || effort === 'none') return 'off' as const;
  const known = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
  return (known as readonly string[]).includes(effort)
    ? (effort as (typeof known)[number])
    : ('max' as const);
}

type Runtime = Awaited<ReturnType<Sdk['ModelRuntime']['create']>>;

// 需要云账号、订阅登录或 Pi 自家网关，只凭 API Key 接不进来。
const unofferedProviders = new Set(['amazon-bedrock', 'github-copilot', 'radius']);

/** Pi 目录中只凭 API Key 就能接入的厂商；地址带 {占位} 的要另配账号，不提供。 */
function offeredProviders(runtime: Runtime) {
  return runtime.getProviders().flatMap((provider) => {
    const models = runtime.getModels(provider.id);
    const offered =
      !unofferedProviders.has(provider.id) &&
      provider.auth.apiKey !== undefined &&
      models.length > 0 &&
      models.every(({ baseUrl }) => baseUrl && !baseUrl.includes('{'));
    return offered ? [{ provider, models }] : [];
  });
}

export async function llmCatalog(): Promise<LlmCatalogProvider[]> {
  const runtime = await modelRuntime();
  void runtime.refresh({ allowNetwork: true }).catch(() => undefined);
  const { getSupportedThinkingLevels } = await import('@earendil-works/pi-ai');
  return offeredProviders(runtime).map(({ provider, models }) => ({
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl ?? models[0]!.baseUrl,
    models: models.map((model) => ({
      id: model.id,
      name: model.name,
      contextWindow: model.contextWindow,
      maxOutputTokens: model.maxTokens,
      vision: model.input.includes('image'),
      effortLevels: model.reasoning
        ? getSupportedThinkingLevels(model).map((level) => (level === 'off' ? 'none' : level))
        : [],
    })),
  }));
}

/** 内置厂商直接沿用目录里的模型（协议、地址、兼容参数、请求头都随目录走），只换成用户的密钥。 */
function builtinProviderConfig(runtime: Runtime, provider: StoredLlmProvider, piProvider: string) {
  return {
    name: provider.name,
    apiKey: provider.apiKey,
    models: provider.models.flatMap((id) => runtime.getModel(piProvider, id) ?? []),
  };
}

function customProviderConfig(provider: StoredLlmProvider) {
  return {
    name: provider.name,
    baseUrl: provider.baseUrl.replace(/\/+$/, ''),
    api: 'openai-completions' as const,
    apiKey: provider.apiKey,
    models: provider.models.map((id) => {
      const model = llmModelSettings(provider, id);
      return {
        id,
        name: id,
        reasoning: model.effortLevels.length > 0,
        input: model.vision ? ['text' as const, 'image' as const] : ['text' as const],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: model.contextWindow ?? LLM_DEFAULT_CONTEXT_WINDOW,
        maxTokens: model.maxOutputTokens ?? LLM_DEFAULT_OUTPUT_TOKENS,
        // 开推理后 Pi 会把指令写成 OpenAI 专有的 developer 角色，多数兼容服务只认 system。
        compat: { supportsDeveloperRole: false },
      };
    }),
  };
}

/** 注册时 Pi 会重组提供商并刷新快照；配置没变就跳过。 */
const registeredConfigs = new Map<string, string>();

/** 把会话选中的提供商注册成 Pi 的提供商，返回其中的模型与思考档位。 */
export async function resolveModel({ provider, model: modelId, effort }: SessionModel) {
  const runtime = await modelRuntime();
  const name = piProviderName(provider);
  const config = provider.piProvider
    ? builtinProviderConfig(runtime, provider, provider.piProvider)
    : customProviderConfig(provider);
  const serialized = JSON.stringify(config);
  if (registeredConfigs.get(name) !== serialized) {
    runtime.registerProvider(name, config);
    registeredConfigs.set(name, serialized);
  }
  const model = runtime.getModel(name, modelId);
  if (!model)
    throw new Error(
      provider.piProvider
        ? '模型已不在该厂商的目录中，请在设置中另选模型'
        : '模型不在当前提供商的模型列表中',
    );
  return {
    model,
    thinking: model.reasoning ? thinkingLevel(effort ?? undefined) : ('off' as const),
  };
}

let runtimePromise: Promise<Runtime> | undefined;
async function modelRuntime() {
  const pi = await loadPi();
  runtimePromise ??= pi.ModelRuntime.create({
    authPath: join(piAgentDir(), 'auth.json'),
    modelsPath: join(piAgentDir(), 'models.json'),
    // 不等网络：先用随包目录与上次缓存，pi.dev 的更新在后台拉取（4 小时一次）。
    allowModelNetwork: true,
    refreshOnCreate: false,
  }).then(async (runtime) => {
    await runtime.refresh({ allowNetwork: false });
    void runtime.refresh({ allowNetwork: true }).catch(() => undefined);
    return runtime;
  });
  return runtimePromise;
}

/** path 是否在 dir 里面（不含 dir 本身）。 */
export function isInside(path: string, dir: string): boolean {
  const rest = relative(resolve(dir), resolve(path));
  return rest !== '' && !rest.startsWith('..') && !isAbsolute(rest);
}

/** Pi 还会加载项目里的 .pi/skills；Dela 的项目 Skill 只认 .agents/skills。 */
export function isPiProjectSkill(path: string, cwd: string): boolean {
  return isInside(path, join(cwd, '.pi', 'skills'));
}

export interface OpenSessionInput {
  cwd: string;
  file?: string;
  /** 旁问：不落盘的会话记录，带着主会话的历史。 */
  inMemory?: SessionManager;
  /** 子 Agent：新建的会话文件在 header 里记下父会话的文件。 */
  parentSession?: string;
  selection: SessionModel;
  /** 追加到 Pi 默认系统提示之后（项目背景、用户自定义指令、dela 命令说明）。 */
  appendSystemPrompt: string[];
  customTools: ToolDefinition[];
  /** 平台 Bash 路径（与终端同源）。 */
  shellPath: string;
  /** bash 每条命令前置的脚本（dela 函数定义）。远程会话不注入。 */
  commandPrefix?: string;
  skillPaths: string[];
  /** 远端会话用：Pi 在本机读不到 AGENTS.md（cwd 是远端路径），由调用方注入远端内容。 */
  agentsFilesOverride?: (base: { agentsFiles: { path: string; content: string }[] }) => {
    agentsFiles: { path: string; content: string }[];
  };
  disabledSkills: ReadonlySet<string>;
  /** 按 SKILL.md 绝对路径停用的项目 Skill，同名的互不影响。 */
  disabledSkillPaths?: ReadonlySet<string>;
  /** 这些目录里的 Skill 按名称开关，其余按路径；Pi 此时还没贴来源标签。 */
  globalSkillDirs: string[];
  disabledTools: string[];
}

export async function openPiSession(input: OpenSessionInput): Promise<AgentSession> {
  const pi = await loadPi();
  const runtime = await modelRuntime();
  const { model, thinking } = await resolveModel(input.selection);
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
    // Pi 是私有引擎：项目里的 .pi/extensions、.pi/prompts 与主题一律不加载。
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
    additionalSkillPaths: input.skillPaths,
    appendSystemPrompt: input.appendSystemPrompt,
    ...(input.agentsFilesOverride ? { agentsFilesOverride: input.agentsFilesOverride } : {}),
    skillsOverride: (base) => ({
      ...base,
      skills: base.skills.filter((skill) => {
        const path = resolve(skill.filePath);
        if (isPiProjectSkill(path, input.cwd)) return false;
        return input.globalSkillDirs.some((dir) => isInside(path, dir))
          ? !input.disabledSkills.has(skill.name)
          : !input.disabledSkillPaths?.has(path);
      }),
    }),
  });
  await resourceLoader.reload();
  const sessionManager =
    input.inMemory ??
    (input.file
      ? pi.SessionManager.open(input.file, piSessionsDir(), input.cwd)
      : pi.SessionManager.create(
          input.cwd,
          piSessionsDir(),
          input.parentSession ? { parentSession: input.parentSession } : undefined,
        ));
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

/** 从会话文件的某个条目分出新会话文件：另开实例去分，原文件与正在用它的会话都不受影响。 */
export async function forkSessionFile(file: string, cwd: string, entryId: string): Promise<string> {
  const pi = await loadPi();
  const forked = pi.SessionManager.open(file, piSessionsDir(), cwd).createBranchedSession(entryId);
  if (!forked) throw new Error('分支会话没有写出文件');
  return forked;
}

/** 内存里的会话记录写成会话文件（文件名同 Pi 自己的命名），返回路径。 */
export function writeSessionFile(header: FileEntry & { type: 'session' }, entries: FileEntry[]) {
  const file = join(
    piSessionsDir(),
    `${header.timestamp.replace(/[:.]/g, '-')}_${header.id}.jsonl`,
  );
  writeFileSync(
    file,
    [header, ...entries]
      .map(
        (entry) => `${JSON.stringify(entry)}
`,
      )
      .join(''),
    {
      flag: 'wx',
    },
  );
  return file;
}

/** 设置页的模型检测：一次无工具的短请求，失败抛出 pi-ai 的错误文案（"<status>: …"）。 */
export async function verifyModel(input: {
  piProvider: string | null;
  baseUrl: string;
  apiKey: string;
  model: string;
  reasoning: boolean;
}): Promise<string> {
  const { completeSimple } = await import('@earendil-works/pi-ai/compat');
  const model: Model<Api> | undefined = input.piProvider
    ? (await modelRuntime()).getModel(input.piProvider, input.model)
    : {
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
  if (!model) throw new Error('模型不在该厂商的目录中');
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
