import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadLlmConfig, saveLlmConfig, type StoredLlmConfig } from '../credentials';
import {
  listLlmProviders,
  modelListEndpoints,
  parseModelList,
  removeLlmProvider,
  saveLlmProvider,
  setActiveLlmProvider,
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
      presetId: input.presetId,
      active: false,
    });
    expect('apiKey' in view).toBe(false);
    expect(config.providers[0]!.apiKey).toBe('test-only');
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
