// 课堂视频页：登录 → 可折叠课程侧栏 + 播放器 两栏（无页头，
// 侧栏对齐资料面板：inset 底、紧凑头、eyebrow 小节标签、可拖宽度）。
import { useEffect, useState } from 'react';
import { KeyRound, Loader2, LogIn, MonitorPlay, RefreshCw } from 'lucide-react';
import { showToast } from '../../app/toasts';
import { Button } from '../../components/ui/button';
import { DesktopOnlyNotice } from '../../components/ui/desktop-only-notice';
import { PanelToggleButton } from '../../components/ui/panel-toggle';
import { Resizer } from '../../components/ui/resizer';
import { useViewportWidth } from '../../workbench/explorer-state';
import { cn } from '../../lib/utils';
import { useExperimental, useExperimentEnabled } from '../settings/experimental';
import { CourseList } from './CourseList';
import { DownloadsPanel } from './DownloadsPanel';
import { Player } from './Player';
import { useClassroom } from './store';

export function ClassroomView() {
  if (!window.dela) {
    return (
      <DesktopOnlyNotice
        description="交大视频的校园会话与签名媒体地址只在主进程保存和使用，不会暴露给浏览器。"
        title="课堂视频仅在 Dela 桌面端可用"
      />
    );
  }
  return <DesktopClassroomView />;
}

const SIDEBAR_DEFAULT_WIDTH = 300;
const SIDEBAR_MIN_WIDTH = 240;
const SIDEBAR_MAX_WIDTH = 360;
const widthStorageKey = 'dela.classroom.sidebarWidth';
const collapsedStorageKey = 'dela.classroom.sidebarCollapsed';

function DesktopClassroomView() {
  const phase = useClassroom((state) => state.phase);
  const courses = useClassroom((state) => state.courses);
  const coursesLoading = useClassroom((state) => state.coursesLoading);
  const init = useClassroom((state) => state.init);
  const refresh = useClassroom((state) => state.refresh);
  const connect = useClassroom((state) => state.connect);
  const connectBusy = useClassroom((state) => state.connectBusy);
  // 观看是常规功能；下载面板与下载按钮只在试验子项「课堂视频下载」开启时出现。
  const downloadEnabled = useExperimentEnabled('videoDownload');

  const [width, setWidth] = useState(() => {
    const stored = Number(localStorage.getItem(widthStorageKey));
    return Number.isFinite(stored) && stored >= SIDEBAR_MIN_WIDTH && stored <= SIDEBAR_MAX_WIDTH
      ? stored
      : SIDEBAR_DEFAULT_WIDTH;
  });
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(collapsedStorageKey) === '1',
  );
  const [resizing, setResizing] = useState(false);
  const viewportWidth = useViewportWidth();

  useEffect(() => {
    void init();
    void useExperimental.getState().load();
  }, [init]);

  // 宽度偏好防抖落盘；渲染宽度对窄视口钳制（与资料侧栏同款）。
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(widthStorageKey, String(width));
      } catch {
        /* localStorage 不可用时保持内存值。 */
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [width]);

  const toggleSidebar = () => {
    setCollapsed((value) => {
      try {
        localStorage.setItem(collapsedStorageKey, value ? '0' : '1');
      } catch {
        /* 只影响下次启动的初始态。 */
      }
      return !value;
    });
  };

  // 视口钳制：目录渲染宽度不超过视口约 30%（下限 240），偏好值仍按原值持久化。
  const effectiveWidth = Math.min(width, Math.max(240, Math.round(viewportWidth * 0.3)));

  return (
    <div className="flex h-full min-h-0 bg-surface">
      {phase === 'loading' && (
        <div className="grid h-full flex-1 place-items-center text-[13px] text-ink-3">
          正在连接交大视频…
        </div>
      )}
      {phase === 'connect' && <ConnectCard />}
      {phase === 'ready' && (
        <>
          <aside
            aria-label="课程与录像"
            className={cn(
              'flex min-h-0 shrink-0 flex-col overflow-hidden bg-inset transition-[width] duration-150 ease-out motion-reduce:transition-none',
              resizing && 'transition-none',
              collapsed && 'w-0',
            )}
            style={collapsed ? undefined : { width: effectiveWidth }}
          >
            <div
              className={cn(
                // 壳动内容不动：折叠动画中内容保持展开宽度、被外壳裁切并淡出。
                'flex min-h-0 flex-1 flex-col transition-opacity duration-150 motion-reduce:transition-none',
                collapsed && 'pointer-events-none opacity-0',
              )}
              style={collapsed ? undefined : { width: effectiveWidth }}
            >
              <div className="flex h-10 shrink-0 items-center gap-1 px-2">
                <PanelToggleButton
                  collapsed={collapsed}
                  controlsId="classroom-courses"
                  label="课程列表"
                  onToggle={toggleSidebar}
                />
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink-2">
                  课堂视频
                </span>
                <div className="flex shrink-0 items-center gap-0.5">
                  {/* 连接不稳定时的主动出口：重开官方窗口登录并刷新课程。 */}
                  <Button
                    aria-label="重新登录交大视频"
                    className="hover:bg-hover-2"
                    disabled={connectBusy}
                    onClick={() => {
                      void connect().then(() => {
                        const hint = useClassroom.getState().connectHint;
                        if (hint)
                          showToast({ variant: 'error', title: '登录未完成', description: hint });
                      });
                    }}
                    size="icon-xs"
                    title={connectBusy ? '等待登录…' : '重新登录交大视频（更新会话）'}
                    variant="ghost"
                  >
                    {connectBusy ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <KeyRound className="size-4" />
                    )}
                  </Button>
                  {downloadEnabled && <DownloadsPanel />}
                  <Button
                    aria-label="刷新课程"
                    className="hover:bg-hover-2"
                    disabled={coursesLoading}
                    onClick={() => void refresh()}
                    size="icon-xs"
                    title="刷新"
                    variant="ghost"
                  >
                    <RefreshCw className={cn('size-4', coursesLoading && 'animate-spin')} />
                  </Button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto" id="classroom-courses">
                <div className="px-3 pb-1 pt-3 text-[11px] font-medium tracking-wider text-ink-3/70">
                  课程{courses.length > 0 ? ` · 本学期 ${courses.length} 门` : ''}
                </div>
                <CourseList />
              </div>
            </div>
          </aside>
          {!collapsed && (
            <Resizer
              className={cn('bg-transparent', collapsed && 'hidden')}
              label="调整课程列表宽度"
              max={SIDEBAR_MAX_WIDTH}
              min={SIDEBAR_MIN_WIDTH}
              onChange={setWidth}
              onResizingChange={setResizing}
              value={width}
            />
          )}
          <PlayerSection collapsed={collapsed} onExpandSidebar={toggleSidebar} />
        </>
      )}
    </div>
  );
}

