// 内置 Agent 能力的启停（设置 › 内置能力）：清单来自 tools/registry 的工具表，
// 停用名单持久化在 workspace_settings('tools-disabled')。停用即从模型工具表移除
// （tools/registry 的过滤与执行门禁），应用的其它业务（邮件同步、TODO 轮询等）不受影响。
import type { AgentCapabilityView } from '../../../shared/capabilities';
import { toolDomains } from '../tools';
import { readDisabledTools, writeDisabledTools } from '../tools/disabled';
import { listBuiltinTools } from '../tools/registry';

/**
 * 常驻能力：Read/Write/Edit/Bash 是 Agent 循环的最小工具集，不提供开关；
 * ReadSkills 被 Skills 索引显式依赖，单独关闭会让工具表自相矛盾
 * （索引指向 ReadSkills 读取正文）。UI 只读展示原因。
 */
const lockedTools: Record<string, string> = {
  Read: 'Agent 内核最小工具集，不可关闭',
  Write: 'Agent 内核最小工具集，不可关闭',
  Edit: 'Agent 内核最小工具集，不可关闭',
  Bash: 'Agent 内核最小工具集，不可关闭',
  ReadSkills: 'Skills 索引经它读取正文，关闭后索引会指向不存在的工具',
};

const domainLabels = new Map(toolDomains.map((domain) => [domain.id, domain.label]));

/** 停用名单落库前剔除常驻能力：老版本可能留下过它们的停用记录。 */
function normalized(list: Iterable<string>): Set<string> {
  return new Set([...list].filter((name) => !(name in lockedTools)));
}

export function listBuiltinCapabilities(): AgentCapabilityView[] {
  const disabled = readDisabledTools();
  return listBuiltinTools().map(({ name, description, domain }) => ({
    name,
    domain,
    domainLabel: domainLabels.get(domain) ?? domain,
    description,
    enabled: !disabled.has(name),
    ...(lockedTools[name] ? { lockedReason: lockedTools[name] } : {}),
  }));
}

export function setBuiltinCapability(name: string, enabled: boolean): AgentCapabilityView[] {
  if (!listBuiltinTools().some((tool) => tool.name === name))
    throw new Error(`能力不存在：${name}`);
  if (lockedTools[name]) throw new Error(`该能力为常驻能力，不能关闭：${name}`);
  const disabled = normalized(readDisabledTools());
  if (enabled) disabled.delete(name);
  else disabled.add(name);
  writeDisabledTools(disabled);
  return listBuiltinCapabilities();
}

/** 按领域批量启停；常驻能力始终跳过（不写入停用名单，也不从名单中恢复）。 */
export function setBuiltinDomain(domain: string, enabled: boolean): AgentCapabilityView[] {
  if (!domainLabels.has(domain)) throw new Error(`能力分组不存在：${domain}`);
  const names = listBuiltinTools()
    .filter((tool) => tool.domain === domain)
    .map((tool) => tool.name);
  const disabled = normalized(readDisabledTools());
  for (const name of names) {
    if (lockedTools[name]) continue;
    if (enabled) disabled.delete(name);
    else disabled.add(name);
  }
  writeDisabledTools(disabled);
  return listBuiltinCapabilities();
}
