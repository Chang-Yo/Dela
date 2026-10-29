import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { LlmProviderView, LlmVerifyResult } from '../../shared/api';
import {
  LLM_MODEL_LIMIT,
  LLM_DEFAULT_CONTEXT_WINDOW,
  LLM_DEFAULT_OUTPUT_TOKENS,
  llmModelSettings,
  reasoningEffortLevels,
} from '../../shared/llm-presets';
import { verifyModel } from './pi';
import {
  CredentialDecryptionError,
  loadLlmConfig,
  saveLlmConfig,
  type StoredLlmConfig,
  type StoredLlmProvider,
} from '../credentials';

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
    vision: z.boolean().optional(),
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
    modelConfigs: z.record(modelIdSchema, modelSettingsSchema).optional(),
    presetId: z.string().max(64).nullable().optional(),
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

function viewOf(provider: StoredLlmProvider): LlmProviderView {
  return {
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    models: provider.models,
    ...(provider.modelConfigs
      ? {
          modelConfigs: Object.fromEntries(
            provider.models.map((id) => [id, llmModelSettings(provider, id)]),
          ),
        }
      : {}),
    presetId: provider.presetId,
    enabled: provider.enabled,
  };
}

export function listLlmProviders(): LlmProviderView[] {
  return loadLlmConfig().providers.map(viewOf);
}

export function llmProviders(): StoredLlmProvider[] {
  return loadLlmConfig().providers;
}

/** 可供会话选用的提供商：启用且持有密钥。 */
export function usableLlmProviders(providers = llmProviders()): StoredLlmProvider[] {
  return providers.filter(({ enabled, apiKey }) => enabled && apiKey);
}

