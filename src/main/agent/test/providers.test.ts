import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CredentialDecryptionError,
  loadLlmConfig,
  saveLlmConfig,
  type StoredLlmConfig,
} from '../../credentials';
import {
  listLlmProviders,
  modelListEndpoints,
  parseModelList,
  removeLlmProvider,
  saveLlmProvider,
  setLlmProviderEnabled,
  usableLlmProviders,
  verifyLlm,
  verifyLlmModel,
} from '../providers';
import { MockOpenAiServer, mockFrames } from './mock-openai-server';

vi.mock('../../credentials', () => ({
  CredentialDecryptionError: class extends Error {},
  loadLlmConfig: vi.fn(),
  saveLlmConfig: vi.fn(),
}));

const loadMock = vi.mocked(loadLlmConfig);
const saveMock = vi.mocked(saveLlmConfig);

let config: StoredLlmConfig;

beforeEach(() => {
  config = { providers: [] };
  loadMock.mockImplementation(() => config);
  saveMock.mockImplementation((next) => {
    config = next;
  });
});

afterEach(() => vi.unstubAllGlobals());

it('detects actual model output over the same streaming API as chat', async () => {
  const server = await MockOpenAiServer.start();
  try {
    server.enqueue({
      kind: 'sse',
      frames: [mockFrames.textDelta('OK'), mockFrames.finishFrame('stop')],
    });
    expect(
      await verifyLlmModel({ baseUrl: server.baseUrl, apiKey: 'test-only', model: 'test-model' }),
    ).toEqual({ ok: true, message: '模型可用' });
    expect(server.requests[0]?.url).toBe('/v1/chat/completions');
    expect(server.requests[0]?.body).toMatchObject({
      model: 'test-model',
      max_completion_tokens: 256,
    });
    server.enqueue({
      kind: 'status',
      status: 403,
      json: { error: { message: 'private-upstream-message' } },
    });
    const failure = await verifyLlmModel({
      baseUrl: server.baseUrl,
      apiKey: 'test-only',
      model: 'forbidden',
    });
    expect(failure.ok).toBe(false);
    expect(failure.message).not.toContain('private-upstream-message');
  } finally {
    await server.close();
  }
});

it('reuses the stored key for a model probe at any address', async () => {
  const created = saveLlmProvider(input);
  const fetcher = vi.fn().mockRejectedValue(new TypeError('network'));
  vi.stubGlobal('fetch', fetcher);
  const result = await verifyLlmModel({
    id: created.id,
    baseUrl: 'https://other.example',
    model: 'deepseek-v4-pro',
  });
  expect(result.ok).toBe(false);
  expect(fetcher.mock.calls[0]![1]!.headers).toEqual({ Authorization: 'Bearer test-only' });
});

const input = {
  name: 'DeepSeek',
  baseUrl: 'https://api.deepseek.com',
  apiKey: 'test-only',
  models: ['deepseek-v4-pro', 'deepseek-flash'],
  presetId: 'deepseek',
};

