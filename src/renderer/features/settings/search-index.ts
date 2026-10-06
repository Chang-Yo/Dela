// 全局搜索 setting 入口的单一索引：每项 = 一个已实现的设置选项（含内置关键词，
// 覆盖同义词与英文），按 section 聚合后供 GlobalSearchDialog 匹配展示。
import type { GlobalSearchResult } from '../../../shared/search';
import type { SettingsSectionId } from '../../../shared/settings';

export interface SettingsSearchItem {
  /** 索引项 id（稳定键）。 */
  id: string;
  section: SettingsSectionId;
  /** 选项标题。 */
  title: string;
  /** 关键词：分类别名、同义词与常见英文。 */
  keywords: string[];
}

export const settingsSearchItems: SettingsSearchItem[] = [
  // 通用
  {
    id: 'open-at-login',
    section: 'general',
    title: '开机自启动',
    keywords: ['通用', '自启动', '开机', '启动', 'login', 'auto'],
  },
  // 外观
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
    id: 'font-scale',
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
  // 通知
  {
    id: 'campus-notifications',
    section: 'notifications',
    title: '校园消息系统提醒',
    // 不含「邮件/水源」：这两个词的首要意图是连接页的邮箱/水源卡片。
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
  // 工作区
  {
    id: 'archived-chats',
    section: 'workspace',
    title: '已归档对话',
    keywords: ['归档', '恢复', '对话', '永久删除', '隐藏项目', 'archive'],
  },
  {
    id: 'work-directory',
    section: 'workspace',
    title: '工作目录',
    keywords: ['工作区', '目录', '文件夹', '保存位置', '笔记位置', 'folder'],
  },
  {
    id: 'restore-last',
    section: 'workspace',
    title: '启动页面',
    keywords: ['工作区', '启动', '首页', '聊天', '项目', '标签', 'restore'],
  },
  {
    id: 'note-edit-mode',
    section: 'workspace',
    title: '默认笔记编辑方式',
    keywords: ['工作区', '笔记', '编辑', '所见即所得', '源码', 'markdown'],
  },
  {
    id: 'reset-layout',
    section: 'workspace',
    title: '布局重置',
    keywords: ['工作区', '布局', '重置', '分屏', '标签', 'reset'],
  },
  // 模型服务
  {
    id: 'llm',
    section: 'llm',
    title: '模型服务',
    keywords: ['模型', 'llm', 'ai', 'api', '提供商', '密钥', 'key', '推理'],
  },
  // 连接
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
  // 插件
  {
    id: 'plugins',
    section: 'plugins',
    title: '自定义指令',
    keywords: ['插件', '指令', '提示词', 'prompt', '斜杠', '命令'],
  },
  {
    id: 'plugins-skills',
    section: 'plugins',
    title: 'Skills',
    keywords: ['插件', 'skills', '技能'],
  },
  {
    id: 'plugins-mcp',
    section: 'plugins',
    title: 'MCP',
    keywords: ['插件', 'mcp', '服务器'],
  },
  // 关于
  { id: 'about', section: 'about', title: '关于', keywords: ['版本', '更新', 'credits', '关于'] },
];

export const settingsSectionLabels: Record<SettingsSectionId, string> = {
  general: '通用',
  appearance: '外观',
  notifications: '通知',
  workspace: '工作区',
  llm: '模型服务',
  connections: '连接',
  plugins: '插件',
  about: '关于',
};

/** 全局搜索 setting 入口的分组摘要（与设置内搜索共用同一份关键词）。 */
export const settingsSectionSummaries: Record<SettingsSectionId, string> = {
  general: '开机自启动',
  appearance: '主题、缩放、字号与图标',
  notifications: '校园消息与任务提醒',
  workspace: '工作目录、启动页面与布局',
  llm: 'AI 模型与 API 提供商',
  connections: 'Canvas、邮箱、教务与水源连接',
  plugins: '自定义指令、Skills 与 MCP',
  about: '版本信息',
};

/** 按分类聚合的全局搜索设置入口（分类名 + 摘要 + 全部选项标题与关键词参与匹配）。 */
export function settingsResultsFor(query: string): GlobalSearchResult[] {
  const keyword = query.trim().toLowerCase();
  return (Object.keys(settingsSectionLabels) as SettingsSectionId[])
    .map((section) => {
      const items = settingsSearchItems.filter((item) => item.section === section);
      const haystack = [
        settingsSectionLabels[section],
        settingsSectionSummaries[section],
        ...items.flatMap((item) => [item.title, ...item.keywords]),
      ]
        .join(' ')
        .toLowerCase();
      return { section, haystack };
    })
    .filter(({ haystack }) => !keyword || haystack.includes(keyword))
    .map(({ section }) => ({
      kind: 'setting' as const,
      id: section,
      title: settingsSectionLabels[section],
      subtitle: `设置 · ${settingsSectionSummaries[section]}`,
      target: { page: 'settings' as const, section },
    }));
}
