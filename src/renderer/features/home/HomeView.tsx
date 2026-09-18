import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  CalendarDays,
  FolderKanban,
  History,
  ListTodo,
  Plus,
  SquarePen,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import { useWorkspace } from '../projects/workspace';
import { ChatComposer, ChatSessions, ChatThread, ModelKeyForm, useChat } from '../chat';

// 闲置态轮播的英文问候：按时间段给初始值，其余作为后续轮换。
const GREETING_INTERVAL_MS = 2000000;
const greetings = [
  'Wanna build something with Dela?',
  'Welcome back',
  'Ready to continue?',
  'What are we working on?',
  'Dela is here! Anything want to do?',
];

function initialGreeting() {
  const hour = new Date().getHours();
  if (hour < 5) return 'Working late';
  if (hour < 11) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function HomeView({
  onOpenProject,
  onNewProject,
  onOpenSources,
  chatRequest,
}: {
  onOpenProject: (id: string) => void;
  onNewProject: () => void;
  onOpenSources: () => void;
  chatRequest?: { sessionId: string };
}) {
  const workspace = useWorkspace((s) => s.workspace);
  const canvas = useWorkspace((s) => s.canvas);
  const projects = workspace.entries.filter((entry) => entry.kind === 'project');
  const chatState = useChat('home', chatRequest);
  const { chat, busy, error } = chatState;
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const reduceMotion = useReducedMotion();
  const [greeting, setGreeting] = useState(initialGreeting);

  // busy 涵盖「已发送但推送未到」的瞬间：点击发送立即进入会话态。
  const conversation = Boolean(chat && (busy || chat.messages.length > 0 || chat.running));

  // 温和的问候轮播：进入会话态或用户偏好减少动态效果时停在当前问候。
  useEffect(() => {
    if (conversation || reduceMotion) return;
    const timer = setInterval(() => {
      setGreeting((current) => greetings[(greetings.indexOf(current) + 1) % greetings.length]!);
    }, GREETING_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [conversation, reduceMotion]);

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

  // 闲置态 composer 上方的快捷入口：新建项目直达，其余直接发送对应提问进入对话。
  const quickActions: { icon: LucideIcon; label: string; run: () => void }[] = [
    { icon: Plus, label: '新建项目', run: onNewProject },
  ];
  const askPrompt = (prompt: string) => () => void chatState.send(prompt);
  if (canvas.connected)
    quickActions.push({
      icon: ListTodo,
      label: '近期作业',
      run: askPrompt('帮我查询即将截止的作业，按课程整理'),
    });
  quickActions.push({
    icon: CalendarDays,
    label: '今天的日程',
    run: askPrompt('帮我查看今天的日程安排'),
  });

  const composer = (
    <ChatComposer
      attachments={chatState.attachments}
      busy={busy}
      configured={Boolean(chat?.configured)}
      effort={chat?.effort ?? null}
      effortLevels={chat?.effortLevels ?? []}
      hero={!conversation}
      model={chat?.model ?? ''}
      onAddAttachmentFile={chatState.addAttachmentFile}
      onAddAttachmentView={chatState.addAttachmentView}
      onAddReference={chatState.addReference}
      onChange={chatState.setPrompt}
      onEffortSelect={chatState.selectEffort}
      onModelSelect={chatState.selectModel}
      onRemoveAttachment={chatState.removeAttachment}
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
      {/* 历史/新对话常驻左上角：闲置与会话两态位置不变，历史打开悬浮面板。 */}
      <div className="flex shrink-0 items-center gap-1 px-3 pt-2">
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
      {chat && (chat.messages.length > 0 || chat.running) && (
        <motion.div
          animate={{ opacity: 1 }}
          className="flex min-h-0 flex-1 flex-col"
          initial={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
        >
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
        <>
          {/* 弹性留白把内容压向视口下部：问候语约在上部 1/4，composer 视觉重心约在 2/3；溢出时随空间收缩为 0。 */}
          <div className="grow-5" />
          <div className="shrink-0 px-6 text-center">
            {chat && !chat.configured ? (
              <div className="mx-auto max-w-md text-left">
                <ModelKeyForm onConfigured={chatState.refresh} />
              </div>
            ) : (
              <h1 className="text-3xl font-semibold tracking-tight">
                <AnimatePresence initial={false} mode="wait">
                  <motion.span
                    animate={{ opacity: 1 }}
                    className="block"
                    exit={{ opacity: 0 }}
                    initial={{ opacity: 0 }}
                    key={greeting}
                    transition={{ duration: 0.3 }}
                  >
                    {greeting}
                  </motion.span>
                </AnimatePresence>
              </h1>
            )}
          </div>
          {/* 与 composer 同宽同 padding，快捷入口与其左边缘对齐。 */}
          <div className="mt-8 shrink-0 px-4 md:px-6">
            <div className="mx-auto flex w-full max-w-3xl flex-wrap gap-2">
              {quickActions.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    className="flex items-center gap-1.5 rounded-full border bg-card px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                    key={item.label}
                    onClick={item.run}
                    type="button"
                  >
                    <Icon className="size-3.5" />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
      <motion.div
        className={cn('shrink-0 px-4 md:px-6', conversation ? 'pt-2 pb-4' : 'mt-4')}
        layout="position"
        transition={{ type: 'spring', duration: 0.4, bounce: 0.15 }}
      >
        <div className="mx-auto w-full max-w-3xl">
          {composer}
          {error && (
            <p className="mt-2 break-words text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
      </motion.div>
      {!conversation && (
        <div className="mx-auto w-full max-w-3xl shrink-0 px-6 pb-12">
          {/* 区块语义由卡片自解释，去掉大标题；aria-label 保留读屏上下文。 */}
          <section
            aria-label="最近项目"
            className="mt-8 grid grid-cols-3 gap-4 max-lg:grid-cols-2 max-md:grid-cols-1"
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
                    {last ? last.name : '打开工作区'}
                  </span>
                </button>
              );
            })}
          </section>
          {!projects.length && (
            <p className="mt-8 text-sm text-muted-foreground">
              还没有项目。可以先浏览课程资料，也可以围绕一个主题新建项目。
            </p>
          )}
        </div>
      )}
      {/* 与上方弹性留白按 2:5 分摊剩余空间（composer 视觉重心约在视口 2/3 处）；溢出时均收缩为 0。 */}
      {!conversation && <div className="grow-2" />}
      <ChatSessions
        currentSessionId={chat?.sessionId ?? null}
        listSessions={chatState.listSessions}
        onDeleteSession={chatState.deleteSession}
        onOpenChange={setSessionsOpen}
        onOpenSession={chatState.openSession}
        open={sessionsOpen}
        scope="home"
        variant="panel"
      />
    </div>
  );
}
