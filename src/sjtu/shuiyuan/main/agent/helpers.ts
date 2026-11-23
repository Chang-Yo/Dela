import { z } from 'zod';
import type { ShuiyuanPost, ShuiyuanTopicSummary } from '../../contract';
import { getShuiyuanState } from '../api';
import { ToolError, toolError } from '../../../../core/capabilities/domain-tools';

export function slimTopicSummary(topic: ShuiyuanTopicSummary) {
  return {
    ref: { type: 'shuiyuan-online' as const, id: topic.id },
    id: topic.id,
    title: topic.title,
    excerpt: topic.excerpt,
    categoryId: topic.categoryId,
    tags: topic.tags,
    postsCount: topic.postsCount,
    views: topic.views,
    likeCount: topic.likeCount,
    createdAt: topic.createdAt,
    lastPostedAt: topic.lastPostedAt,
    pinned: topic.pinned,
    closed: topic.closed,
    authorUsername: topic.authorUsername,
    lastPosterUsername: topic.lastPosterUsername,
  };
}

export function slimPost(post: ShuiyuanPost) {
  return {
    id: post.id,
    postNumber: post.postNumber,
    username: post.username,
    createdAt: post.createdAt,
    cooked: post.cooked,
    replyToPostNumber: post.replyToPostNumber,
    likeCount: post.likeCount,
    yours: post.yours,
  };
}

export function requireShuiyuanBound() {
  if (!getShuiyuanState().connected)
    throw toolError('NOT_CONFIGURED', '尚未绑定水源社区，请先在设置中绑定账号后重试');
}

/** 水源业务错误 → 细分错误码；未识别的错误原样抛出。 */
function mapShuiyuanError(error: unknown): Error {
  if (error instanceof ToolError || error instanceof z.ZodError || !(error instanceof Error))
    return error instanceof Error ? error : new Error(String(error));
  const message = error.message;
  if (message.includes('尚未绑定水源社区'))
    return toolError('NOT_CONFIGURED', '尚未绑定水源社区，请先在设置中绑定账号后重试');
  if (message.includes('限流')) return toolError('RATE_LIMITED', message);
  if (/HTTP 40[13]/.test(message)) return toolError('AUTH_EXPIRED', message);
  if (message.includes('无法连接水源')) return toolError('NETWORK_ERROR', message);
  if (message.includes('不存在')) return toolError('NOT_FOUND', message);
  if (message.includes('水源返回错误') || message.includes('水源接口返回'))
    return toolError('UPSTREAM_ERROR', message);
  return error;
}

export async function withShuiyuanErrors<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw mapShuiyuanError(error);
  }
}