describe('LLM provider config', () => {
  it('stores per-model limits and reasoning levels', () => {
    const created = saveLlmProvider({
      ...input,
      modelConfigs: {
        'deepseek-v4-pro': {
          contextWindow: 1000000,
          maxOutputTokens: 128000,
          effortLevels: ['high', 'max'],
          effort: 'max',
        },
        'deepseek-flash': { effortLevels: [] },
      },
    });
    expect(created.modelConfigs?.['deepseek-v4-pro']?.contextWindow).toBe(1000000);
    expect(created.modelConfigs?.['deepseek-v4-pro']?.effortLevels).toEqual(['high', 'max']);
    expect(created.modelConfigs?.['deepseek-flash']?.effortLevels).toEqual([]);
  });

  it('rejects invalid model limits and settings for models outside the list', () => {
    expect(() =>
      saveLlmProvider({
        ...input,
        modelConfigs: { 'deepseek-v4-pro': { maxOutputTokens: 512000 } },
      }),
    ).toThrow();
    expect(() =>
      saveLlmProvider({ ...input, modelConfigs: { 'deepseek-v4-pro': { contextWindow: 8192 } } }),
    ).toThrow();
    expect(() =>
      saveLlmProvider({ ...input, modelConfigs: { 'deepseek-v4-pro': { contextWindow: -1 } } }),
    ).toThrow();
    expect(() =>
      saveLlmProvider({
        ...input,
        modelConfigs: { 'deepseek-v4-pro': { contextWindow: 1000, maxOutputTokens: 2000 } },
      }),
    ).toThrow();
    expect(() =>
      saveLlmProvider({ ...input, modelConfigs: { unknown: { contextWindow: 1000000 } } }),
    ).toThrow('模型配置必须属于模型列表');
  });
  it('accepts a new server while keeping the stored key', () => {
    const created = saveLlmProvider(input);
    const saved = saveLlmProvider({
      ...input,
      id: created.id,
      baseUrl: 'https://other.example/v1',
      apiKey: undefined,
    });
    expect(saved.baseUrl).toBe('https://other.example/v1');
    expect(config.providers[0]?.apiKey).toBe('test-only');
  });

  it('allows changing the endpoint with an explicitly supplied key', () => {
    const created = saveLlmProvider(input);
    const saved = saveLlmProvider({
      ...input,
      id: created.id,
      baseUrl: 'https://other.example',
      apiKey: 'new-test-key',
    });
    expect(saved.baseUrl).toBe('https://other.example');
    expect(config.providers[0]?.apiKey).toBe('new-test-key');
  });

  it('can add a provider after the old encrypted config becomes unreadable', () => {
    loadMock.mockImplementation(() => {
      throw new CredentialDecryptionError('unreadable', undefined);
    });
    expect(saveLlmProvider(input).name).toBe(input.name);
    expect(config.providers).toHaveLength(1);
    expect(config.providers[0]!.apiKey).toBe(input.apiKey);
  });

  it('does not replace an unreadable config when editing an existing provider', () => {
    loadMock.mockImplementation(() => {
      throw new CredentialDecryptionError('unreadable', undefined);
    });
    const writes = saveMock.mock.calls.length;
    expect(() => saveLlmProvider({ ...input, id: '00000000-0000-4000-8000-000000000001' })).toThrow(
      'unreadable',
    );
    expect(saveMock.mock.calls).toHaveLength(writes);
  });

  it('does not treat unrelated read failures as an empty config', () => {
    loadMock.mockImplementation(() => {
      throw new Error('EACCES');
    });
    expect(() => saveLlmProvider(input)).toThrow('EACCES');
  });
  it('saves a new provider with a generated id and returns the masked view', () => {
    const view = saveLlmProvider(input);
    expect(view).toEqual({
      id: view.id,
      name: input.name,
      baseUrl: input.baseUrl,
      models: input.models,
      presetId: input.presetId,
      enabled: true,
    });
    expect('apiKey' in view).toBe(false);
    expect(config.providers[0]!.apiKey).toBe('test-only');
  });

  it('normalizes model effort levels and rejects unknown levels', () => {
    const model = 'deepseek-v4-pro';
    const view = saveLlmProvider({
      ...input,
      modelConfigs: { [model]: { effortLevels: ['ultra', 'low', 'low', 'none'] } },
    });
    expect(view.modelConfigs?.[model]?.effortLevels).toEqual(['none', 'low', 'ultra']);
    expect(() =>
      saveLlmProvider({ ...input, modelConfigs: { [model]: { effortLevels: ['turbo'] } } }),
    ).toThrow();
  });

  it('keeps the stored key when editing with an empty apiKey', () => {
    const created = saveLlmProvider(input);
    saveLlmProvider({ ...input, id: created.id, apiKey: '', name: 'DeepSeek 备用' });
    expect(config.providers[0]!.apiKey).toBe('test-only');
    expect(config.providers[0]!.name).toBe('DeepSeek 备用');
  });

  it('offers only enabled providers with a key to sessions, keeping disabled ones configured', () => {
    const created = saveLlmProvider(input);
    setLlmProviderEnabled(created.id, false);
    expect(usableLlmProviders()).toEqual([]);
    expect(listLlmProviders()[0]!.enabled).toBe(false);
    setLlmProviderEnabled(created.id, true);
    expect(usableLlmProviders().map(({ id }) => id)).toEqual([created.id]);
    expect(() => setLlmProviderEnabled('00000000-0000-4000-8000-000000000000', true)).toThrow();
    removeLlmProvider(created.id);
    expect(config.providers).toHaveLength(0);
  });
});

describe('model list endpoints', () => {
  it('appends /models when the base already ends with a version segment', () => {
    expect(modelListEndpoints('https://api.minimaxi.com/v1')).toEqual([
      { models: 'https://api.minimaxi.com/v1/models', apiBase: 'https://api.minimaxi.com/v1' },
    ]);
    expect(modelListEndpoints('https://open.bigmodel.cn/api/coding/paas/v4/')).toEqual([
      {
        models: 'https://open.bigmodel.cn/api/coding/paas/v4/models',
        apiBase: 'https://open.bigmodel.cn/api/coding/paas/v4',
      },
    ]);
  });

  it('tries /v1/models before /models for plain origins', () => {
    expect(modelListEndpoints('https://api.deepseek.com')).toEqual([
      { models: 'https://api.deepseek.com/v1/models', apiBase: 'https://api.deepseek.com/v1' },
      { models: 'https://api.deepseek.com/models', apiBase: 'https://api.deepseek.com' },
    ]);
  });

  it('parses OpenAI, Zhipu and bare-array model lists with dedupe', () => {
    expect(parseModelList({ data: [{ id: 'qwen' }, { id: 'qwen' }, { id: 'minimax' }] })).toEqual([
      'qwen',
      'minimax',
    ]);
    expect(parseModelList({ models: [{ slug: 'glm-5.2' }] })).toEqual(['glm-5.2']);
    expect(parseModelList(['a', { id: 'b' }, 3, null])).toEqual(['a', 'b']);
    expect(parseModelList({ error: { message: 'x' } })).toBeNull();
    expect(parseModelList('<!doctype html>')).toBeNull();
  });
});