function PlayerSection({
  collapsed,
  onExpandSidebar,
}: {
  collapsed: boolean;
  onExpandSidebar: () => void;
}) {
  const course = useClassroom((state) =>
    state.courses.find((value) => value.id === state.selectedCourseId),
  );
  const video = useClassroom((state) =>
    state.videos[state.selectedCourseId ?? -1]?.find((value) => value.id === state.selectedVideoId),
  );

  if (!course || !video) {
    return (
      <section className="relative grid min-w-0 flex-1 place-items-center">
        {collapsed && (
          <div className="absolute left-2 top-2">
            <PanelToggleButton collapsed label="课程列表" onToggle={onExpandSidebar} />
          </div>
        )}
        <div className="flex flex-col items-center gap-2 text-[13px] text-ink-3">
          <MonitorPlay aria-hidden className="size-7 opacity-45" />
          <p>从左侧选择一场录像开始观看</p>
          <p className="text-[12px] text-ink-3/80">支持跳转、拖拽进度、音量与倍速，也可下载</p>
        </div>
      </section>
    );
  }
  // key 随场次变化：换场次重挂播放器，内部播放态全部重置。
  return (
    <section className="min-w-0 flex-1" key={video.id}>
      <Player
        collapsedSidebar={collapsed}
        course={course}
        onExpandSidebar={onExpandSidebar}
        video={video}
      />
    </section>
  );
}

function ConnectCard() {
  const connectHint = useClassroom((state) => state.connectHint);
  const connectBusy = useClassroom((state) => state.connectBusy);
  const connect = useClassroom((state) => state.connect);

  return (
    <div className="grid flex-1 place-items-center p-6">
      <section className="grid w-full max-w-[480px] justify-items-start gap-3 rounded-card border border-line bg-surface p-6 shadow-hairline">
        <div className="grid size-10 place-items-center rounded-card bg-hover-2">
          <MonitorPlay className="size-5" />
        </div>
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold tracking-tight">登录交大视频</h2>
          <p className="text-[13px] leading-relaxed text-ink-3">
            登录后读取本学期课程与课堂录像。登录在官方窗口完成，校园会话与课表共用。
          </p>
        </div>
        {connectHint ? <p className="break-words text-[12px] text-red">{connectHint}</p> : null}
        <Button disabled={connectBusy} onClick={() => void connect()}>
          <LogIn className="size-4" />
          {connectBusy ? '等待登录…' : '登录'}
        </Button>
      </section>
    </div>
  );
}
