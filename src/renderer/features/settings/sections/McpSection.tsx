import { SectionHeader } from '../SectionHeader';
import { McpTab } from './plugins/McpTab';

/** 设置 › MCP Server：stdio 服务器的增删改、启停与连接状态。 */
export function McpSection() {
  return (
    <div className="grid gap-5">
      <SectionHeader title="MCP Server" />
      <McpTab />
    </div>
  );
}
