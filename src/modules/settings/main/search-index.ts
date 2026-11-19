// 全局搜索 setting 入口的单一索引：每项 = 一个已实现的设置选项（含内置关键词，
// 覆盖同义词与英文），按 section 聚合后由主进程的搜索来源匹配。
import { settingsSectionLabels, type SettingsSectionId } from '../contract';

export interface SettingsSearchItem {
  id: string;
  section: SettingsSectionId;
  title: string;
  keywords: string[];
}

const settingsSearchItems: SettingsSearchItem[] = [
  {
    id: 'nav-entries',
    section: 'general',
    title: '导航入口',
    keywords: ['通用', '侧栏', '导航', '入口', '隐藏', '显示', 'sidebar', 'nav'],
  },
  {
    id: 'video-download-directory',
    section: 'storage',
    title: '视频默认下载目录',
    keywords: ['课堂', '录像', '下载', '目录', '交大视频', 'vsjtu', 'classroom', 'download'],
  },
  {
    id: 'open-at-login',
    section: 'general',
    title: '开机自启动',
    keywords: ['通用', '自启动', '开机', '启动', 'login', 'auto'],
  },
  {
    id: 'campus-notifications',
    section: 'notifications',
    title: '校园消息系统提醒',
    // 不含「邮件/水源」：这两个词的首要意图是凭据页的邮箱/水源。
    keywords: ['通知', '提醒', '消息', '弹窗', '桌面通知', 'notify'],
  },
  {
    id: 'notify-run-failed',
    section: 'notifications',
    title: '任务失败时提醒',
    keywords: ['通知', '任务', '失败', 'agent', '提醒', '错误'],
  },
  {
    id: 'notify-run-completed',
    section: 'notifications',
    title: '任务完成时提醒',
    keywords: ['通知', '任务', '完成', 'agent', '提醒'],
  },
  {
    id: 'snooze',
    section: 'notifications',
    title: '暂停通知',
    keywords: ['通知', '暂停', '免打扰', '静音', 'snooze'],
  },
  {
    id: 'check-update',
    section: 'general',
    title: '软件更新',
    keywords: ['通用', '更新', '升级', '版本', '检查更新', 'update', 'upgrade'],
  },
  {
    id: 'cache-usage',
    section: 'storage',
    title: '缓存占用',
    keywords: ['缓存', '清理', '清除', '空间', '占用', '磁盘', 'cache'],
  },
  {
    id: 'theme',
    section: 'appearance',
    title: '主题',
    keywords: ['外观', '深色', '浅色', '暗色', '夜间', 'dark', 'light'],
  },
  {
    id: 'zoom',
    section: 'appearance',
    title: '页面缩放',
    keywords: ['外观', '缩放', '放大', '缩小', 'zoom'],
  },
  {
    id: 'font-size',
    section: 'appearance',
    title: '字号',
    keywords: ['外观', '字号', '文字大小', '字体', 'font'],
  },
  {
    id: 'icon',
    section: 'appearance',
    title: '应用图标',
    keywords: ['外观', '图标', 'logo', 'icon'],
  },
  {
    id: 'shortcuts',
    section: 'shortcuts',
    title: '快捷键',
    keywords: ['快捷键', '键位', '按键', '热键', 'shortcut', 'key', 'keybinding'],
  },
  {
    id: 'work-directory',
    section: 'workspace',
    title: '工作目录',
    keywords: ['工作区', '目录', '文件夹', '保存位置', '笔记位置', 'folder'],
  },
  {
    id: 'reset-layout',
    section: 'workspace',
    title: '布局重置',
    keywords: ['工作区', '布局', '重置', '分屏', '标签', 'reset'],
  },
  {
    id: 'archived-chats',
    section: 'archived',
    title: '已归档对话',
    keywords: ['归档', '恢复', '对话', '永久删除', '全部删除', 'archive'],
  },
  {
    id: 'canvas',
    section: 'connections',
    title: 'Canvas',
    keywords: ['连接', 'canvas', '令牌', 'token', '课程', '作业'],
  },
  {
    id: 'mail',
    section: 'connections',
    title: '学校邮箱',
    keywords: ['连接', '邮箱', '邮件', 'imap', 'jaccount', 'mail'],
  },
  {
    id: 'timetable',
    section: 'connections',
    title: '教学信息服务网',
    keywords: ['连接', '教务', '课表', 'timetable', '课程表'],
  },
  {
    id: 'shuiyuan',
    section: 'connections',
    title: '水源社区',
    keywords: ['连接', '水源', '社区', '论坛', 'shuiyuan'],
  },
  {
    id: 'providers',
    section: 'providers',
    title: '模型服务',
    keywords: ['模型', 'llm', 'ai', 'api', '提供商', '供应商', '密钥', 'key', '推理'],
  },
  // 这些能力已并入 Agent 分组；「插件」仍作为搜索同义词保留
  {
    id: 'capabilities',
    section: 'capabilities',
    title: '内置能力',
    keywords: ['插件', '能力', '工具', '开关', '权限', 'tool', 'capability'],
  },
  {
    id: 'commands',
    section: 'commands',
    title: '自定义指令',
    keywords: ['插件', '指令', '提示词', 'prompt', '斜杠', '命令', 'command'],
  },
  {
    id: 'instruction',
    section: 'commands',
    title: '全局指令',
    keywords: ['插件', '指令', '附加指令', '全局指令', '长期偏好', '人格', '风格', 'instruction'],
  },
  {
    id: 'skills',
    section: 'skills',
    title: 'Skills',
    keywords: ['插件', 'skills', '技能'],
  },
  {
    id: 'mcp',
    section: 'mcp',
    title: 'MCP',
    keywords: ['插件', 'mcp', '服务器', 'server'],
  },
  {
    id: 'remote-connections',
    section: 'remotes',
    title: '远程连接',
    keywords: ['远程', 'ssh', '主机', '服务器', '连接', 'remote'],
  },
  { id: 'about', section: 'about', title: '关于', keywords: ['版本', '更新', 'credits', '关于'] },
  {
    id: 'privacy',
    section: 'privacy',
    title: '隐私条款',
    keywords: ['隐私', '数据', '安全', '条款', 'privacy'],
  },
  {
    id: 'terms',
    section: 'terms',
    title: '使用条款',
    keywords: ['条款', '责任', '免责', '许可', '开源', 'terms'],
  },
];

