import { z } from 'zod';
import { resourceRefSchema } from '../../shared/resources';
import {
  getCanvasState,
  readCanvasSource,
  syncCanvasCourse,
  syncCanvasCourses,
} from '../canvas/api';
import { mailSearchSchema, readMailMessage, searchMail } from '../mail/api';
import {
  createWorkspaceEntry,
  getWorkspaceState,
  readWorkspaceEntry,
  saveWorkspaceNote,
  updateWorkspaceEntry,
} from '../workspace/api';
import { copyResourceToProject } from '../resources';
import { emailDraftSchema, prepareEmail } from '../mail/drafts';
import { createCalendarEvent, querySchedule, scheduleQuerySchema } from '../timetable/api';

const uuid = z.string().uuid();
const query = z.string().max(500).default('');
const offset = z.number().int().min(0).default(0);
const limit = z.number().int().min(1).max(100).default(30);
const name = z.string().trim().min(1).max(200);

function page<T>(items: T[], start: number, count: number) {
  return {
    items: items.slice(start, start + count),
    total: items.length,
    nextOffset: start + count < items.length ? start + count : null,
  };
}

function tool<T extends z.ZodType>(
  description: string,
  schema: T,
  execute: (input: z.output<T>) => unknown,
) {
  return { description, schema, execute: (input: unknown) => execute(schema.parse(input)) };
}

function match(value: string, keyword: string) {
  return value.toLocaleLowerCase().includes(keyword.toLocaleLowerCase());
}

