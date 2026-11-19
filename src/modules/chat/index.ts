// 会话：Agent 交互由 app/main/agent-ipc 注册的 agentContract 承载，本模块提供桌面私有的会话操作与聊天界面。
import { defineModule } from '../../app/module';
import { deleteChatCommand, saveChatCommand } from '../../core/agent/chat-commands';
import { stageChatMediaFiles } from '../../core/agent/media';
import {
  archiveProjectSessions,
  deleteSession,
  updateSessionVisibility,
} from '../../core/agent/session/commands';
import {
  locateSessionFile,
  openSessionFile,
  readSessionUncommittedChanges,
  readSessionUncommittedFileChange,
  revealSessionFile,
  uncommittedAvailability,
} from '../../core/agent/session/files';
import { archivedSessions, preloadPi } from '../../core/agent/session/store';
import { exportSession } from '../../core/agent/session-export';
import { hostPorts } from '../../core/ports';
import { implement } from '../../core/protocol/contract';
import { openInVsCode } from '../workspace';
import { chatContract } from './contract';

/** 会话列表读写依赖 Pi 的会话存储，首次调用前要先装载。 */
function withPi<I, O>(fn: (input: I) => O | Promise<O>): (input: I) => Promise<O> {
  return async (input) => {
    await preloadPi();
    return fn(input);
  };
}

export const chatModule = defineModule({
  id: 'chat',
  ipc: implement(chatContract, {
    archived: withPi(() => archivedSessions()),
    update: withPi(({ id, patch }) => updateSessionVisibility(id, patch)),
    archiveProject: withPi(archiveProjectSessions),
    export: (id) => exportSession(id, hostPorts().workspaceClient()),
    remove: withPi(async (id) => {
      if (!archivedSessions().some((session) => session.id === id))
        throw new Error('请先归档，再从设置中永久删除');
      await deleteSession(id);
    }),
    pickMedia: async () => {
      const owner = hostPorts().workspaceClient();
      return owner ? stageChatMediaFiles(await hostPorts().desktop.pickFiles(owner)) : [];
    },
    saveCommand: saveChatCommand,
    deleteCommand: deleteChatCommand,
    locateFile: ({ sessionId, path }) => locateSessionFile(sessionId, path),
    openInVsCode: ({ sessionId, path }) => openInVsCode(locateSessionFile(sessionId, path)),
    revealFile: ({ sessionId, path }) => revealSessionFile(sessionId, path),
    openFile: ({ sessionId, path }) => openSessionFile(sessionId, path),
    readUncommittedChanges: readSessionUncommittedChanges,
    readUncommittedFileChange: ({ sessionId, path }) =>
      readSessionUncommittedFileChange(sessionId, path),
    uncommittedAvailability,
  }),
});
