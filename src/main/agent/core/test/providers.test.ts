import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CredentialDecryptionError,
  loadLlmConfig,
  saveLlmConfig,
  type StoredLlmConfig,
} from '../../../credentials';
import {
  listLlmProviders,
  modelListEndpoints,
  parseModelList,
  removeLlmProvider,
  saveLlmProvider,
  setActiveLlmProvider,
  setLlmEffort,
  setLlmModel,
  verifyLlm,
  verifyLlmModel,
} from '../providers';
import { MockOpenAiServer, mockFrames } from './mock-openai-server';

vi.mock('../../../credentials', () => ({
  CredentialDecryptionError: class extends Error {},
  loadLlmConfig: vi.fn(),
  saveLlmConfig: vi.fn(),
}));

const loadMock = vi.mocked(loadLlmConfig);
const saveMock = vi.mocked(saveLlmConfig);

let config: StoredLlmConfig;

beforeEach(() => {
  config = { providers: [], activeId: null };
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

it('does not send a stored key to a changed address during a model probe', async () => {
  const created = saveLlmProvider(input);
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  expect(
    (await verifyLlmModel({ id: created.id, baseUrl: 'https://other.example', model: input.model }))
      .ok,
  ).toBe(false);
  expect(fetcher).not.toHaveBeenCalled();
});

const input = {
  name: 'DeepSeek',
  baseUrl: 'https://api.deepseek.com',
  apiKey: 'test-only',
  models: ['deepseek-v4-pro', 'deepseek-flash'],
  model: 'deepseek-v4-pro',
  presetId: 'deepseek',
};

describe('LLM provider config', () => {
  it('stores per-model limits and switches to that model’s own reasoning levels', () => {
    const created = saveLlmProvider({
      ...input,
      effortLevels: ['low'],
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
    expect(created.effortLevels).toEqual(['high', 'max']);
    setActiveLlmProvider(created.id);
    setLlmModel('deepseek-flash');
    expect(listLlmProviders()[0]?.effortLevels).toEqual([]);
    expect(() => setLlmEffort('low')).toThrow();
    setLlmModel('deepseek-v4-pro');
    setLlmEffort('high');
    expect(listLlmProviders()[0]?.effort).toBe('high');
    expect(config.providers[0]?.modelConfigs?.['deepseek-v4-pro']?.effort).toBe('high');
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
  it('rejects changing the endpoint while reusing the stored key', () => {
    const created = saveLlmProvider(input);
    expect(() =>
      saveLlmProvider({
        ...input,
        id: created.id,
        baseUrl: 'https://other.example',
        apiKey: undefined,
      }),
    ).toThrow('API 地址');
    expect(listLlmProviders()[0]?.baseUrl).toBe(input.baseUrl);
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
      model: input.model,
      effortLevels: [],
      effort: null,
      presetId: input.presetId,
      active: false,
    });
    expect('apiKey' in view).toBe(false);
    expect(config.providers[0]!.apiKey).toBe('test-only');
  });

  it('normalizes effort levels to the canonical order and defaults the effort to the first', () => {
    const view = saveLlmProvider({
      ...input,
      effortLevels: ['ultra', 'low', 'low', 'none'],
    });
    expect(view.effortLevels).toEqual(['none', 'low', 'ultra']);
    expect(view.effort).toBe('none');
    expect(listLlmProviders()[0]!.effort).toBe('none');
  });

  it('rejects effort levels outside the enum', () => {
    expect(() => saveLlmProvider({ ...input, effortLevels: ['turbo'] })).toThrow();
  });

  it('keeps a still-listed effort when editing and resets it when its level is removed', () => {
    const created = saveLlmProvider({ ...input, effortLevels: ['low', 'high'] });
    setActiveLlmProvider(created.id);
    setLlmEffort('high');
    // 仍在列表内：编辑保留当前档位。
    saveLlmProvider({ ...input, id: created.id, apiKey: '', effortLevels: ['low', 'high'] });
    expect(listLlmProviders()[0]!.effort).toBe('high');
    // high 被移出列表：回到第一档。
    saveLlmProvider({ ...input, id: created.id, apiKey: '', effortLevels: ['medium'] });
    const view = listLlmProviders()[0]!;
    expect(view.effortLevels).toEqual(['medium']);
    expect(view.effort).toBe('medium');
    // 关闭（空列表）：清除档位，composer 回到 default。
    saveLlmProvider({ ...input, id: created.id, apiKey: '', effortLevels: [] });
    expect(listLlmProviders()[0]!.effort).toBeNull();
  });

  it('switches the effort only within the enabled levels of the active provider', () => {
    const created = saveLlmProvider({ ...input, effortLevels: ['low', 'high'] });
    setActiveLlmProvider(created.id);
    setLlmEffort('high');
    expect(listLlmProviders()[0]!.effort).toBe('high');
    expect(() => setLlmEffort('max')).toThrow(/不在当前提供商开启/);
    expect(() => setLlmEffort('extreme')).toThrow();
  });

  it('keeps the stored key when editing with an empty apiKey', () => {
    const created = saveLlmProvider(input);
    saveLlmProvider({ ...input, id: created.id, apiKey: '', name: 'DeepSeek 备用' });
    expect(config.providers[0]!.apiKey).toBe('test-only');
    expect(config.providers[0]!.name).toBe('DeepSeek 备用');
  });

  it('rejects a default model outside the model list', () => {
    expect(() => saveLlmProvider({ ...input, model: 'unknown-model' })).toThrow();
  });

  it('switches the active provider and refuses unknown ids', () => {
    const created = saveLlmProvider(input);
    setActiveLlmProvider(created.id);
    expect(listLlmProviders()[0]!.active).toBe(true);
    expect(() => setActiveLlmProvider('00000000-0000-4000-8000-000000000000')).toThrow();
  });

  it('clears the active id when removing the active provider', () => {
    const created = saveLlmProvider(input);
    setActiveLlmProvider(created.id);
    removeLlmProvider(created.id);
    expect(config.providers).toHaveLength(0);
    expect(config.activeId).toBeNull();
  });

  it('switches models only within the active provider list', () => {
    const created = saveLlmProvider(input);
    setActiveLlmProvider(created.id);
    setLlmModel('deepseek-flash');
    expect(config.providers[0]!.model).toBe('deepseek-flash');
    expect(() => setLlmModel('unknown-model')).toThrow();
  });
});

describe('model list endpoints', () => {
  it('appends /models when the base already ends with a version segment', () => {
    expect(modelListEndpoints('https://api.minimaxi.com/v1')).toEqual([
      'https://api.minimaxi.com/v1/models',
    ]);
    expect(modelListEndpoints('https://open.bigmodel.cn/api/coding/paas/v4/')).toEqual([
      'https://open.bigmodel.cn/api/coding/paas/v4/models',
    ]);
  });

  it('tries /v1/models before /models for plain origins', () => {
    expect(modelListEndpoints('https://api.deepseek.com')).toEqual([
      'https://api.deepseek.com/v1/models',
      'https://api.deepseek.com/models',
    ]);
  });

  it('parses OpenAI, Zhipu and bare-array model lists with dedupe', () => {
    expect(parseModelList({ data: [{ id: 'qwen' }, { id: 'qwen' }, { id: 'minimax' }] })).toEqual([
      'qwen',
      'minimax',
    ]);
    expect(parseModelList({ models: [{ slug: 'glm-5.2' }] })).toEqual(['glm-5.2']);
    expect(parseModelList(['a', { id: 'b' }, 3, null])).toEqual(['a', 'b']);
    expect(parseModelList({ error: { message: 'x' } })).toEqual([]);
  });
});

describe('verifyLlm', () => {
  const verifyInput = { baseUrl: 'https://api.deepseek.com', apiKey: 'test-only' };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  it.each(['https://other.example', `${input.baseUrl}/other`, 'http://api.deepseek.com'])(
    'does not send a stored key to a different endpoint: %s',
    async (baseUrl) => {
      const created = saveLlmProvider(input);
      const fetcher = vi.fn().mockResolvedValue(json({ data: [] }));
      vi.stubGlobal('fetch', fetcher);
      const result = await verifyLlm({ id: created.id, baseUrl });
      expect(result.ok).toBe(false);
      expect(result.message).toContain('API 地址');
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it('allows a trailing slash when verifying with the stored key', async () => {
    const created = saveLlmProvider(input);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ data: [] })));
    expect((await verifyLlm({ id: created.id, baseUrl: `${input.baseUrl}/` })).ok).toBe(true);
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

  it('uses the stored key of a saved provider when apiKey is omitted', async () => {
    const created = saveLlmProvider(input);
    const fetcher = vi.fn().mockResolvedValue(json({ data: [] }));
    vi.stubGlobal('fetch', fetcher);
    const result = await verifyLlm({ id: created.id, baseUrl: input.baseUrl });
    expect(result).toEqual({ ok: true, message: '连接成功', models: [] });
    expect(fetcher.mock.calls[0]![1]!.headers).toEqual({ Authorization: 'Bearer test-only' });
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
