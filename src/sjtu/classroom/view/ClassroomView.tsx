import { useState } from 'react';
import { KeyRound, LogIn, MonitorPlay, RefreshCw } from 'lucide-react';
import { Button } from '../../../ui/button';
import { ConnectCard } from '../../../ui/connect-card';
import { DesktopOnlyNotice } from '../../../ui/desktop-only-notice';
import { PanelToggleButton } from '../../../ui/panel-toggle';
import { Resizer, useResizerWidth } from '../../../ui/resizer';
import { useViewportWidth } from '../../../ui/use-viewport-width';
import { cn } from '../../../ui/cn';
import { CourseList, CoursePicker } from './CourseList';
import { TranscriptPanel } from './TranscriptPanel';
import { SegmentedControl } from '../../../ui/segmented-control';
import { DownloadsPanel } from './DownloadsPanel';
import { Player } from './Player';
import { useClassroomPreferences } from './store';
import { useConnect, useCourses, useSelection } from './use-classroom';
import { Spinner } from '../../../ui/spinner';

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

const SIDEBAR_MIN_WIDTH = 240;
const SIDEBAR_MAX_WIDTH = 360;

function DesktopClassroomView() {
  const courses = useCourses();
  const connect = useConnect();
  // 没有数据时重读会回到 pending；失败过就停在登录卡，按钮显示读取进度。
  const phase = courses.data ? 'ready' : courses.errorUpdateCount > 0 ? 'connect' : 'loading';

  const { width, resizing, onChange, onResizingChange } = useResizerWidth(
    useClassroomPreferences((state) => state.sidebarWidth),
    (sidebarWidth) => useClassroomPreferences.setState({ sidebarWidth }),
  );
  const collapsed = useClassroomPreferences((state) => state.sidebarCollapsed);
  const [sidebarTab, setSidebarTab] = useState<'节次' | '语音'>('节次');
  const viewportWidth = useViewportWidth();

  const toggleSidebar = () => useClassroomPreferences.setState({ sidebarCollapsed: !collapsed });

  // 视口钳制：目录渲染宽度不超过视口约 30%（下限 240），偏好值仍按原值持久化。
  const effectiveWidth = Math.min(width, Math.max(240, Math.round(viewportWidth * 0.3)));

  return (
    <div className="flex h-full min-h-0 bg-surface">
      {phase === 'loading' && (
        <div className="grid h-full flex-1 place-items-center text-sm text-ink-3">
          正在连接交大视频…
        </div>
      )}
      {phase === 'connect' && (
        <ClassroomConnect
          coursesLoading={courses.isFetching}
          connecting={connect.isPending}
          onConnect={() => connect.mutate()}
        />
      )}
      {phase === 'ready' && (
        <>
          <aside
            aria-label="课程与录像"
            className={cn(
              'flex min-h-0 shrink-0 flex-col overflow-hidden bg-inset transition-[width] duration-base ease-out motion-reduce:transition-none',
              resizing && 'transition-none',
              collapsed && 'w-0',
            )}
            style={collapsed ? undefined : { width: effectiveWidth }}
          >
            <div
              className={cn(
                // 壳动内容不动：折叠动画中内容保持展开宽度、被外壳裁切并淡出。
                'flex min-h-0 flex-1 flex-col transition-opacity duration-base motion-reduce:transition-none',
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
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink-2">
                  课堂视频
                </span>
                <div className="flex shrink-0 items-center gap-0.5">
                  {/* 连接不稳定时的主动出口：重开官方窗口登录并刷新课程。 */}
                  <Button
                    aria-label="重新登录交大视频"
                    className="hover:bg-hover-strong"
                    disabled={connect.isPending}
                    onClick={() => connect.mutate()}
                    size="icon-xs"
                    title={connect.isPending ? '等待登录…' : '重新登录交大视频（更新会话）'}
                    variant="ghost"
                  >
                    {connect.isPending ? <Spinner /> : <KeyRound className="size-4" />}
                  </Button>
                  <DownloadsPanel />
                  <Button
                    aria-label="刷新课程"
                    className="hover:bg-hover-strong"
                    disabled={courses.isFetching}
                    onClick={() => void courses.refetch()}
                    size="icon-xs"
                    title="刷新"
                    variant="ghost"
                  >
                    <RefreshCw className={cn('size-4', courses.isFetching && 'animate-spin')} />
                  </Button>
                </div>
              </div>
              <CoursePicker />
              <div className="px-3 pb-3">
                <SegmentedControl
                  options={['节次', '语音']}
                  value={sidebarTab}
                  onChange={setSidebarTab}
                  className="w-full"
                />
              </div>
              <div className="flex min-h-0 flex-1 flex-col" id="classroom-courses">
                {sidebarTab === '节次' ? (
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    <CourseList />
                  </div>
                ) : (
                  <TranscriptPanel />
                )}
              </div>
            </div>
          </aside>
          {!collapsed && (
            <Resizer
              className={cn('bg-transparent', collapsed && 'hidden')}
              label="调整课程列表宽度"
              max={SIDEBAR_MAX_WIDTH}
              min={SIDEBAR_MIN_WIDTH}
              onChange={onChange}
              onResizingChange={onResizingChange}
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
  const { course, video } = useSelection();

  if (!course || !video) {
    return (
      <section className="relative grid min-w-0 flex-1 place-items-center">
        {collapsed && (
          <div className="absolute left-2 top-2">
            <PanelToggleButton collapsed label="课程列表" onToggle={onExpandSidebar} />
          </div>
        )}
        <div className="flex flex-col items-center gap-2 text-sm text-ink-3">
          <MonitorPlay aria-hidden className="size-7 opacity-45" />
          <p>从左侧选择一场录像开始观看</p>
          <p className="text-xs text-ink-3/80">支持跳转、拖拽进度、音量与倍速，也可下载</p>
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

function ClassroomConnect({
  connecting,
  coursesLoading,
  onConnect,
}: {
  connecting: boolean;
  coursesLoading: boolean;
  onConnect: () => void;
}) {
  // 登录窗口阶段与登录后的课程拉取都算进行中：按钮停在对应文案，不再退回「登录」。
  const busy = connecting || coursesLoading;

  return (
    <div className="grid flex-1 place-items-center p-6">
      <ConnectCard
        description="登录后读取本学期课程与课堂录像。已连接 Canvas 时自动登录，否则在官方窗口完成，校园会话与课表共用。"
        icon={MonitorPlay}
        title="登录交大视频"
      >
        <Button disabled={busy} onClick={onConnect}>
          {busy ? <Spinner /> : <LogIn className="size-4" />}
          {connecting ? '等待登录…' : coursesLoading ? '正在获取视频列表…' : '登录'}
        </Button>
      </ConnectCard>
    </div>
  );
}
