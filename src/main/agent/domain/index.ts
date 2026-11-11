// 过渡期的命令域清单：各域迁入自己的模块后，改由模块定义声明。
import type { CommandDomain } from '../../../core/capabilities/commands';
import { canvasDomain } from './canvas';
import { classroomDomain } from './classroom';
import { documentDomain } from './document';
import { mailDomain } from './mail';
import { resourceDomain } from './read-resource';
import { shuiyuanDomain } from './shuiyuan';
import { timetableDomain } from './timetable';
import { todoDomain } from './todo';
import { workspaceDomain } from './workspace';

export const builtinCommandDomains: CommandDomain[] = [
  resourceDomain,
  documentDomain,
  canvasDomain,
  classroomDomain,
  mailDomain,
  shuiyuanDomain,
  timetableDomain,
  todoDomain,
  workspaceDomain,
];
