import { hostPorts } from '../../../core/ports';
import { freshness } from '../../../main/agent/domain/shared';
import type { WorkspaceSource } from '../../../modules/workspace';
import type { ResourceResolver } from '../../../core/capabilities/resources';
import type { ResourceRef } from '../../../modules/workspace/contract';
import { getShuiyuanTopic } from './api';
import { requireShuiyuanBound, withShuiyuanErrors } from './agent/helpers';
import { collectShuiyuanSnapshots, ensureShuiyuanSnapshot } from './snapshot';
import {
  readShuiyuanSource,
  readShuiyuanSourcePreview,
  shuiyuanPostsHtml,
  shuiyuanTopicUrl,
} from './sources';

const topicOf = (sourceId: string) => Number(sourceId.slice('shuiyuan-topic:'.length));

// 帖子来源是引用条目，快照不对外暴露为文件路径，因此没有 filePath。
export const shuiyuanWorkspaceSource: WorkspaceSource = {
  owns: (sourceId) => sourceId.startsWith('shuiyuan-topic:'),
  validate(sourceId) {
    const topicId = topicOf(sourceId);
    if (
      !Number.isInteger(topicId) ||
      topicId <= 0 ||
      !hostPorts().database().prepare('SELECT 1 FROM shuiyuan_topics WHERE topic_id=?').get(topicId)
    )
      throw new Error('水源帖子引用不存在，请回到水源页重新添加');
  },
  added: (sourceId) => ensureShuiyuanSnapshot(topicOf(sourceId)),
  collect: collectShuiyuanSnapshots,
  preview: (sourceId) => readShuiyuanSourcePreview(topicOf(sourceId)),
  async read(sourceId) {
    const content = await readShuiyuanSource(topicOf(sourceId));
    return {
      title: content.title,
      format: content.format === 'text' ? 'text' : content.format === 'html' ? 'html' : 'file',
      text: content.text,
      url: content.url,
    };
  },
};

export const shuiyuanOnlineResourceResolver: ResourceResolver<
  Extract<ResourceRef, { type: 'shuiyuan-online' }>
> = {
  async read(ref, offset, limit) {
    requireShuiyuanBound();
    const detail = await withShuiyuanErrors(() => getShuiyuanTopic(ref.id));
    const text = shuiyuanPostsHtml(detail.posts);
    return {
      ref,
      title: detail.title,
      format: 'html',
      revision: null,
      url: shuiyuanTopicUrl(ref.id),
      freshness: freshness('realtime', detail.lastPostedAt),
      ...(detail.posts.length < detail.stream.length
        ? {
            note: `只读到前 ${detail.posts.length}/${detail.stream.length} 楼，用 read_shuiyuan_topic 与 read_shuiyuan_posts 续读`,
          }
        : {}),
      text: text.slice(offset, offset + limit),
      totalCharacters: text.length,
      nextOffset: offset + limit < text.length ? offset + limit : null,
    };
  },
};
