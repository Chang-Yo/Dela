import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { LlmProviderView, LlmVerifyResult } from '../../../shared/api';
import {
  LLM_MODEL_LIMIT,
  LLM_DEFAULT_CONTEXT_WINDOW,
  LLM_DEFAULT_OUTPUT_TOKENS,
  llmModelSettings,
  reasoningEffortLevels,
} from '../../../shared/llm-presets';
import { runAgent } from './run';
import {
  CredentialDecryptionError,
  loadLlmConfig,
  saveLlmConfig,
  type StoredLlmConfig,
  type StoredLlmProvider,
} from '../../credentials';

const idSchema = z.string().uuid();
const nameSchema = z.string().trim().min(1).max(50);
const baseUrlSchema = z
  .string()
  .trim()
  .max(2000)
  .pipe(z.url({ protocol: /^https?$/ }));
const apiKeySchema = z.string().max(4096);
const modelIdSchema = z.string().trim().min(1).max(200);
const modelsSchema = z.array(modelIdSchema).min(1).max(LLM_MODEL_LIMIT);
const effortLevelsSchema = z.array(z.enum(reasoningEffortLevels)).max(8).optional();
const modelSettingsSchema = z
  .object({
    contextWindow: z.number().int().positive().optional(),
    maxOutputTokens: z.number().int().positive().optional(),
    effortLevels: effortLevelsSchema,
    effort: z.enum(reasoningEffortLevels).optional(),
  })
  .refine(
    (value) =>
      (value.contextWindow === undefined && value.maxOutputTokens === undefined) ||
      (value.maxOutputTokens ?? LLM_DEFAULT_OUTPUT_TOKENS) <
        (value.contextWindow ?? LLM_DEFAULT_CONTEXT_WINDOW),
    {
      message: '最大输出必须小于上下文窗口',
    },
  )
  .refine(
    (value) => !value.effort || !value.effortLevels || value.effortLevels.includes(value.effort),
    {
      message: '默认思考强度必须在模型档位中',
    },
  );

const saveInputSchema = z
  .object({
    id: idSchema.optional(),
    name: nameSchema,
    baseUrl: baseUrlSchema,
    apiKey: apiKeySchema.optional(),
    models: modelsSchema,
    model: modelIdSchema,
    modelConfigs: z.record(modelIdSchema, modelSettingsSchema).optional(),
    effortLevels: effortLevelsSchema,
    presetId: z.string().max(64).nullable().optional(),
  })
  .refine((input) => input.models.includes(input.model), {
    message: '默认模型必须在模型列表中',
  })
  .refine(
    (input) => Object.keys(input.modelConfigs ?? {}).every((id) => input.models.includes(id)),
    {
      message: '模型配置必须属于模型列表',
    },
  );

/** 去重并按固定强度顺序排列，避免多选顺序影响存储与展示。 */
function normalizeEffortLevels(levels: string[] | undefined): string[] {
  if (!levels?.length) return [];
  return reasoningEffortLevels.filter((level) => levels.includes(level));
}

function viewOf(provider: StoredLlmProvider, activeId: string | null): LlmProviderView {
  const { effortLevels, effort } = llmModelSettings(provider);
  return {
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    models: provider.models,
    model: provider.model,
    ...(provider.modelConfigs
      ? {
          modelConfigs: Object.fromEntries(
            provider.models.map((id) => [id, llmModelSettings(provider, id)]),
          ),
        }
      : {}),
    effortLevels,
    effort: effort ?? null,
    presetId: provider.presetId,
    active: provider.id === activeId,
  };
}

export function listLlmProviders(): LlmProviderView[] {
  const config = loadLlmConfig();
  return config.providers.map((provider) => viewOf(provider, config.activeId));
}

/** 当前生效且持有密钥的提供商；agent 请求与 configured 状态的唯一来源。 */
export function getActiveLlmProvider(): StoredLlmProvider | null {
  const config = loadLlmConfig();
  if (!config.activeId) return null;
  const provider = config.providers.find(({ id, apiKey }) => id === config.activeId && apiKey);
  if (!provider) return null;
  const { effortLevels, effort } = llmModelSettings(provider);
  return { ...provider, effortLevels, effort };
}

