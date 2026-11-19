import { emit, hostPorts } from '../../../core/ports';
import { shuiyuanContract, shuiyuanTopicFromUrl } from '../contract';
import { getShuiyuanState } from './api';

/**
 * 外链出口前的水源分流：已绑定时，主题链接交回工作区窗口在应用内阅读。
 * 返回 false 时调用方照常交给系统浏览器，未绑定用户点开链接仍能在浏览器里看帖。
 */
export function openShuiyuanLinkInApp(url: string): boolean {
  const topic = shuiyuanTopicFromUrl(url);
  if (!topic || !getShuiyuanState().connected || !hostPorts().workspaceClient()) return false;
  emit(shuiyuanContract, 'openTopic', topic);
  return true;
}
