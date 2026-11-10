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

/** 把会话选中的提供商注册成 Pi 的 OpenAI 兼容提供商，返回其中的模型与思考档位。 */
export async function resolveModel({ provider, model: modelId, effort }: SessionModel) {
  const runtime = await modelRuntime();
  const reasoning = llmModelSettings(provider, modelId).effortLevels.length > 0;
  const name = piProviderName(provider);
  runtime.registerProvider(name, {
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
        // 开推理后 Pi 会把指令消息的 role 写成 OpenAI 专有的 developer，而 Dela 的提供商
        // （DeepSeek/智谱/MiniMax/致远与自定义网关）只认 system，会直接 422 invalid_request_error。
        // Pi 的自动识别靠提供商标识或 baseUrl 里的厂商域名，Dela 的提供商名是 dela-<id>，
        // 识别不出来，只能显式关掉；system 是所有 OpenAI 兼容端点都接受的角色。
        compat: { supportsDeveloperRole: false },
      };
    }),
  });
  const model = runtime.getModel(name, modelId) as Model<'openai-completions'> | undefined;
  if (!model) throw new Error('模型不在当前提供商的模型列表中');
  return { model, thinking: reasoning ? thinkingLevel(effort ?? undefined) : ('off' as const) };
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

/** path 是否在 dir 里面（不含 dir 本身）。 */
export function isInside(path: string, dir: string): boolean {
  const rest = relative(resolve(dir), resolve(path));
  return rest !== '' && !rest.startsWith('..') && !isAbsolute(rest);
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
