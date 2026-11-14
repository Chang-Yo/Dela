// 桌面私有的会话操作：Agent 交互本身走 core/protocol 的 agentContract，这里只放文件、归档等桌面便利。
import { z } from 'zod';
import type {
  ChatCommandView,
  ChatMediaView,
  ChatSessionSummary,
  FileChangeDetail,
} from '../../core/protocol/agent';
import type { UncommittedChanges } from '../../core/protocol/changes';
import { defineContract } from '../../core/protocol/contract';

const sessionId = z.uuid();
/** 会话内文件：相对路径按会话 cwd 解析，主进程要求文件真实存在。 */
const sessionFile = z.object({ sessionId, path: z.string().min(1).max(32_767) });

export const chatContract = defineContract('chat', {
  archived: { input: z.undefined(), output: z.custom<ChatSessionSummary[]>() },
  update: {
    input: z.object({
      id: sessionId,
      patch: z
        .object({ archived: z.boolean().optional(), pinned: z.boolean().optional() })
        .strict(),
    }),
    output: z.void(),
  },
  /** projectId 为 null 时归档通用会话；返回被归档的会话 id。 */
  archiveProject: { input: z.uuid().nullable(), output: z.custom<string[]>() },
  export: { input: sessionId, output: z.custom<{ saved: boolean; missing: string[] }>() },
  /** 永久删除，只接受已归档的会话。 */
  remove: { input: sessionId, output: z.void() },
  pickMedia: { input: z.undefined(), output: z.custom<ChatMediaView[]>() },
  /** 由主进程按命令 schema 校验，并拒绝与会话命令同名。 */
  saveCommand: {
    input: z.custom<{ id?: string; name: string; prompt: string }>(),
    output: z.custom<ChatCommandView>(),
  },
  deleteCommand: { input: z.uuid(), output: z.void() },
  /** 本机绝对路径，应用内预览标签以它作标签键。 */
  locateFile: { input: sessionFile, output: z.string() },
  openInVsCode: { input: sessionFile, output: z.void() },
  revealFile: { input: sessionFile, output: z.void() },
  openFile: { input: sessionFile, output: z.void() },
  readUncommittedChanges: { input: sessionId, output: z.custom<UncommittedChanges>() },
  readUncommittedFileChange: { input: sessionFile, output: z.custom<FileChangeDetail>() },
  /** 轻探测：两次 git 调用，不扫描文件。 */
  uncommittedAvailability: {
    input: sessionId,
    output: z.custom<Pick<UncommittedChanges, 'available' | 'reason'>>(),
  },
});
