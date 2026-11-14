// preload 的通道白名单：只引用各模块的 contract.ts，避免把主进程代码打进 preload。
// Agent 协议由 app/agent-ipc 注册，其余与 modules.ts 中的 ipc 一一对应，由测试保证。
import { agentContract } from '../core/protocol/agent';
import type { Contract } from '../core/protocol/contract';
import { chatContract } from '../modules/chat/contract';
import { mailContract } from '../modules/mail/contract';
import { notificationsContract } from '../modules/notifications/contract';
import { remotesContract } from '../modules/remotes/contract';
import { searchContract } from '../modules/search/contract';
import { terminalContract } from '../modules/terminal/contract';
import { todoContract } from '../modules/todo/contract';
import { workspaceContract } from '../modules/workspace/contract';
import { canvasContract } from '../sjtu/canvas/contract';
import { classroomContract } from '../sjtu/classroom/contract';
import { jwcContract } from '../sjtu/jwc/contract';
import { shuiyuanContract } from '../sjtu/shuiyuan/contract';
import { timetableContract } from '../sjtu/timetable/contract';

export const contracts: Contract[] = [
  agentContract,
  workspaceContract,
  remotesContract,
  terminalContract,
  chatContract,
  mailContract,
  searchContract,
  todoContract,
  notificationsContract,
  canvasContract,
  shuiyuanContract,
  classroomContract,
  timetableContract,
  jwcContract,
];
