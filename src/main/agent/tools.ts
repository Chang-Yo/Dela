// 设置 › 内置能力：Pi 内置工具的开关。停用名单存 workspace_settings('tools-disabled')，
// 新建会话时作为 excludeTools 交给 Pi；read/write/edit/bash 是 agent 最小工具集，不可关闭。
// 联网搜索默认关闭：它要求用户自备搜索服务，未注册时调用只会报错。
// 读取网页默认开启：它不依赖任何注册，只受 web_fetch 自身的安全边界约束。
import { z } from 'zod';
import type { AgentCapabilityView } from '../../shared/capabilities';
import { getDatabase } from '../database';

const KEY = 'tools-disabled';
const DEFAULT_DISABLED = ['web_search'];

const tools: Omit<AgentCapabilityView, 'enabled'>[] = [
  {
    name: 'read',
    label: '读取文件',
    description: '读取文件与图片',
    domain: 'core',
    domainLabel: '基础',
  },
  {
    name: 'write',
    label: '写入文件',
    description: '创建或覆盖文件',
    domain: 'core',
    domainLabel: '基础',
  },
  {
    name: 'edit',
    label: '编辑文件',
    description: '精确替换文件中的文本',
    domain: 'core',
    domainLabel: '基础',
  },
  {
    name: 'bash',
    label: '执行命令',
    description:
      process.platform === 'darwin'
        ? '在 Bash 中执行命令（含 dela 校园命令）'
        : '在 Git Bash 中执行命令（含 dela 校园命令）',
    domain: 'core',
    domainLabel: '基础',
  },
  {
    name: 'grep',
    label: '搜索内容',
    description: '按内容搜索文件（ripgrep）',
    domain: 'search',
    domainLabel: '搜索',
  },
  {
    name: 'find',
    label: '查找文件',
    description: '按文件名模式查找文件',
    domain: 'search',
    domainLabel: '搜索',
  },
  {
    name: 'ls',
    label: '列出目录',
    description: '列出目录内容',
    domain: 'search',
    domainLabel: '搜索',
  },
  {
    name: 'web_search',
    label: '联网搜索',
    description: '联网搜索（需配置搜索服务，在聊天输入框左下角选择）',
    domain: 'web',
    domainLabel: '网络',
  },
  {
    name: 'web_fetch',
    label: '读取网页',
    description: '读取网页；PDF 直链交给文档读取 Skill（需安装组件）',
    domain: 'web',
    domainLabel: '网络',
  },
].map((tool) =>
  ['read', 'write', 'edit', 'bash'].includes(tool.name)
    ? { ...tool, lockedReason: 'Agent 最小工具集，不可关闭' }
    : tool,
);

export function readDisabledTools(): Set<string> {
  const row = getDatabase().prepare('SELECT value FROM workspace_settings WHERE key=?').get(KEY) as
    { value: string } | undefined;
  const parsed = z.array(z.string()).safeParse(row ? JSON.parse(row.value) : DEFAULT_DISABLED);
  const names = new Set(tools.filter((tool) => !tool.lockedReason).map((tool) => tool.name));
  return new Set((parsed.success ? parsed.data : []).filter((name) => names.has(name)));
}

function writeDisabledTools(names: Set<string>) {
  getDatabase()
    .prepare('INSERT OR REPLACE INTO workspace_settings VALUES (?, ?)')
    .run(KEY, JSON.stringify([...names]));
}

export function listBuiltinCapabilities(): AgentCapabilityView[] {
  const disabled = readDisabledTools();
  return tools.map((tool) => ({ ...tool, enabled: !disabled.has(tool.name) }));
}

export function setBuiltinCapabilities(names: string[], enabled: boolean): AgentCapabilityView[] {
  const disabled = readDisabledTools();
  for (const name of names) {
    const tool = tools.find((item) => item.name === name);
    if (!tool) throw new Error(`能力不存在：${name}`);
    if (tool.lockedReason) continue;
    if (enabled) disabled.delete(name);
    else disabled.add(name);
  }
  writeDisabledTools(disabled);
  return listBuiltinCapabilities();
}

export function domainTools(domain: string): string[] {
  return tools.filter((tool) => tool.domain === domain).map((tool) => tool.name);
}