export function saveLlmProvider(input: unknown): LlmProviderView {
  const parsed = saveInputSchema.parse(input);
  const baseUrl = parsed.baseUrl.replace(/\/+$/, '');
  const presetId = parsed.presetId ?? null;
  const effortLevels = normalizeEffortLevels(parsed.effortLevels);
  let config: StoredLlmConfig;
  try {
    config = loadLlmConfig();
  } catch (cause) {
    // 添加提供商可重新建立失效配置；编辑已有提供商仍需能读到原配置，不能伪造其内容。
    if (parsed.id || !(cause instanceof CredentialDecryptionError)) throw cause;
    config = { providers: [], activeId: null };
  }
  let provider: StoredLlmProvider | undefined;
  if (parsed.id) {
    provider = config.providers.find(({ id }) => id === parsed.id);
    if (!provider) throw new Error('要编辑的提供商不存在');
    if (!parsed.apiKey?.trim() && baseUrl !== provider.baseUrl.replace(/\/+$/, '')) {
      throw new Error('API 地址已更改，请重新填写 API Key');
    }
    Object.assign(provider, {
      name: parsed.name,
      baseUrl,
      models: parsed.models,
      model: parsed.model,
      effortLevels,
      presetId,
    });
    if (parsed.apiKey) provider.apiKey = parsed.apiKey;
  } else {
    if (!parsed.apiKey) throw new Error('请填写 API Key');
    provider = {
      id: randomUUID(),
      name: parsed.name,
      baseUrl,
      apiKey: parsed.apiKey,
      models: parsed.models,
      model: parsed.model,
      effortLevels,
      presetId,
    };
    config.providers.push(provider);
  }
  // 档位变化后收敛当前档位：仍在列表内则保留，否则回到第一档；关闭则清除。
  if (provider.effort && !effortLevels.includes(provider.effort)) provider.effort = undefined;
  if (!provider.effort && effortLevels.length) provider.effort = effortLevels[0];
  if (parsed.modelConfigs) {
    provider.modelConfigs = Object.fromEntries(
      Object.entries(parsed.modelConfigs).map(([id, settings]) => [
        id,
        {
          ...settings,
          ...(settings.effortLevels
            ? { effortLevels: normalizeEffortLevels(settings.effortLevels) }
            : {}),
        },
      ]),
    );
  } else if (provider.modelConfigs) {
    provider.modelConfigs = Object.fromEntries(
      Object.entries(provider.modelConfigs).filter(([id]) => parsed.models.includes(id)),
    );
  }
  saveLlmConfig(config);
  return viewOf(provider, config.activeId);
}

export function removeLlmProvider(id: string): void {
  const providerId = idSchema.parse(id);
  const config = loadLlmConfig();
  const providers = config.providers.filter(({ id }) => id !== providerId);
  if (providers.length === config.providers.length) return;
  saveLlmConfig({
    providers,
    activeId: config.activeId === providerId ? null : config.activeId,
  });
}

export function setActiveLlmProvider(id: string): void {
  const providerId = idSchema.parse(id);
  const config = loadLlmConfig();
  const provider = config.providers.find(({ id, apiKey }) => id === providerId && apiKey);
  if (!provider) throw new Error('提供商不存在或缺少 API Key');
  saveLlmConfig({ ...config, activeId: providerId });
}

export function setLlmModel(model: string): void {
  const parsed = modelIdSchema.parse(model);
  const config: StoredLlmConfig = loadLlmConfig();
  const provider = config.providers.find(({ id, apiKey }) => id === config.activeId && apiKey);
  if (!provider) throw new Error('请先在设置中配置模型服务');
  if (!provider.models.includes(parsed)) throw new Error('模型不在当前提供商的模型列表中');
  provider.model = parsed;
  saveLlmConfig(config);
}

export function setLlmEffort(level: string): void {
  const parsed = z.enum(reasoningEffortLevels).parse(level);
  const config: StoredLlmConfig = loadLlmConfig();
  const provider = config.providers.find(({ id, apiKey }) => id === config.activeId && apiKey);
  if (!provider) throw new Error('请先在设置中配置模型服务');
  const levels = llmModelSettings(provider).effortLevels;
  if (!levels.includes(parsed))
    throw new Error('该档位不在当前提供商开启的推理强度列表中，请先在设置中勾选');
  const settings = provider.modelConfigs?.[provider.model];
  if (settings?.effortLevels) settings.effort = parsed;
  else provider.effort = parsed;
  saveLlmConfig(config);
}

/** 模型列表端点候选：以 /v数字 结尾时直接 {base}/models，否则先试 /v1/models 再 {base}/models。 */
export function modelListEndpoints(baseUrl: string): string[] {
  const base = baseUrl.replace(/\/+$/, '');
  return /\/v\d+$/.test(base) ? [`${base}/models`] : [`${base}/v1/models`, `${base}/models`];
}

/** 兼容 OpenAI {data:[{id}]}、智谱 {models:[{slug}]} 与裸数组三种模型列表形态。 */
export function parseModelList(payload: unknown): string[] {
  const source = Array.isArray(payload)
    ? payload
    : typeof payload === 'object' && payload !== null
      ? ((payload as { data?: unknown; models?: unknown }).data ??
        (payload as { models?: unknown }).models)
      : undefined;
  if (!Array.isArray(source)) return [];
  const ids = source
    .map((item) => {
      if (typeof item === 'string') return item;
      if (typeof item === 'object' && item !== null) {
        const { id, slug } = item as { id?: unknown; slug?: unknown };
        return typeof id === 'string' ? id : typeof slug === 'string' ? slug : '';
      }
      return '';
    })
    .filter((id) => id && id.length <= 200);
  return [...new Set(ids)];
}