export function saveLlmProvider(input: unknown): LlmProviderView {
  const parsed = saveInputSchema.parse(input);
  const baseUrl = parsed.baseUrl.replace(/\/+$/, '');
  const presetId = parsed.presetId ?? null;
  let config: StoredLlmConfig;
  try {
    config = loadLlmConfig();
  } catch (cause) {
    // 添加提供商可重新建立失效配置；编辑已有提供商仍需能读到原配置，不能伪造其内容。
    if (parsed.id || !(cause instanceof CredentialDecryptionError)) throw cause;
    config = { providers: [] };
  }
  let provider: StoredLlmProvider | undefined;
  if (parsed.id) {
    provider = config.providers.find(({ id }) => id === parsed.id);
    if (!provider) throw new Error('要编辑的提供商不存在');
    Object.assign(provider, {
      name: parsed.name,
      baseUrl,
      models: parsed.models,
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
      presetId,
      enabled: true,
    };
    config.providers.push(provider);
  }
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
  return viewOf(provider);
}

export function removeLlmProvider(id: string): void {
  const providerId = idSchema.parse(id);
  const config = loadLlmConfig();
  const providers = config.providers.filter(({ id }) => id !== providerId);
  if (providers.length === config.providers.length) return;
  saveLlmConfig({ providers });
}

export function setLlmProviderEnabled(id: string, enabled: boolean): void {
  const providerId = idSchema.parse(id);
  const config = loadLlmConfig();
  const provider = config.providers.find(({ id }) => id === providerId);
  if (!provider) throw new Error('提供商不存在');
  provider.enabled = enabled;
  saveLlmConfig(config);
}

/** 模型列表端点候选，并带上该候选对应的 OpenAI 兼容根地址：对话端点与模型列表同前缀，
 *  所以「哪个 /models 应答了」就决定了实际该用哪个根地址发对话请求。 */
export function modelListEndpoints(baseUrl: string): { models: string; apiBase: string }[] {
  const base = baseUrl.replace(/\/+$/, '');
  return /\/v\d+$/.test(base)
    ? [{ models: `${base}/models`, apiBase: base }]
    : [
        { models: `${base}/v1/models`, apiBase: `${base}/v1` },
        { models: `${base}/models`, apiBase: base },
      ];
}

/** 兼容 OpenAI {data:[{id}]}、智谱 {models:[{slug}]} 与裸数组三种模型列表形态。
 *  形态不符返回 null 而非空列表：网关常把控制台首页以 200 返回，那不是「没有模型」，
 *  而是「这个地址不是 API 根」，必须继续试下一个候选。 */
export function parseModelList(payload: unknown): string[] | null {
  const source = Array.isArray(payload)
    ? payload
    : typeof payload === 'object' && payload !== null
      ? ((payload as { data?: unknown; models?: unknown }).data ??
        (payload as { models?: unknown }).models)
      : undefined;
  if (!Array.isArray(source)) return null;
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

/** 两种检测共用：留空沿用该提供商已存的密钥。 */
function verificationConnection(input: {
  id?: string;
  baseUrl: string;
  apiKey?: string;
}): { baseUrl: string; key: string } | { ok: false; message: string } {
  const parsed = z
    .object({ id: idSchema.optional(), baseUrl: baseUrlSchema, apiKey: apiKeySchema.optional() })
    .parse(input);
  let key = parsed.apiKey?.trim() ?? '';
  if (!key && parsed.id) {
    key = loadLlmConfig().providers.find(({ id }) => id === parsed.id)?.apiKey ?? '';
  }
  if (!key) return { ok: false, message: '请先填写 API Key' };
  return { baseUrl: parsed.baseUrl, key };
}

/** 只做一次 GET：401/403 视为密钥无效，成功时顺带取回模型列表。 */
export async function verifyLlm(input: {
  id?: string;
  baseUrl: string;
  apiKey?: string;
}): Promise<LlmVerifyResult> {
  const connection = verificationConnection(input);
  if ('ok' in connection) return connection;
  const { baseUrl, key } = connection;
  const typed = baseUrl.replace(/\/+$/, '');
  let unreachable = false;
  for (const { models: url, apiBase } of modelListEndpoints(baseUrl)) {
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
        const models = parseModelList(await response.json().catch(() => null));
        if (models) {
          return {
            ok: true,
            message: models.length ? `连接成功，发现 ${models.length} 个模型` : '连接成功',
            models,
            // 应答的那个端点前缀才是真实 API 根，回传给表单校正。
            ...(apiBase !== typed ? { baseUrl: apiBase } : {}),
          };
        }
      }
    } catch {
      unreachable = true;
    }
  }
  return {
    ok: false,
    message: unreachable
      ? '无法连接模型服务，请检查 API 地址和网络'
      : '该地址没有返回模型列表，请检查 API 地址（OpenAI 兼容服务通常要以 /v1 结尾）',
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
  // 裸源地址先按模型列表端点探出真实 API 根：对话端点与它同前缀，不校正会打到网关首页上。
  const typed = connection.baseUrl.replace(/\/+$/, '');
  const corrected = /\/v\d+$/.test(typed)
    ? undefined
    : (await verifyLlm({ baseUrl: typed, apiKey: connection.key })).baseUrl;
  const correction = corrected ? { baseUrl: corrected } : {};
  const settings = parsed.settings ?? {};
  const effortLevels = settings.effortLevels ?? [];
  const effort = settings.effort ?? effortLevels[0];
  try {
    const text = await verifyModel({
      baseUrl: corrected ?? typed,
      apiKey: connection.key,
      model: parsed.model,
      reasoning: Boolean(effort && effort !== 'none'),
    });
    return text.trim()
      ? { ok: true, message: '模型可用', ...correction }
      : { ok: false, message: '请求完成但未返回内容，可用性待确认', ...correction };
  } catch (cause) {
    // 不回显上游报文，避免服务将认证头或其他敏感数据拼进错误。
    const message = cause instanceof Error ? cause.message : '';
    const status = /^\s*(\d{3})/.exec(message)?.[1];
    return {
      ok: false,
      message: status
        ? `模型检测失败（HTTP ${status}）`
        : '模型检测失败，请检查模型 ID、权限、配置和网络',
      ...correction,
    };
  }
}