export const agentTools = {
  prepare_email: tool(
    '准备可供用户检查和发送的邮件草稿。可附加项目文件、Canvas 文件或邮件附件引用；不会发送邮件。附件在用户打开草稿时加载。',
    emailDraftSchema,
    prepareEmail,
  ),
  query_schedule: tool(
    '查询指定范围的课程与个人事件，按上海时区展开周次。输入 UTC ISO 时间。缺少周次或学期日期会返回不完整警告。',
    scheduleQuerySchema,
    querySchedule,
  ),
  query_assignments: tool(
    '查询缓存的 Canvas 作业与截止时间。不提供未完成筛选：当前未保存可靠的提交状态。无截止时间的作业仅在未指定日期范围时返回。',
    z
      .object({
        courseId: z.number().int().positive().optional(),
        startAt: z.string().datetime().optional(),
        endAt: z.string().datetime().optional(),
        offset,
        limit,
      })
      .strict(),
    ({ courseId, startAt, endAt, offset, limit }) => {
      const state = getCanvasState();
      const items = new Map(
        state.items
          .filter(
            (item) =>
              item.kind === 'assignment' &&
              item.sourceId &&
              (courseId === undefined || item.courseId === courseId) &&
              (!startAt || (item.dueAt && Date.parse(item.dueAt) >= Date.parse(startAt))) &&
              (!endAt || (item.dueAt && Date.parse(item.dueAt) < Date.parse(endAt))),
          )
          .map((item) => [
            item.sourceId!,
            {
              ref: { type: 'canvas', id: item.sourceId! },
              title: item.name,
              courseId: item.courseId,
              dueAt: item.dueAt ?? null,
              submissionStatus: 'unknown',
            },
          ]),
      );
      return {
        ...page(
          [...items.values()].sort((a, b) => (a.dueAt ?? 'z').localeCompare(b.dueAt ?? 'z')),
          offset,
          limit,
        ),
        coverage: 'cached_assignments',
        courses: state.courses
          .filter((c) => courseId === undefined || c.id === courseId)
          .map((c) => ({ id: c.id, syncedAt: c.syncedAt, error: c.error })),
      };
    },
  ),
  search_mail: tool(
    '搜索已缓存邮件的主题和摘要，可按发件人、日期和文件夹筛选。不是完整邮箱或正文搜索；未找到不能证明邮件不存在。',
    mailSearchSchema,
    searchMail,
  ),
  find_courses: tool(
    '查找已缓存的 Canvas 课程。返回课程 ID、同步时间和错误；未同步课程内容时先调用 sync_sources。',
    z.object({ query, offset, limit }).strict(),
    ({ query, offset, limit }) => {
      const state = getCanvasState();
      return {
        ...page(
          state.courses.filter((c) => match(`${c.name} ${c.code} ${c.term}`, query)),
          offset,
          limit,
        ),
        connected: state.connected,
        syncedAt: state.syncedAt,
        coverage: 'cached_courses',
      };
    },
  ),
  sync_sources: tool(
    '同步 Canvas 课程列表，或指定课程的资料。课程内容可能部分同步失败，检查返回的 error。',
    z.object({ courseId: z.number().int().positive().optional() }).strict(),
    async ({ courseId }) => {
      const state =
        courseId === undefined ? await syncCanvasCourses() : await syncCanvasCourse(courseId);
      return {
        courses: state.courses.filter((c) => courseId === undefined || c.id === courseId),
        syncedAt: state.syncedAt,
      };
    },
  ),
  search_sources: tool(
    '按标题查找已缓存的 Canvas 资料，返回可传给 read_resource 的引用。不是正文全文检索。',
    z
      .object({
        query,
        courseId: z.number().int().positive().optional(),
        kind: z.enum(['file', 'assignment', 'page', 'discussion', 'link']).optional(),
        offset,
        limit,
      })
      .strict(),
    ({ query, courseId, kind, offset, limit }) => {
      const state = getCanvasState();
      const unique = new Map(
        state.items
          .filter(
            (item) =>
              item.sourceId &&
              (courseId === undefined || item.courseId === courseId) &&
              (!kind || item.kind === kind) &&
              match(item.name, query),
          )
          .map((item) => [
            item.sourceId!,
            {
              ref: { type: 'canvas', id: item.sourceId! },
              title: item.name,
              courseId: item.courseId,
              kind: item.kind,
              dueAt: item.dueAt ?? null,
            },
          ]),
      );
      return {
        ...page([...unique.values()], offset, limit),
        coverage: 'cached_titles',
        courses: state.courses
          .filter((c) => courseId === undefined || c.id === courseId)
          .map((c) => ({ id: c.id, syncedAt: c.syncedAt, error: c.error })),
      };
    },
  ),
  search_workspace: tool(
    '按名称搜索工作区条目；parentId 限定直接子条目。返回引用，不返回磁盘路径。',
    z.object({ query, parentId: uuid.nullable().optional(), offset, limit }).strict(),
    ({ query, parentId, offset, limit }) =>
      page(
        getWorkspaceState()
          .entries.filter(
            (item) =>
              (parentId === undefined || item.parentId === parentId) && match(item.name, query),
          )
          .map((item) => ({ ...item, ref: { type: 'workspace', id: item.id } })),
        offset,
        limit,
      ),
  ),
  read_resource: tool(
    '读取项目文档、Canvas 正文或邮件。按字符分页；PDF/图片暂不提取文字。HTML 保留原始链接标记。邮件读取不标记已读。',
    z
      .object({
        ref: resourceRefSchema,
        offset,
        limit: z.number().int().min(1).max(30000).default(12000),
      })
      .strict(),
    async ({ ref, offset, limit }) => {
      if (ref.type === 'attachment')
        throw new Error('附件请用 copy_file_to_project 导入；暂不支持直接提取附件正文');
      if (ref.type === 'mail') {
        const mail = await readMailMessage(ref.id);
        const text = mail.bodyText ?? mail.bodyHtml ?? '';
        return {
          ref,
          title: mail.subject,
          format: mail.bodyText !== null ? 'text' : 'html',
          sender: mail.sender,
          to: mail.to,
          cc: mail.cc,
          date: mail.date,
          text: text.slice(offset, offset + limit),
          totalCharacters: text.length,
          nextOffset: offset + limit < text.length ? offset + limit : null,
          attachments: mail.attachments.map((a) => ({
            name: a.filename,
            size: a.size,
            ref: a.part ? { type: 'attachment', messageId: mail.id, part: a.part } : null,
          })),
        };
      }
      const content =
        ref.type === 'canvas' ? await readCanvasSource(ref.id) : await readWorkspaceEntry(ref.id);
      const text = content.text;
      return {
        ref,
        title: content.title,
        format: content.format,
        revision: content.revision,
        url: content.url,
        text: text?.slice(offset, offset + limit),
        readable: text !== undefined,
        totalCharacters: text?.length ?? null,
        nextOffset: text !== undefined && offset + limit < text.length ? offset + limit : null,
      };
    },
  ),
  create_entry: tool(
    '创建项目、文件夹或 Markdown 笔记。parentId 为 null 时创建在根目录。',
    z
      .object({
        parentId: uuid.nullable(),
        kind: z.enum(['project', 'folder', 'note']),
        name,
        text: z.string().max(1000000).optional(),
      })
      .strict(),
    (input) => {
      const entry = createWorkspaceEntry(input);
      return { ref: { type: 'workspace', id: entry.id }, entry };
    },
  ),
  update_entry: tool(
    '重命名或移动工作区条目。返回实际更新后的条目。',
    z.object({ id: uuid, name: name.optional(), parentId: uuid.nullable().optional() }).strict(),
    ({ id, ...changes }) => {
      updateWorkspaceEntry(id, changes);
      return {
        ref: { type: 'workspace', id },
        entry: getWorkspaceState().entries.find((e) => e.id === id),
      };
    },
  ),
  write_note: tool(
    '替换 Markdown 笔记正文。必须先读取并提供当前 revision；版本不匹配时重新读取，不盲目重试。',
    z.object({ id: uuid, text: z.string().max(1000000), revision: z.string().min(1) }).strict(),
    ({ id, text, revision }) => ({
      ref: { type: 'workspace', id },
      revision: saveWorkspaceNote(id, text, revision),
    }),
  ),
  link_source: tool(
    '将 Canvas 资料关联到项目或文件夹，保留原始资料来源。',
    z.object({ parentId: uuid, sourceId: z.string().min(1).max(512), name }).strict(),
    (input) => {
      const entry = createWorkspaceEntry({ ...input, kind: 'source' });
      return { ref: { type: 'workspace', id: entry.id }, entry };
    },
  ),
  copy_file_to_project: tool(
    '复制 Canvas 文件或邮件附件到工作区目录，返回新项目文件引用。',
    z.object({ source: resourceRefSchema, parentId: uuid }).strict(),
    copyResourceToProject,
  ),
  create_event: tool(
    '创建个人日程。起止时间使用 UTC ISO 8601（Z）；不会修改课程课表。',
    z
      .object({
        title: z.string().trim().min(1).max(120),
        startAt: z.string().datetime(),
        endAt: z.string().datetime(),
        location: z.string().max(120).optional(),
      })
      .strict(),
    createCalendarEvent,
  ),
};

export function modelToolDefinitions() {
  return Object.entries(agentTools).map(([name, tool]) => ({
    type: 'function' as const,
    function: {
      name,
      description: tool.description,
      parameters: z.toJSONSchema(tool.schema, { io: 'input' }),
    },
  }));
}

export async function executeAgentTool(name: string, input: unknown) {
  if (!Object.hasOwn(agentTools, name))
    return { ok: false, error: { code: 'UNKNOWN_TOOL', message: '工具不存在' } };
  try {
    const result = await agentTools[name as keyof typeof agentTools].execute(input);
    return { ok: true, result };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: error instanceof z.ZodError ? 'INVALID_INPUT' : 'OPERATION_FAILED',
        message: error instanceof Error ? error.message : '操作失败',
      },
    };
  }
}
