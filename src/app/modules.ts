// 模块清单：主进程据此注册各模块的 IPC 与后台任务。
import type { ModuleDefinition } from './module';
import { searchModule } from '../modules/search';
import { todoModule } from '../modules/todo';

export const modules: ModuleDefinition[] = [searchModule, todoModule];