describe('verifyLlm', () => {
  const verifyInput = { baseUrl: 'https://api.deepseek.com', apiKey: 'test-only' };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  it('reuses the stored key of a saved provider when apiKey is omitted, at whatever address is given', async () => {
    const created = saveLlmProvider(input);
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ data: [] }))
      .mockResolvedValueOnce(json({ data: [] }));
    vi.stubGlobal('fetch', fetcher);
    const result = await verifyLlm({ id: created.id, baseUrl: input.baseUrl });
    expect(result).toEqual({
      ok: true,
      message: '连接成功',
      models: [],
      baseUrl: `${input.baseUrl}/v1`,
    });
    expect(fetcher.mock.calls[0]![1]!.headers).toEqual({ Authorization: 'Bearer test-only' });
    // 探测目标就是用户刚填的地址，不回写成原存储地址。
    fetcher.mockClear();
    const elsewhere = await verifyLlm({ id: created.id, baseUrl: 'https://gateway.internal/v1' });
    expect(elsewhere.ok).toBe(true);
    expect(fetcher.mock.calls[0]![0]).toBe('https://gateway.internal/v1/models');
    expect(fetcher.mock.calls[0]![1]!.headers).toEqual({ Authorization: 'Bearer test-only' });
  });

  it('allows verification at a new endpoint with an explicit key', async () => {
    const created = saveLlmProvider(input);
    const fetcher = vi.fn().mockResolvedValue(json({ data: [] }));
    vi.stubGlobal('fetch', fetcher);
    expect(
      (
        await verifyLlm({
          id: created.id,
          baseUrl: 'https://other.example',
          apiKey: 'new-test-key',
        })
      ).ok,
    ).toBe(true);
    expect(fetcher.mock.calls[0]![1]!.headers).toEqual({ Authorization: 'Bearer new-test-key' });
  });

  it('reports invalid keys on 401 without trying other candidates', async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ error: {} }, 401));
    vi.stubGlobal('fetch', fetcher);
    const result = await verifyLlm(verifyInput);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('401');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]![1]!.headers).toEqual({ Authorization: 'Bearer test-only' });
  });

  it('falls back to {base}/models when /v1/models is missing', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ error: {} }, 404))
      .mockResolvedValueOnce(json({ data: [{ id: 'deepseek-chat' }] }));
    vi.stubGlobal('fetch', fetcher);
    const result = await verifyLlm(verifyInput);
    expect(result).toEqual({
      ok: true,
      message: '连接成功，发现 1 个模型',
      models: ['deepseek-chat'],
    });
    expect(fetcher.mock.calls[1]![0]).toBe('https://api.deepseek.com/models');
  });

  it('corrects a bare origin to the versioned root that actually serves the API', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ data: [{ id: 'mimo-v2.6-flash' }] })));
    expect(
      await verifyLlm({ baseUrl: 'http://192.168.60.110:13000/', apiKey: 'test-only' }),
    ).toEqual({
      ok: true,
      message: '连接成功，发现 1 个模型',
      models: ['mimo-v2.6-flash'],
      baseUrl: 'http://192.168.60.110:13000/v1',
    });
  });

  it('does not read a gateway HTML page as an empty model list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<!doctype html><title>New API</title>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        }),
      ),
    );
    const result = await verifyLlm(verifyInput);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('/v1');
  });

  it('probes the versioned root before a model request at a bare origin', async () => {
    const server = await MockOpenAiServer.start();
    // 只接管模型列表探测；对话请求仍走真实 fetch 打到 mock 服务。
    const realFetch = globalThis.fetch;
    try {
      const origin = server.baseUrl.replace(/\/v1$/, '');
      server.enqueue({
        kind: 'sse',
        frames: [mockFrames.textDelta('OK'), mockFrames.finishFrame('stop')],
      });
      vi.stubGlobal(
        'fetch',
        vi.fn((...args: Parameters<typeof fetch>) =>
          String(args[0]).endsWith('/v1/models')
            ? Promise.resolve(json({ data: [{ id: 'test-model' }] }))
            : realFetch(...args),
        ),
      );
      const result = await verifyLlmModel({
        baseUrl: origin,
        apiKey: 'test-only',
        model: 'test-model',
      });
      expect(result).toEqual({
        ok: true,
        message: '模型可用',
        baseUrl: `${origin}/v1`,
      });
      expect(server.requests[0]?.url).toBe('/v1/chat/completions');
    } finally {
      vi.unstubAllGlobals();
      await server.close();
    }
  });

  it('requires a key before contacting the endpoint', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const result = await verifyLlm({ baseUrl: input.baseUrl });
    expect(result.ok).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reports unreachable services after all candidates fail', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')));
    const result = await verifyLlm(verifyInput);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('无法连接');
  });
});
