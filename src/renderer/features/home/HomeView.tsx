import { useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  CalendarDays,
  FolderKanban,
  History,
  ListTodo,
  NotebookPen,
  Plus,
  SquarePen,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import { useWorkspace } from '../projects/workspace';
import { ChatComposer, ChatSessions, ChatThread, ModelKeyForm, useChat } from '../chat';

function greeting() {
  const hour = new Date().getHours();
  if (hour < 5) return '夜深了';
  if (hour < 11) return '早上好';
  if (hour < 13) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

export function HomeView({
  onOpenProject,
  onNewProject,
  onOpenSources,
}: {
  onOpenProject: (id: string) => void;
  onNewProject: () => void;
  onOpenSources: () => void;
}) {
  const workspace = useWorkspace((s) => s.workspace);
  const canvas = useWorkspace((s) => s.canvas);
  const projects = workspace.entries.filter((entry) => entry.kind === 'project');
  const chatState = useChat('home');
  const { chat, busy, error } = chatState;
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const [sessionsOpen, setSessionsOpen] = useState(false);

  const conversation = Boolean(chat && (chat.messages.length > 0 || chat.running));

  const referenceOptions = useMemo(
    () =>
      workspace.entries
        .filter(
          (entry) => entry.kind === 'note' || entry.kind === 'imported' || entry.kind === 'source',
        )
        .map((entry) => ({ key: entry.id, title: entry.name })),
    [workspace.entries],
  );

  // 首页来源点击：Canvas 资料去资料页；工作区内容跳到所属项目。
  const openSource = (key: string) => {
    if (key.startsWith('source:')) {
      onOpenSources();
      return;
    }
    let entry = workspace.entries.find((item) => item.id === key);
    while (entry) {
      if (!entry.parentId) break;
      const parent = workspace.entries.find((item) => item.id === entry!.parentId);
      if (!parent) break;
      if (parent.kind === 'project') {
        onOpenProject(parent.id);
        return;
      }
      entry = parent;
    }
    onOpenSources();
  };

  const suggestions: { icon: LucideIcon; label: string; prompt: string }[] = [];
  const firstProject = projects[0];
  if (firstProject)
    suggestions.push({
      icon: NotebookPen,
      label: `继续「${firstProject.name}」`,
      prompt: `帮我看看「${firstProject.name}」的进展，整理下一步计划`,
    });
  if (canvas.connected)
    suggestions.push({
      icon: ListTodo,
      label: '近期作业',
      prompt: '帮我查询即将截止的作业，按课程整理',
    });
  suggestions.push({ icon: CalendarDays, label: '今天的日程', prompt: '帮我查看今天的日程安排' });

  const composer = (
    <ChatComposer
      busy={busy}
      configured={Boolean(chat?.configured)}
      hero={!conversation}
      inputRef={composerRef}
      model={chat?.model ?? ''}
      models={chat?.models ?? []}
      onAddReference={chatState.addReference}
      onChange={chatState.setPrompt}
      onModelChange={chatState.setModel}
      onRemoveReference={chatState.removeReference}
      onSend={() => void chatState.send()}
      onStop={chatState.stop}
      referenceOptions={referenceOptions}
      references={chatState.references}
      value={chatState.prompt}
    />
  );

  return (
    <div className={cn('flex h-full min-h-0 flex-col', !conversation && 'overflow-y-auto')}>
      <div className={cn(conversation && 'hidden', 'shrink-0', 'min-h-12')} />
      {chat && (chat.messages.length > 0 || chat.running) && (
        <motion.div
          animate={{ opacity: 1 }}
          className="flex min-h-0 flex-1 flex-col"
          initial={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
        >
          <div className="mx-auto flex w-full max-w-3xl items-center justify-end gap-1 px-4 pt-2">
            <Button
              aria-label="历史对话"
              onClick={() => setSessionsOpen(true)}
              size="icon-sm"
              title="历史对话"
              type="button"
              variant="ghost"
            >
              <History />
            </Button>
            <Button
              aria-label="新对话"
              disabled={busy}
              onClick={chatState.newChat}
              size="icon-sm"
              title="新对话"
              type="button"
              variant="ghost"
            >
              <SquarePen />
            </Button>
          </div>
          <ChatThread
            chat={chat}
            onOpenSource={openSource}
            onSaveNote={(text) => {
              void window.dela?.workspace
                .create({ parentId: null, kind: 'note', name: '助手笔记', text })
                .then(() => useWorkspace.getState().refresh())
                .catch(useWorkspace.getState().setError);
            }}
          />
        </motion.div>
      )}
      {!conversation && (
        <div className="shrink-0 px-6 pb-4 pt-10 text-center">
          {chat && !chat.configured ? (
            <div className="mx-auto max-w-md text-left">
              <ModelKeyForm onConfigured={chatState.refresh} />
            </div>
          ) : (
            <h1 className="text-2xl font-semibold tracking-tight">{greeting()}</h1>
          )}
        </div>
      )}
      <motion.div
        className="shrink-0 px-4 md:px-6"
        layout="position"
        transition={{ type: 'spring', duration: 0.4, bounce: 0.15 }}
      >
        <div className="mx-auto w-full max-w-3xl">
          {composer}
          {!conversation && (
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {suggestions.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    className="flex items-center gap-1.5 rounded-full border bg-card px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                    key={item.label}
                    onClick={() => {
                      chatState.setPrompt(item.prompt);
                      composerRef.current?.focus();
                    }}
                    type="button"
                  >
                    <Icon className="size-3.5" />
                    {item.label}
                  </button>
                );
              })}
            </div>
          )}
          {error && (
            <p className="mt-2 text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
          <p className="mt-2 text-center text-xs text-muted-foreground">
            对话、引用资料及工具读取的内容会提供给{chat?.providerName ?? '模型服务'}。
          </p>
        </div>
      </motion.div>
      {!conversation && (
        <div className="mx-auto w-full max-w-2xl shrink-0 px-6 pb-12">
          <div className="mt-10 flex items-center justify-between gap-4">
            <h2 className="text-xl font-semibold">继续工作</h2>
            <Button onClick={onNewProject}>
              <Plus />
              新建项目
            </Button>
          </div>
          <section
            aria-label="最近项目"
            className="mt-4 grid grid-cols-3 gap-4 max-lg:grid-cols-2 max-md:grid-cols-1"
          >
            {projects.map((project) => {
              const view = workspace.views[project.id];
              const last = workspace.entries.find((entry) => entry.id === view?.active);
              return (
                <button
                  key={project.id}
                  className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-5 text-left transition-colors hover:bg-muted/40"
                  onClick={() => onOpenProject(project.id)}
                >
                  <FolderKanban className="size-5 text-muted-foreground" />
                  <strong className="truncate text-base">{project.name}</strong>
                  <span className="truncate text-xs text-muted-foreground">
                    {last ? `继续 ${last.name}` : '打开工作区'}
                  </span>
                </button>
              );
            })}
          </section>
          {!projects.length && (
            <p className="mt-4 text-sm text-muted-foreground">
              还没有项目。可以先浏览课程资料，也可以围绕一个主题新建项目。
            </p>
          )}
        </div>
      )}
      <ChatSessions
        currentSessionId={chat?.sessionId ?? null}
        listSessions={chatState.listSessions}
        onDeleteSession={chatState.deleteSession}
        onOpenChange={setSessionsOpen}
        onOpenSession={chatState.openSession}
        open={sessionsOpen}
        scope="home"
      />
    </div>
  );
}
