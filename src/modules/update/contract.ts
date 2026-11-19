// 应用内更新契约：主进程持有权威状态机，渲染层只读快照并派发动作。
import { z } from 'zod';
import { defineContract } from '../../core/protocol/contract';

/** 不可用或失败的原因。取值稳定：渲染层据此选文案，不解析 detail 与原始错误码。 */
export type UpdateReason =
  | 'not-packaged'
  | 'platform-unsupported'
  | 'feed-unavailable'
  | 'invalid-update'
  | 'cancelled'
  | 'failed';

/**
 * 更新流程阶段：idle → checking → up-to-date | available → downloading → ready → installing；
 * 能力缺失进 unsupported，失败进 error。渲染层只做「阶段 → 文案 + 可用动作」的映射。
 */
export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'unsupported'
  | 'error';

export type UpdateStep = 'check' | 'download' | 'install';

export interface UpdateSnapshot {
  phase: UpdatePhase;
  currentVersion: string;
  version: string | null;
  progress: number;
  /** 本次传输已下载的字节数；差分下载时是差分传输量。 */
  transferred: number;
  total: number | null;
  checkedAt: string | null;
  reason: UpdateReason | null;
  /** 供排查用的原始错误摘要；不直接展示给用户。 */
  detail: string | null;
  failedAt: UpdateStep | null;
}

const snapshot = z.custom<UpdateSnapshot>();

export const updateContract = defineContract(
  'update',
  {
    state: { input: z.undefined(), output: snapshot },
    check: { input: z.undefined(), output: snapshot },
    download: { input: z.undefined(), output: snapshot },
    install: { input: z.undefined(), output: snapshot },
    deferInstall: { input: z.undefined(), output: z.void() },
    openDownloadPage: { input: z.undefined(), output: z.void() },
  },
  { state: snapshot },
);
