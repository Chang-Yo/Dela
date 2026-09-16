import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadLlmConfig, saveLlmConfig, type StoredLlmConfig } from '../credentials';
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
} from './providers';

vi.mock('../credentials', () => ({
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

const input = {
  name: 'DeepSeek',
  baseUrl: 'https://api.deepseek.com',
  apiKey: 'test-only',
  models: ['deepseek-v4-pro', 'deepseek-flash'],
  model: 'deepseek-v4-pro',
  presetId: 'deepseek',
};

describe('LLM provider config', () => {
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
