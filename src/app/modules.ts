// 模块清单：主进程据此注册各模块的 IPC。
import type { ModuleDefinition } from './module';
import { searchModule } from '../modules/search';

export const modules: ModuleDefinition[] = [searchModule];
