import type { CommandDomain } from '../../../../core/capabilities/commands';
import skill from '../../skills/shuiyuan/SKILL.md?raw';
import { listShuiyuanCategoriesTool } from './list-categories';
import { listShuiyuanTopicsTool } from './list-topics';
import { linkShuiyuanTopicTool } from './link-topic';
import { readShuiyuanPostsTool } from './read-posts';
import { readShuiyuanTopicTool } from './read-topic';
import { searchShuiyuanTopicsTool } from './search-topics';
import { shuiyuanStatusTool } from './status';

export const shuiyuanDomain = {
  name: 'shuiyuan',
  description: '查看水源分类、话题、搜索与帖子内容',
  skill: { name: 'shuiyuan', files: [{ path: 'SKILL.md', content: skill }] },
  commands: {
    shuiyuan_status: shuiyuanStatusTool,
    search_shuiyuan_topics: searchShuiyuanTopicsTool,
    list_shuiyuan_topics: listShuiyuanTopicsTool,
    list_shuiyuan_categories: listShuiyuanCategoriesTool,
    read_shuiyuan_topic: readShuiyuanTopicTool,
    read_shuiyuan_posts: readShuiyuanPostsTool,
    link_shuiyuan_topic: linkShuiyuanTopicTool,
  },
} satisfies CommandDomain;
