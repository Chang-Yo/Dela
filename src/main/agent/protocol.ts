// Agent 协议的主进程实现：只做转发，校验由协议 schema 完成。
import { AGENT_PROTOCOL_VERSION, agentContract } from '../../core/protocol/agent';
import { implement } from '../../core/protocol/contract';
import { listChatCommands } from './chat-commands';
import { readChatMediaPreview, releaseChatMedia, stageChatMedia } from './media';
import { usableLlmProviders } from './providers';
import {
  forkSession,
  newSession,
  openSession,
  runSessionCommand,
  setSessionEffort,
  setSessionModel,
} from './session/commands';
import {
  listSessionTurnChanges,
  readSessionTurnChanges,
  readSessionTurnFileChange,
} from './session/files';
import { askSession, cancelRun, withdrawQueued } from './session/run';
import { listSessions } from './session/store';
import { askSidechat, cancelSidechat, closeSidechat, keepSidechat, openSidechat } from './sidechat';
import { stopUserTask } from './tasks';

export const agentProtocol = implement(agentContract, {
  handshake: ({ protocolVersion }) => {
    if (protocolVersion !== AGENT_PROTOCOL_VERSION)
      throw new Error(
        `协议版本不一致（本机 ${AGENT_PROTOCOL_VERSION}，对方 ${protocolVersion}），请把两端升级到最新版`,
      );
    return { protocolVersion: AGENT_PROTOCOL_VERSION };
  },
  'list-sessions': ({ projectId, query }) => listSessions(projectId, query),
  'create-session': ({ projectId, scope }) => newSession(projectId, scope),
  'open-session': ({ sessionId }) => openSession(sessionId),
  ask: ({ sessionId, ...input }) => askSession(sessionId, input),
  'cancel-run': ({ sessionId }) => cancelRun(sessionId),
  'withdraw-queued': ({ sessionId }) => withdrawQueued(sessionId),
  'stop-task': ({ sessionId, taskId }) => stopUserTask(sessionId, taskId),
  fork: ({ sessionId, entryId }) => forkSession(sessionId, entryId),
  'list-models': () => usableLlmProviders().map(({ id, name, models }) => ({ id, name, models })),
  'set-model': ({ sessionId, providerId, model }) => setSessionModel(sessionId, providerId, model),
  'set-effort': ({ sessionId, level }) => setSessionEffort(sessionId, level),
  'list-commands': () => listChatCommands(),
  'run-command': ({ sessionId, name, args }) => runSessionCommand(sessionId, name, args),
  'open-sidechat': ({ parentId }) => openSidechat(parentId),
  'ask-sidechat': ({ parentId, ...input }) => askSidechat(parentId, input),
  'cancel-sidechat': ({ parentId }) => cancelSidechat(parentId),
  'close-sidechat': ({ parentId }) => closeSidechat(parentId),
  'keep-sidechat': ({ parentId }) => keepSidechat(parentId),
  'stage-media': ({ name, bytes }) => {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    return stageChatMedia(name, Buffer.from(view.buffer, view.byteOffset, view.byteLength));
  },
  'read-media-preview': ({ id }) => readChatMediaPreview(id),
  'release-media': ({ ids }) => releaseChatMedia(ids),
  'list-turn-changes': ({ sessionId }) => listSessionTurnChanges(sessionId),
  'read-turn-changes': ({ sessionId, turnId, includeStats }) =>
    readSessionTurnChanges(sessionId, turnId, includeStats),
  'read-turn-file-change': ({ sessionId, turnId, path }) =>
    readSessionTurnFileChange(sessionId, turnId, path),
});
