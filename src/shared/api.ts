// 聚合出口：领域契约在同目录领域文件，本文件只 re-export，保证全仓既有 import 路径不变。
// 领域类型变化请直接改对应文件，不在此处添加逻辑。
import type { Bridge } from '../core/protocol/contract';
import type { WindowApi } from './window';

export interface DelaApi {
  /** 已迁入 modules/ 的模块经契约客户端调用主进程，见 core/protocol/contract。 */
  readonly bridge: Bridge;
  readonly platform: string;
  /** 拖进窗口的文件在本机磁盘上的路径；没有本地路径时为空字符串。 */
  pathForFile(file: File): string;
  readonly version: string;
  /** NSIS 更新安装完成后启动，供界面提示实际运行的版本。 */
  readonly updatedOnLaunch: boolean;
  readonly window: WindowApi;
}

export type { WindowState, TrayAction, WindowApi } from './window';

export type {
  DocumentContent,
  OfficeExportInfo,
  OfficeExportProgress,
  OfficeExportEvent,
} from './documents';

export type {
  WorkspaceEntry,
  WorkspaceState,
  WorkspaceCreateInput,
} from '../modules/workspace/contract';
export { workspaceArchiveId } from '../modules/workspace/contract';

export type {
  TabKind,
  TabId,
  SplitOrientation,
  GroupNode,
  SplitNode,
  LayoutNode,
  WorkbenchLayout,
} from './layout';
