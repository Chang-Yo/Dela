// preload 的通道白名单：只引用各模块的 contract.ts，避免把主进程代码打进 preload。
// 与 modules.ts 中的 ipc 一一对应，由测试保证。
import type { Contract } from '../core/protocol/contract';
import { mailContract } from '../modules/mail/contract';
import { notificationsContract } from '../modules/notifications/contract';
import { searchContract } from '../modules/search/contract';
import { todoContract } from '../modules/todo/contract';
import { workspaceContract } from '../modules/workspace/contract';
import { canvasContract } from '../sjtu/canvas/contract';
import { classroomContract } from '../sjtu/classroom/contract';
import { jwcContract } from '../sjtu/jwc/contract';
import { shuiyuanContract } from '../sjtu/shuiyuan/contract';
import { timetableContract } from '../sjtu/timetable/contract';

export const contracts: Contract[] = [
  workspaceContract,
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
