// 课堂视频视图（M1 浏览+播放 / M2 复习面板）：左课程栏（仅有录播的课程）+ 场次流；
// 播放页为覆盖层（列表常驻挂载，返回还原滚动），仿水源 TopicReader 的两态结构。
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { MonitorPlay, RefreshCw } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { DesktopOnlyNotice } from '../../components/ui/desktop-only-notice';
import { cn } from '../../lib/utils';
import { formatBeginTime, formatDuration } from './format';
import { PlayerPage } from './PlayerPage';
import { useVideos } from './store';

export function VideosView() {
  if (!window.dela) {
    return (
      <DesktopOnlyNotice
        description="课堂视频的校园会话与播放直链只在主进程获取，不会暴露给浏览器。"
        title="课堂视频仅在 Dela 桌面端可用"
      />
    );
  }
  return <DesktopVideosView />;
}

function DesktopVideosView() {
  const init = useVideos((state) => state.init);
  const connected = useVideos((state) => state.connected);
  const playing = useVideos((state) => state.playing);
  const videoRequest = useVideos((state) => state.videoRequest);
  const syncError = useVideos((state) => state.syncError);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void init().finally(() => setReady(true));
  }, [init]);

  // App 层「在课堂视频页打开」深链（项目树引用）。
  useEffect(() => {
    if (!videoRequest) return;
    useVideos.getState().consumeVideoRequest();
    void useVideos.getState().openVideo(videoRequest.videoId);
  }, [videoRequest]);

  if (!ready) {
    return (
      <div className="grid h-full place-items-center text-sm text-muted-foreground">
        正在读取校园会话…
      </div>
    );
  }

  // 未登录且无缓存：登录卡（未登录绝不渲染成「无录课」）。
  if (!connected && useVideos.getState().videos.length === 0) {
    return (
      <div className="grid h-full place-items-center bg-background p-8">
        <div className="grid w-full max-w-[420px] gap-3 text-center">
          <MonitorPlay className="mx-auto size-8 text-muted-foreground" strokeWidth={1.8} />
          <h2 className="text-lg font-semibold tracking-tight">连接交大视频</h2>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            课堂录像使用校园统一身份（jAccount）登录，与课表共用同一会话。录课覆盖以教室设备为准，不是每门课都有。
          </p>
          <Button className="mx-auto mt-1" onClick={() => void useVideos.getState().login()}>
            重新登录
          </Button>
          {syncError && (
            <p className="text-xs text-destructive" role="alert">
              {syncError}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <VideosHeader />
      <div className="relative min-h-0 flex-1">
        {/* 列表常驻挂载：播放页覆盖其上，返回即时还原滚动位置。 */}
        <div
          aria-hidden={Boolean(playing)}
          className="absolute inset-0 overflow-y-auto"
          id="videos-feed-scroll"
        >
          <div className="mx-auto flex w-full max-w-5xl gap-4 px-4 pb-6 pt-3 max-md:px-3">
            <CourseRail />
            <VideoFeed />
          </div>
        </div>
        <AnimatePresence initial={false}>
          {playing ? (
            <motion.div
              animate={{ opacity: 1, x: 0 }}
              className="absolute inset-0 z-10 bg-background"
              exit={{ opacity: 0, x: 24 }}
              initial={{ opacity: 0, x: 24 }}
              key={playing.video.courseId}
              transition={{ duration: 0.16 }}
            >
              <PlayerPage />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}

function VideosHeader() {
  const connected = useVideos((state) => state.connected);
  const syncing = useVideos((state) => state.syncing);
  const lastSyncedAt = useVideos((state) => state.lastSyncedAt);
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-4 max-md:px-3">
      <h1 className="text-sm font-semibold">课堂视频</h1>
      <span className="truncate text-xs text-muted-foreground">
        {lastSyncedAt ? `更新于 ${formatSyncedAt(lastSyncedAt)}` : '尚未同步'}
      </span>
      <div className="flex-1" />
      {!connected && (
        <Button onClick={() => void useVideos.getState().login()} size="sm" variant="outline">
          重新登录
        </Button>
      )}
      <Button
        aria-label="刷新录课列表"
        disabled={syncing}
        onClick={() => void useVideos.getState().sync()}
        size="sm"
        variant="outline"
      >
        <RefreshCw className={cn('size-3.5', syncing && 'animate-spin')} />
        {syncing ? '同步中…' : '刷新'}
      </Button>
    </header>
  );
}

function formatSyncedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

const railRow = (active: boolean) =>
  cn(
    'flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors',
    active
      ? 'bg-accent font-medium text-accent-foreground'
      : 'text-foreground/75 hover:bg-accent/60 hover:text-foreground',
  );

function CourseRail() {
  const courses = useVideos((state) => state.courses);
  const activeTeclId = useVideos((state) => state.activeTeclId);
  const selectCourse = useVideos((state) => state.selectCourse);
  const total = useVideos((state) => state.videos.length);
  return (
    <nav aria-label="课程" className="grid w-44 shrink-0 content-start gap-0.5 max-md:hidden">
      <button
        className={railRow(activeTeclId === null)}
        onClick={() => selectCourse(null)}
        type="button"
      >
        <span className="truncate">全部课程</span>
        <span className="ml-auto text-xs text-muted-foreground">{total}</span>
      </button>
      {courses.map((course) => (
        <button
          className={railRow(activeTeclId === course.teclId)}
          key={course.teclId}
          onClick={() => selectCourse(course.teclId)}
          title={course.subjName}
          type="button"
        >
          <span className="truncate">{course.subjName}</span>
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
            {course.videoCount}
          </span>
        </button>
      ))}
    </nav>
  );
}

function VideoFeed() {
  const courses = useVideos((state) => state.courses);
  const videos = useVideos((state) => state.videos);
  const activeTeclId = useVideos((state) => state.activeTeclId);
  const openError = useVideos((state) => state.openError);
  const selectCourse = useVideos((state) => state.selectCourse);
  const items =
    activeTeclId === null ? videos : videos.filter((video) => video.teclId === activeTeclId);

  return (
    <div className="min-w-0 flex-1">
      {/* 窄屏课程栏退化为横向胶囊行（宽屏左栏隐藏时也保底可见）。 */}
      <div className="flex gap-1.5 overflow-x-auto pb-2 md:hidden">
        <button
          className={cn(
            'shrink-0 rounded-full border px-3 py-1 text-xs transition-colors',
            activeTeclId === null
              ? 'border-transparent bg-accent font-medium text-accent-foreground'
              : 'border-border text-muted-foreground hover:text-foreground',
          )}
          onClick={() => selectCourse(null)}
          type="button"
        >
          全部 {videos.length}
        </button>
        {courses.map((course) => (
          <button
            className={cn(
              'shrink-0 rounded-full border px-3 py-1 text-xs transition-colors',
              activeTeclId === course.teclId
                ? 'border-transparent bg-accent font-medium text-accent-foreground'
                : 'border-border text-muted-foreground hover:text-foreground',
            )}
            key={course.teclId}
            onClick={() => selectCourse(course.teclId)}
            type="button"
          >
            {course.subjName} {course.videoCount}
          </button>
        ))}
      </div>

      <SyncBanner />

      {openError && (
        <p
          className="mb-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
          role="alert"
        >
          {openError}
        </p>
      )}
      {items.length === 0 ? (
        <div className="grid place-items-center gap-2 py-16 text-center text-sm text-muted-foreground">
          <p>{videos.length === 0 ? '还没有同步到录课数据' : '该筛选下没有场次'}</p>
          <p className="text-xs">录课覆盖以教室设备为准；最近的场次可能仍在转写中。</p>
        </div>
      ) : (
        <ul className="grid gap-1.5">
          {items.map((video) => (
            <li key={video.courseId}>
              <button
                className="flex w-full gap-3 rounded-xl p-2 text-left transition-colors hover:bg-muted/70 focus-visible:bg-muted/70 focus-visible:outline focus-visible:outline-ring"
                onClick={() => void useVideos.getState().openVideo(video.courseId)}
                type="button"
              >
                <Thumb video={video} />
                <span className="min-w-0 flex-1 py-0.5">
                  <span className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-medium">
                      {formatBeginTime(video.beginTime)}
                      {video.letiNumber !== null ? ` · 第 ${video.letiNumber} 节` : ''}
                    </span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {formatDuration(video.vodTime)}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {[video.classroom, video.teacher].filter(Boolean).join(' · ') || '课堂录像'}
                  </span>
                  {(!video.transferReady || !video.pptReady) && (
                    <span className="mt-1 flex gap-1.5 text-[11px] text-muted-foreground">
                      {!video.transferReady && (
                        <span className="rounded-full bg-muted px-1.5 py-0.5">转写生成中</span>
                      )}
                      {!video.pptReady && (
                        <span className="rounded-full bg-muted px-1.5 py-0.5">课件处理中</span>
                      )}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 会话失效但有缓存时的顶部横幅（列表仍可浏览）。 */
function SyncBanner() {
  const connected = useVideos((state) => state.connected);
  const syncError = useVideos((state) => state.syncError);
  if (connected && !syncError) return null;
  return (
    <p
      className="mb-2 rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground"
      role="status"
    >
      {syncError ?? '校园会话已失效'}，正在展示本地缓存；点击右上角「重新登录」恢复同步。
    </p>
  );
}

function Thumb({ video }: { video: { thumbUrl: string | null; vodTime: number | null } }) {
  if (video.thumbUrl) {
    return (
      <img
        alt=""
        className="h-14 w-24 shrink-0 rounded-lg bg-muted object-cover"
        loading="lazy"
        src={video.thumbUrl}
      />
    );
  }
  return (
    <span className="grid h-14 w-24 shrink-0 place-items-center rounded-lg bg-muted text-xs text-muted-foreground">
      {formatDuration(video.vodTime) || '录像'}
    </span>
  );
}
