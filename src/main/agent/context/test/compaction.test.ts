// 摘要生成：独立非流式 fetch POST（mock fetch，不走真网）、请求形状、失败路径与解析。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseSessionSummary, summarizeHistory } from '../compaction';

const summaryContent = {
  goals: '整理复习计划',
  decisions: '按周划分专题',
  completed: '已检索课件与邮件',
  pending: '待写入笔记',
  resources: [{ key: 'note-1', title: '复习笔记', version: 'abc123' }],
};

const okPayload = {
  choices: [{ message: { content: JSON.stringify(summaryContent) } }],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('summarizeHistory', () => {
  it('发起非流式 POST 并解析摘要结构', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(okPayload));
    vi.stubGlobal('fetch', fetchMock);
    const summary = await summarizeHistory(
      { baseUrl: 'https://example.test/v1/', key: 'k', model: 'm1' },
      {
        messages: [
          { role: 'user', content: '帮我复习' },
          { role: 'assistant', content: '好的' },
        ],
        startIndex: 3,
        messageCount: 5,
      },
    );
    // URL 拼接去掉尾斜杠；鉴权与请求体形状（非流式、输出上限、系统指令不含工具）。
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('https://example.test/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('m1');
    expect(body.stream).toBe(false);
    expect(body.tools).toBeUndefined();
    expect(body.max_tokens).toBeLessThan(2048);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toContain('不虚构');
    expect(body.messages[1].content).toContain('【第 4 条｜用户】');
    // 返回结构：覆盖锚点 = startIndex + messages.length，带模型与时间。
    expect(summary).toEqual({
      coveredUpTo: 5,
      createdAt: expect.any(String),
      model: 'm1',
      content: summaryContent,
      messageCount: 5,
    });
  });

  it('附带旧摘要一并输入（覆盖范围合并可追溯）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(okPayload));
    vi.stubGlobal('fetch', fetchMock);
    const prior = parseSessionSummary(
      JSON.stringify({
        coveredUpTo: 2,
        createdAt: '2026-09-01T00:00:00.000Z',
        model: 'm0',
        content: summaryContent,
        messageCount: 2,
      }),
    );
    await summarizeHistory(
      { baseUrl: 'https://example.test', key: 'k', model: 'm1' },
      {
        messages: [{ role: 'user', content: '继续' }],
        startIndex: 2,
        messageCount: 3,
        priorSummary: prior,
      },
    );
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.messages[1].content).toContain('【旧摘要（已覆盖第 1–2 条消息）】');
    expect(body.messages[1].content).toContain('【待压缩的对话历史（第 3–3 条消息）】');
  });

  it('剥离模型输出包裹的 ```json 围栏', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          choices: [
            { message: { content: '```json\n' + JSON.stringify(summaryContent) + '\n```' } },
          ],
        }),
      ),
    );
    const summary = await summarizeHistory(
      { baseUrl: 'https://example.test', key: 'k', model: 'm1' },
      { messages: [{ role: 'user', content: 'x' }], startIndex: 0, messageCount: 1 },
    );
    expect(summary.content).toEqual(summaryContent);
  });

  it('非 200 响应抛错并带状态码', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 500)));
    await expect(
      summarizeHistory(
        { baseUrl: 'https://example.test', key: 'k', model: 'm1' },
        { messages: [{ role: 'user', content: 'x' }], startIndex: 0, messageCount: 1 },
      ),
    ).rejects.toThrow('摘要生成失败（HTTP 500）');
  });

  it('返回空内容或格式无效时抛错', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ choices: [{ message: { content: '随便说说' } }] })),
    );
    await expect(
      summarizeHistory(
        { baseUrl: 'https://example.test', key: 'k', model: 'm1' },
        { messages: [{ role: 'user', content: 'x' }], startIndex: 0, messageCount: 1 },
      ),
    ).rejects.toThrow('摘要生成返回的格式无效');
  });
});

describe('parseSessionSummary', () => {
  it('合法 JSON 解析为结构对象', () => {
    expect(
      parseSessionSummary(
        JSON.stringify({
          coveredUpTo: 3,
          createdAt: '2026-09-29T00:00:00.000Z',
          model: 'm',
          content: summaryContent,
          messageCount: 6,
        }),
      ),
    ).toMatchObject({ coveredUpTo: 3, messageCount: 6 });
  });

  it('空值与结构不符返回 null，不抛错', () => {
    expect(parseSessionSummary(null)).toBeNull();
    expect(parseSessionSummary('')).toBeNull();
    expect(parseSessionSummary('{bad json')).toBeNull();
    expect(parseSessionSummary(JSON.stringify({ coveredUpTo: -1 }))).toBeNull();
  });
});
