import { useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { AppShell, type ViewId } from './components/AppShell';
import { HomeView } from './features/home';
import { MailView } from './features/mail';
import { ProjectView } from './features/projects';
import { SettingsView } from './features/settings';
import { SourcesView } from './features/sources';
import { TimetableView } from './features/timetable';

export default function App() {
  const [view, setView] = useState<ViewId>('home');
  const [projectTab, setProjectTab] = useState('概览');

  return (
    <AppShell onNavigate={setView} view={view}>
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
            {view === 'home' && <HomeView onOpenProject={() => setView('project')} />}
            {view === 'project' && (
              <ProjectView activeTab={projectTab} onTabChange={setProjectTab} />
            )}
            {view === 'sources' && <SourcesView />}
            {view === 'mail' && <MailView />}
            {view === 'timetable' && <TimetableView />}
            {view === 'settings' && <SettingsView onOpenMail={() => setView('mail')} />}
          </motion.div>
        </AnimatePresence>
      </MotionConfig>
    </AppShell>
  );
}
