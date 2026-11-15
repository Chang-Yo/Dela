// 工作区的渲染端出口：目录树组件与客户端；条目镜像、标签与工作台仍在外壳（renderer/workspace、renderer/workbench）。
import { createClient, subscribe, type EventPayload } from '../../../core/protocol/contract';
import { workspaceContract } from '../contract';

export { Explorer, type ExplorerItem, type ExplorerPending } from './explorer';

// 工作区客户端被外壳的各个 store 引用，node 环境的测试也会加载到这里。
const bridge = typeof window === 'undefined' ? undefined : window.dela?.bridge;

export const workspaceClient = createClient(workspaceContract, bridge);

export function onWorkspaceEvent<K extends keyof (typeof workspaceContract)['events'] & string>(
  name: K,
  listener: (payload: EventPayload<typeof workspaceContract, K>) => void,
): () => void {
  return subscribe(workspaceContract, bridge, name, listener);
}

/** 拖进来的文件换成本机路径；没有本地路径的（如从网页拖入）丢掉。 */
export function localPathsOf(files: File[]): string[] {
  return files.map((file) => window.dela?.pathForFile(file) ?? '').filter(Boolean);
}