const VERIFY_TIMEOUT = 15000;

/** 两种检测共用密钥目标绑定，保证沿用存储密钥时只能访问其原地址。 */
function verificationConnection(input: {
  id?: string;
  baseUrl: string;
  apiKey?: string;
}): { baseUrl: string; key: string } | { ok: false; message: string } {
  const parsed = z
    .object({ id: idSchema.optional(), baseUrl: baseUrlSchema, apiKey: apiKeySchema.optional() })
    .parse(input);
  let key = parsed.apiKey?.trim() ?? '';
  let baseUrl = parsed.baseUrl;
  if (!key && parsed.id) {
    const provider = loadLlmConfig().providers.find(({ id }) => id === parsed.id);
    if (provider) {
      if (baseUrl.replace(/\/+$/, '') !== provider.baseUrl.replace(/\/+$/, '')) {
        return { ok: false, message: 'API 地址已更改，请重新填写 API Key' };
      }
      // 沿用存储密钥时，网络目标也必须来自同一份存储配置。
      baseUrl = provider.baseUrl;
      key = provider.apiKey;
    }
  }
  if (!key) return { ok: false, message: '请先填写 API Key' };
  return { baseUrl, key };
}

/** 轻量密钥检测：GET 模型列表端点，401/403 视为密钥无效，成功时顺带返回模型列表。 */
export async function verifyLlm(input: {
  id?: string;
  baseUrl: string;
  apiKey?: string;
}): Promise<LlmVerifyResult> {
  const connection = verificationConnection(input);
  if ('ok' in connection) return connection;
  const { baseUrl, key } = connection;
  let unreachable = false;
  for (const url of modelListEndpoints(baseUrl)) {
    try {
      const response = await fetch(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(VERIFY_TIMEOUT),
        headers: { Authorization: `Bearer ${key}` },
      });
      if (response.status === 401 || response.status === 403) {
        return { ok: false, message: `密钥无效或无权限（HTTP ${response.status}）` };
      }
      if (response.ok) {
        const models = parseModelList(await response.json());
        return {
          ok: true,
          message: models.length ? `连接成功，发现 ${models.length} 个模型` : '连接成功',
          models,
        };
      }
    } catch {
      unreachable = true;
    }
  }
  return {
    ok: false,
    message: unreachable
      ? '无法连接模型服务，请检查 API 地址和网络'
      : '该服务未提供模型列表接口，无法确认密钥有效性',
  };
}

/** 使用同一 Pi 请求链发出无工具的短请求；不创建会话，不保存回复。 */
export async function verifyLlmModel(input: unknown): Promise<LlmVerifyResult> {
  const parsed = z
    .object({
      id: idSchema.optional(),
      baseUrl: baseUrlSchema,
      apiKey: apiKeySchema.optional(),
      model: modelIdSchema,
      settings: modelSettingsSchema.optional(),
    })
    .parse(input);
  const connection = verificationConnection(parsed);
  if ('ok' in connection) return connection;
  const settings = parsed.settings ?? {};
  const effortLevels = settings.effortLevels ?? [];
  const effort = settings.effort ?? effortLevels[0];
  let receivedOutput = false;
  try {
    const result = await runAgent({
      baseUrl: connection.baseUrl,
      model: parsed.model,
      key: connection.key,
      effort,
      modelSettings: {
        ...settings,
        maxOutputTokens: Math.min(settings.maxOutputTokens ?? 256, 256),
      },
      messages: [{ role: 'user', content: 'Reply with OK.' }],
      tools: [],
      signal: AbortSignal.timeout(30000),
      retryDelays: [],
      execute: async () => {
        throw new Error('检测不支持工具调用');
      },
      onReasoning: (text) => {
        receivedOutput ||= Boolean(text.trim());
      },
    });
    return result.content.trim() || receivedOutput
      ? { ok: true, message: '模型可用' }
      : { ok: false, message: '请求完成但未返回内容，可用性待确认' };
  } catch (cause) {
    // 不回显上游报文，避免服务将认证头或其他敏感数据拼进错误。
    const message = cause instanceof Error ? cause.message : '';
    const status = /HTTP (\d{3})/.exec(message)?.[1];
    return {
      ok: false,
      message: status
        ? `模型检测失败（HTTP ${status}）`
        : '模型检测失败，请检查模型 ID、权限、配置和网络',
    };
  }
}
