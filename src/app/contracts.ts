// preload 的通道白名单：只引用各模块的 contract.ts，避免把主进程代码打进 preload。
// 与 modules.ts 中的 ipc 一一对应，由测试保证。
import type { Contract } from '../core/protocol/contract';
import { searchContract } from '../modules/search/contract';

export const contracts: Contract[] = [searchContract];
