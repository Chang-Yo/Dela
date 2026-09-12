import { useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { AppShell, type MobileDrawer, type ViewId } from './components/AppShell';
import { HomeView } from './features/home';
import { MailView } from './features/mail';
import { ProjectView } from './features/projects';
import { SettingsView } from './features/settings';
import { SourcesView } from './features/sources';
import { TimetableView } from './features/timetable';

export default function App() {
  const [view, setView] = useState<ViewId>('home');
  const [backStack, setBackStack] = useState<ViewId[]>([]);
  const [forwardStack, setForwardStack] = useState<ViewId[]>([]);
  const [projectTab, setProjectTab] = useState('概览');
  const [mailComposeDirty, setMailComposeDirty] = useState(false);
  const [mobileDrawer, setMobileDrawer] = useState<MobileDrawer | null>(null);

  // 后退/前进与普通导航共用同一守卫:用户取消确认时导航中止,历史保持不动。
  const leaveMail = (next: ViewId) => {
    if (view !== 'mail' || next === 'mail') return true;
    if (mailComposeDirty && !window.confirm('这封邮件不会保存。确定抛弃并离开吗？')) return false;
    setMailComposeDirty(false);
    return true;
  };

  const navigate = (next: ViewId) => {
    if (next === view || !leaveMail(next)) return;
    setBackStack((stack) => [...stack, view]);
    setForwardStack([]);
    setView(next);
  };

  const goBack = () => {
    const prev = backStack[backStack.length - 1];
    if (prev === undefined || !leaveMail(prev)) return;
    setBackStack((stack) => stack.slice(0, -1));
    setForwardStack((stack) => [view, ...stack]);
    setView(prev);
  };

  const goForward = () => {
    const next = forwardStack[0];
    if (next === undefined || !leaveMail(next)) return;
    setBackStack((stack) => [...stack, view]);
    setForwardStack((stack) => stack.slice(1));
    setView(next);
  };

  return (
    <AppShell
      canBack={backStack.length > 0}
      canForward={forwardStack.length > 0}
      mobileDrawer={mobileDrawer}
      onBack={goBack}
      onMobileDrawerChange={setMobileDrawer}
      onForward={goForward}
      onNavigate={navigate}
      view={view}
    >
      <MotionConfig reducedMotion="user">
        <AnimatePresence initial={false} mode="wait">
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="flex min-h-0 flex-1 flex-col"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0, y: 4 }}
            key={view}
            transition={{ duration: 0.16 }}
          >
            {view === 'home' && <HomeView onOpenProject={() => navigate('project')} />}
            {view === 'project' && (
              <ProjectView activeTab={projectTab} onTabChange={setProjectTab} />
            )}
            {view === 'sources' && <SourcesView />}
            {view === 'mail' && (
              <MailView
                mobileDrawerOpen={mobileDrawer === 'mail'}
                onComposeDirtyChange={setMailComposeDirty}
                onMobileDrawerClose={() => setMobileDrawer(null)}
              />
            )}
            {view === 'timetable' && <TimetableView />}
            {view === 'settings' && (
              <SettingsView
                onOpenMail={() => navigate('mail')}
                onOpenTimetable={() => navigate('timetable')}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </MotionConfig>
    </AppShell>
  );
}
