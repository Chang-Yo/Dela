import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CredentialDecryptionError } from '../../ports';
import { loadLlmConfig, saveLlmConfig, type StoredLlmConfig } from '../llm-config';
import {
  listLlmProviders,
  removeLlmProvider,
  saveLlmProvider,
  setLlmProviderEnabled,
  usableLlmProviders,
  verifyLlm,
  verifyLlmModel,
} from '../providers';
import { MockOpenAiServer, mockFrames } from './mock-openai-server';

vi.mock('../pi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../pi')>()),
  llmCatalog: vi.fn(async () => [
    {
      id: 'deepseek',
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      models: [
        {
          id: 'deepseek-v4-pro',
          name: 'DeepSeek V4 Pro',
          contextWindow: 1000000,
          maxOutputTokens: 384000,
          vision: false,
          effortLevels: ['none', 'low', 'high', 'max'],
        },
      ],
    },
  ]),
}));

vi.mock('../llm-config', () => ({
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
    expect(failure).toEqual({ ok: false, message: '模型检测失败（HTTP 403）' });
  } finally {
    await server.close();
  }
});

it('reuses the stored key for a model probe at any address', async () => {
  const created = await saveLlmProvider(input);
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
  piProvider: null,
};

describe('LLM provider config', () => {
  it('takes the address and effort levels of a built-in vendor from the Pi catalog', async () => {
    const view = await saveLlmProvider({
      name: 'DeepSeek',
      apiKey: 'test-only',
      models: ['deepseek-v4-pro'],
      piProvider: 'deepseek',
    });
    expect(view.baseUrl).toBe('https://api.deepseek.com');
    expect(view.modelConfigs?.['deepseek-v4-pro']).toEqual({
      effortLevels: ['none', 'low', 'high', 'max'],
      effort: 'high',
    });
    await expect(
      saveLlmProvider({ ...input, models: ['deepseek-chat'], piProvider: 'deepseek' }),
    ).rejects.toThrow('deepseek-chat');
  });

  it('rejects invalid model limits and settings for models outside the list', async () => {
    await expect(
      saveLlmProvider({
        ...input,
        modelConfigs: { 'deepseek-v4-pro': { maxOutputTokens: 512000 } },
      }),
    ).rejects.toThrow();
    await expect(
      saveLlmProvider({ ...input, modelConfigs: { 'deepseek-v4-pro': { contextWindow: 8192 } } }),
    ).rejects.toThrow();
    await expect(
      saveLlmProvider({ ...input, modelConfigs: { 'deepseek-v4-pro': { contextWindow: -1 } } }),
    ).rejects.toThrow();
    await expect(
      saveLlmProvider({
        ...input,
        modelConfigs: { 'deepseek-v4-pro': { contextWindow: 1000, maxOutputTokens: 2000 } },
      }),
    ).rejects.toThrow();
    await expect(
      saveLlmProvider({ ...input, modelConfigs: { unknown: { contextWindow: 1000000 } } }),
    ).rejects.toThrow('模型配置必须属于模型列表');
  });
  it('can add a provider after the old encrypted config becomes unreadable', async () => {
    loadMock.mockImplementation(() => {
      throw new CredentialDecryptionError('llm-providers', undefined);
    });
    expect((await saveLlmProvider(input)).name).toBe(input.name);
    expect(config.providers).toHaveLength(1);
    expect(config.providers[0]!.apiKey).toBe(input.apiKey);
  });

  it('does not replace an unreadable config when editing an existing provider', async () => {
    loadMock.mockImplementation(() => {
      throw new CredentialDecryptionError('llm-providers', undefined);
    });
    const writes = saveMock.mock.calls.length;
    await expect(
      saveLlmProvider({ ...input, id: '00000000-0000-4000-8000-000000000001' }),
    ).rejects.toThrow(CredentialDecryptionError);
    expect(saveMock.mock.calls).toHaveLength(writes);
  });

  it('saves a new provider with a generated id and returns the masked view', async () => {
    const view = await saveLlmProvider(input);
    expect(view).toEqual({
      id: view.id,
      name: input.name,
      baseUrl: input.baseUrl,
      models: input.models,
      piProvider: null,
      enabled: true,
    });
    expect('apiKey' in view).toBe(false);
    expect(config.providers[0]!.apiKey).toBe('test-only');
  });

  it('keeps the stored key when editing with an empty apiKey', async () => {
    const created = await saveLlmProvider(input);
    await saveLlmProvider({ ...input, id: created.id, apiKey: '', name: 'DeepSeek 备用' });
    expect(config.providers[0]!.apiKey).toBe('test-only');
    expect(config.providers[0]!.name).toBe('DeepSeek 备用');
  });

  it('offers only enabled providers with a key to sessions, keeping disabled ones configured', async () => {
    const created = await saveLlmProvider(input);
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

describe('verifyLlm', () => {
  const verifyInput = { baseUrl: 'https://api.deepseek.com', apiKey: 'test-only' };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  it('reuses the stored key of a saved provider when apiKey is omitted, at whatever address is given', async () => {
    const created = await saveLlmProvider(input);
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
    fetcher.mockClear();
    const elsewhere = await verifyLlm({ id: created.id, baseUrl: 'https://gateway.internal/v1' });
    expect(elsewhere.ok).toBe(true);
    expect(fetcher.mock.calls[0]![0]).toBe('https://gateway.internal/v1/models');
    expect(fetcher.mock.calls[0]![1]!.headers).toEqual({ Authorization: 'Bearer test-only' });
  });

  it('allows verification at a new endpoint with an explicit key', async () => {
    const created = await saveLlmProvider(input);
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
});
