import { createClient } from '../../../core/protocol/contract';
import { settingsContract } from '../contract';

// 快捷键与外观的 store 在模块加载时创建，node 环境的测试也会加载到这里。
const bridge = typeof window === 'undefined' ? undefined : window.dela?.bridge;

export const settingsClient = createClient(settingsContract, bridge);
