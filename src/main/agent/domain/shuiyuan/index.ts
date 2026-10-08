import type { AgentTool } from '../shared';
import { listShuiyuanCategoriesTool } from './list-categories';
import { listShuiyuanTopicsTool } from './list-topics';
import { linkShuiyuanTopicTool } from './link-topic';
import { readShuiyuanPostsTool } from './read-posts';
import { readShuiyuanTopicTool } from './read-topic';
import { searchShuiyuanTopicsTool } from './search-topics';
import { shuiyuanStatusTool } from './status';

export const shuiyuanTools = {
  shuiyuan_status: shuiyuanStatusTool,
  search_shuiyuan_topics: searchShuiyuanTopicsTool,
  list_shuiyuan_topics: listShuiyuanTopicsTool,
  list_shuiyuan_categories: listShuiyuanCategoriesTool,
  read_shuiyuan_topic: readShuiyuanTopicTool,
  read_shuiyuan_posts: readShuiyuanPostsTool,
  link_shuiyuan_topic: linkShuiyuanTopicTool,
} satisfies Record<string, AgentTool>;
