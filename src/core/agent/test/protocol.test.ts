// Agent 协议入口：版本不一致拒绝连接；提问的 # 引用原样送达会话（曾被入参校验剥掉）。
import { expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ askSession: vi.fn(async () => ({})) }));
vi.mock('../session/run', () => ({ askSession: state.askSession }));
vi.mock('../chat-commands', () => ({}));
vi.mock('../media', () => ({}));
vi.mock('../providers', () => ({}));
vi.mock('../session/commands', () => ({}));
vi.mock('../session/files', () => ({}));
vi.mock('../session/store', () => ({}));
vi.mock('../sidechat', () => ({}));
vi.mock('../tasks', () => ({}));

import { AGENT_PROTOCOL_VERSION } from '../../protocol/agent';
import { agentProtocol } from '../protocol';

const sessionId = '0b9c6f6e-2a51-4d8e-9a39-5f0a4c1e7d21';
const referenced = { id: '6f1d2c3b-4a5e-4f60-8172-93a4b5c6d7e8', title: '复习计划' };

it('握手：主版本一致才放行', () => {
  expect(agentProtocol.call('handshake', { protocolVersion: AGENT_PROTOCOL_VERSION })).toEqual({
    protocolVersion: AGENT_PROTOCOL_VERSION,
  });
  expect(() =>
    agentProtocol.call('handshake', { protocolVersion: AGENT_PROTOCOL_VERSION + 1 }),
  ).toThrow('协议版本不一致');
});

it('提问：# 引用的会话随入参送达', async () => {
  await agentProtocol.call('ask', {
    sessionId,
    text: '对比一下',
    attachments: [],
    context: [],
    sessions: [referenced],
    comments: [],
  });
  expect(state.askSession).toHaveBeenCalledWith(
    sessionId,
    expect.objectContaining({ text: '对比一下', sessions: [referenced] }),
  );
});
