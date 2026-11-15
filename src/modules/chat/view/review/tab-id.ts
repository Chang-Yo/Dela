// review:{sessionId}:{turnId}:{path}：冻结轮次的单文件审阅；review:{sessionId}:uncommitted：未提交改动聚合审阅。
// UUID 定长、路径段可含冒号（Windows 盘符），只能按位置截取才能无损往返。
import type { TabId } from '../../../shared/layout';

export type ReviewTabTarget =
  | { kind: 'turn'; sessionId: string; turnId: string; path: string }
  | { kind: 'uncommitted'; sessionId: string };

const TURN_PAYLOAD = /^([0-9a-f-]{36}):([0-9a-f-]{36}):(.+)$/;
// uncommitted 不是合法 UUID，与轮次变体天然无歧义。
const UNCOMMITTED_PAYLOAD = /^([0-9a-f-]{36}):uncommitted$/;

export function reviewTabId(target: ReviewTabTarget): TabId {
  return target.kind === 'turn'
    ? `review:${target.sessionId}:${target.turnId}:${target.path}`
    : `review:${target.sessionId}:uncommitted`;
}

/** 解析审阅标签键；载荷缺段或 UUID 位数不符时返回 null。 */
export function parseReviewTabId(tabId: string): ReviewTabTarget | null {
  if (!tabId.startsWith('review:')) return null;
  const payload = tabId.slice('review:'.length);
  const turn = TURN_PAYLOAD.exec(payload);
  if (turn) return { kind: 'turn', sessionId: turn[1]!, turnId: turn[2]!, path: turn[3]! };
  const uncommitted = UNCOMMITTED_PAYLOAD.exec(payload);
  return uncommitted ? { kind: 'uncommitted', sessionId: uncommitted[1]! } : null;
}

/** 标签栏标题取文件名：注册表的标题解析是同步的，读不了冻结记录。 */
export function reviewTabTitle(tabId: TabId): string {
  const target = parseReviewTabId(tabId);
  if (!target) return '改动审阅';
  if (target.kind === 'uncommitted') return '工作区改动';
  const cut = Math.max(target.path.lastIndexOf('/'), target.path.lastIndexOf('\\'));
  return cut >= 0 ? target.path.slice(cut + 1) : target.path;
}