export const settingsSectionSummaries: Record<SettingsSectionId, string> = {
  general: '开机自启动、导航入口与软件更新',
  appearance: '主题、缩放、字号与图标',
  shortcuts: '查看与修改快捷键',
  notifications: '系统通知、校园消息与任务提醒',
  storage: '缓存、视频下载目录与已删除邮件保留',
  connections: 'Canvas、邮箱、教学信息服务网与水源',
  providers: 'AI 模型与 API 提供商',
  capabilities: '内置 Agent 能力开关',
  commands: '全局指令与快捷指令模板',
  skills: '工作目录中的技能',
  mcp: 'MCP 服务器与工具',
  workspace: '工作目录与布局',
  remotes: 'SSH 远程主机与连接',
  archived: '恢复或永久删除已归档对话',
  about: '版本信息',
  privacy: '数据存放与外发说明',
  terms: '使用本软件的责任划分',
};

export function settingsSectionsMatching(query: string): SettingsSectionId[] {
  const keyword = query.trim().toLowerCase();
  const sections = Object.keys(settingsSectionLabels) as SettingsSectionId[];
  return sections.filter((section) => {
    const items = settingsSearchItems.filter((item) => item.section === section);
    const haystack = [
      settingsSectionLabels[section],
      settingsSectionSummaries[section],
      ...items.flatMap((item) => [item.title, ...item.keywords]),
    ]
      .join(' ')
      .toLowerCase();
    return !keyword || haystack.includes(keyword);
  });
}
