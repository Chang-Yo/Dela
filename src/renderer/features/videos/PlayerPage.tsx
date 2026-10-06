// 播放页：双路画面切换（切换保留进度与播放态）、右栏复习页签（信息/章节/字幕/课件）。
// 双路为两台设备的独立 MP4（一台录教师、一台录投影，平台无官方标注），单路播放 + 切换，
// 不做并排联动；切换时记住进度与播放态，画面尺寸不变、只换内容（视线稳定）。
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ExternalLink, FolderPlus, MonitorPlay } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import { AddToProjectDialog } from './AddToProjectDialog';
import { formatBeginTime, formatClock, formatDuration, formatSeconds } from './format';
import { useVideos, type PlayingState, type ReviewTab } from './store';
import type { VsjtuChapterNode, VsjtuPptPage } from '../../../shared/api';

const PORTAL_HOME = 'https://v.sjtu.edu.cn/';

export function PlayerPage() {
  const playing = useVideos((state) => state.playing);
  if (!playing) return null;
  return <Player playing={playing} />;
}

function Player({ playing }: { playing: PlayingState }) {
  const { video, info, infoError, viewIndex } = playing;
  const setViewIndex = useVideos((state) => state.setViewIndex);
  const closePlayer = useVideos((state) => state.closePlayer);
  const addOpen = useVideos((state) => state.addOpen);
  const videoRef = useRef<HTMLVideoElement>(null);
  /** 双路切换时保留进度与播放态；换场次时归零。 */
  const positionRef = useRef(0);
  const wasPlayingRef = useRef(false);
  const [currentSeconds, setCurrentSeconds] = useState(0);
  const view = info?.views[viewIndex];
  const viewUrl = view?.url ?? null;

  useEffect(() => {
    positionRef.current = 0;
    wasPlayingRef.current = false;
    setCurrentSeconds(0);
  }, [video.courseId]);

  // 画面切换：src 变化后恢复进度，播放态保持（切换前后视线不中断）。
  useEffect(() => {
    const element = videoRef.current;
    if (!element || !viewUrl) return;
    const onLoaded = () => {
      if (positionRef.current > 0) element.currentTime = positionRef.current;
      if (wasPlayingRef.current) void element.play().catch(() => {});
    };
    element.addEventListener('loadedmetadata', onLoaded);
    return () => element.removeEventListener('loadedmetadata', onLoaded);
  }, [viewUrl]);

  const seek = (seconds: number) => {
    const element = videoRef.current;
    if (!element) return;
    element.currentTime = seconds;
    setCurrentSeconds(seconds);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-2 max-md:px-1">
        <Button aria-label="返回列表" onClick={closePlayer} size="icon-sm" variant="ghost">
          <ArrowLeft className="size-4" />
        </Button>
        <h2 className="min-w-0 truncate text-sm font-medium">
          {playing.courseName} · {formatBeginTime(video.beginTime)}
          {video.letiNumber !== null ? ` · 第 ${video.letiNumber} 节` : ''}
        </h2>
        <div className="flex-1" />
        {info && info.views.length > 1 && (
          <div
            className="flex h-7 items-center rounded-md border border-border text-xs"
            role="group"
            aria-label="画面切换"
          >
            {info.views.map((item, index) => (
              <button
                aria-pressed={index === viewIndex}
                className={cn(
                  'h-full px-2.5 transition-colors first:rounded-l-md last:rounded-r-md',
                  index === viewIndex
                    ? 'bg-accent font-medium text-accent-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                key={item.viewNum}
                onClick={() => setViewIndex(index)}
                type="button"
              >
                画面 {index + 1}
              </button>
            ))}
          </div>
        )}
        <Button
          aria-label="在浏览器打开交大视频"
          onClick={() => void window.dela?.vsjtu.openLink(PORTAL_HOME).catch(() => {})}
          size="icon-sm"
          title="打开原文（交大视频平台）"
          variant="ghost"
        >
          <ExternalLink className="size-4" />
        </Button>
        <Button onClick={() => useVideos.getState().openAddDialog()} size="sm" variant="outline">
          <FolderPlus className="size-3.5" />
          加入项目
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="grid min-h-[220px] min-w-0 flex-1 place-items-center bg-black">
          {infoError ? (
            <div className="grid max-w-sm gap-2 p-6 text-center">
              <p className="text-sm text-white/85">{infoError}</p>
              <Button
                className="mx-auto"
                onClick={() => void useVideos.getState().openVideo(video.courseId)}
                size="sm"
                variant="outline"
              >
                重试
              </Button>
            </div>
          ) : viewUrl ? (
            <video
              className="h-full w-full object-contain"
              controls
              onLoadedMetadata={() => setCurrentSeconds(videoRef.current?.currentTime ?? 0)}
              onPause={() => {
                wasPlayingRef.current = false;
                positionRef.current = videoRef.current?.currentTime ?? positionRef.current;
              }}
              onPlay={() => {
                wasPlayingRef.current = true;
              }}
              onTimeUpdate={(event) => {
                positionRef.current = event.currentTarget.currentTime;
                setCurrentSeconds(event.currentTarget.currentTime);
              }}
              ref={videoRef}
              src={viewUrl}
            />
          ) : (
            <p className="text-sm text-white/60">正在获取播放地址…</p>
          )}
        </div>
        <ReviewPanel onSeek={seek} playing={playing} seconds={currentSeconds} />
      </div>
      <AddToProjectDialog
        onClose={() => useVideos.getState().closeAddDialog()}
        open={addOpen}
        video={video}
      />
    </div>
  );
}

const tabs: Array<{ id: ReviewTab; label: string }> = [
  { id: 'info', label: '信息' },
  { id: 'chapters', label: '章节' },
  { id: 'transcript', label: '字幕' },
  { id: 'ppt', label: '课件' },
];

function ReviewPanel({
  onSeek,
  playing,
  seconds,
}: {
  onSeek: (seconds: number) => void;
  playing: PlayingState;
  seconds: number;
}) {
  const tab = playing.tab;
  const setTab = useVideos((state) => state.setTab);
  return (
    <aside className="flex min-h-0 w-full shrink-0 flex-col border-t border-border/60 md:w-80 md:border-l md:border-t-0 max-md:max-h-[46%]">
      <div
        className="flex h-9 shrink-0 items-stretch gap-0.5 border-b border-border/60 px-1"
        role="tablist"
      >
        {tabs.map((item) => (
          <button
            aria-selected={tab === item.id}
            className={cn(
              'my-0.5 rounded-md px-2.5 text-xs transition-colors',
              tab === item.id
                ? 'bg-accent font-medium text-accent-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
            key={item.id}
            onClick={() => void setTab(item.id)}
            role="tab"
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'info' && <InfoTab playing={playing} />}
        {tab === 'chapters' && <ChaptersTab onSeek={onSeek} playing={playing} seconds={seconds} />}
        {tab === 'transcript' && (
          <TranscriptTab onSeek={onSeek} playing={playing} seconds={seconds} />
        )}
        {tab === 'ppt' && <PptTab onSeek={onSeek} playing={playing} seconds={seconds} />}
      </div>
    </aside>
  );
}

function InfoTab({ playing }: { playing: PlayingState }) {
  const { video } = playing;
  const rows: Array<[string, string | null]> = [
    ['课程', playing.courseName],
    ['时间', video.beginTime || null],
    ['节次', video.letiNumber !== null ? `第 ${video.letiNumber} 节` : null],
    ['教室', video.classroom],
    ['教师', video.teacher],
    ['时长', formatDuration(video.vodTime) || null],
    ['转写', video.transferReady ? '已生成' : '生成中'],
    ['课件', video.pptReady ? '已就绪' : '处理中'],
  ];
  return (
    <div className="grid gap-1 px-3 py-3 text-sm">
      {rows
        .filter(([, value]) => value !== null)
        .map(([label, value]) => (
          <div className="flex gap-2" key={label}>
            <span className="w-10 shrink-0 text-xs text-muted-foreground">{label}</span>
            <span className="min-w-0 flex-1">{value}</span>
          </div>
        ))}
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        字幕与课件为机器生成，仅作复习参考；Dela 内播放不计入官方观看记录。
      </p>
    </div>
  );
}

function ChaptersTab({
  onSeek,
  playing,
  seconds,
}: {
  onSeek: (seconds: number) => void;
  playing: PlayingState;
  seconds: number;
}) {
  const { nodes, loading, error } = playing.chapters;
  return (
    <div>
      <ReviewState error={error} loading={loading && nodes === null} name="章节" />
      {nodes && nodes.length > 0 && (
        <>
          <p className="px-3 pb-1 pt-2 text-[11px] text-muted-foreground">
            AI 知识点（带时间段）；点击跳转。
          </p>
          <ChaptersTree nodes={nodes} onSeek={onSeek} seconds={seconds} />
        </>
      )}
      {nodes && nodes.length === 0 && !loading && !error && (
        <EmptyReview name="章节" hint="本节暂无 AI 知识点（生成有滞后，稍后刷新重进本页即可）。" />
      )}
    </div>
  );
}

/** 知识点树（AI mindmap）：默认展开，叶子时间段命中当前播放区间时高亮。 */
function ChaptersTree({
  nodes,
  onSeek,
  seconds,
  depth = 0,
}: {
  nodes: readonly VsjtuChapterNode[];
  onSeek: (seconds: number) => void;
  seconds: number;
  depth?: number;
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return (
    <ul className="px-2 py-2 text-sm">
      {nodes.map((node, index) => {
        const key = `${depth}-${index}-${node.label}`;
        const active =
          node.ranges.length > 0 &&
          node.ranges.some((range) => seconds >= range.start && seconds <= range.end);
        const hasChildren = node.children.length > 0;
        const open = !collapsed.has(key);
        return (
          <li key={key}>
            <div
              className={cn(
                'flex min-w-0 items-start gap-1 rounded-md px-1.5 py-1 transition-colors hover:bg-muted/70',
                active && 'bg-accent font-medium text-accent-foreground',
              )}
            >
              {hasChildren ? (
                <button
                  aria-label={open ? `收起 ${node.label}` : `展开 ${node.label}`}
                  className="mt-0.5 grid size-4 shrink-0 place-items-center text-muted-foreground"
                  onClick={() => toggle(key)}
                  type="button"
                >
                  <span className={cn('transition-transform', open && 'rotate-90')}>▸</span>
                </button>
              ) : (
                <span className="size-4 shrink-0" />
              )}
              <button
                className="min-w-0 flex-1 text-left"
                onClick={() => {
                  const first = node.ranges[0];
                  if (first) onSeek(first.start);
                }}
                title={node.ranges.map((range) => formatSeconds(range.start)).join(' / ')}
                type="button"
              >
                <span className="block break-words">{node.label}</span>
                {node.ranges.length > 0 && (
                  <span className="text-[11px] text-muted-foreground">
                    {formatSeconds(node.ranges[0]!.start)}
                  </span>
                )}
              </button>
            </div>
            {hasChildren && open && (
              <div className="ml-3 border-l border-border/60 pl-1">
                <ChaptersTree
                  depth={depth + 1}
                  nodes={node.children}
                  onSeek={onSeek}
                  seconds={seconds}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function TranscriptTab({
  onSeek,
  playing,
  seconds,
}: {
  onSeek: (seconds: number) => void;
  playing: PlayingState;
  seconds: number;
}) {
  const { lines, loading, error } = playing.transcript;
  const currentMs = seconds * 1000;
  const currentIndex = useMemo(() => {
    if (!lines || lines.length === 0) return -1;
    let found = -1;
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index]!.beginMs <= currentMs) found = index;
      else break;
    }
    return found;
  }, [lines, currentMs]);
  const listRef = useRef<HTMLDivElement>(null);
  // 播放推进时把当前句滚入视野（用户手动滚动后由浏览器保持位置，nearest 不打断）。
  useEffect(() => {
    if (currentIndex < 0) return;
    listRef.current
      ?.querySelector(`[data-line="${currentIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [currentIndex]);
  return (
    <div ref={listRef}>
      <ReviewState error={error} loading={loading && lines === null} name="字幕" />
      {lines && lines.length > 0 && (
        <>
          <p className="px-3 pb-1 pt-2 text-[11px] text-muted-foreground">
            机器转写，可能有同音字误差（{lines.length} 句）；点击句子跳转。
          </p>
          <ul className="px-2 pb-3 text-sm">
            {lines.map((line, index) => (
              <li key={`${line.beginMs}-${index}`}>
                <button
                  className={cn(
                    'grid w-full grid-cols-[3.2rem_1fr] gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-muted/70',
                    index === currentIndex && 'bg-accent text-accent-foreground',
                  )}
                  data-line={index}
                  onClick={() => onSeek(line.beginMs / 1000)}
                  type="button"
                >
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {formatClock(line.beginMs)}
                  </span>
                  <span className="min-w-0">{line.text}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {lines && lines.length === 0 && !loading && !error && (
        <EmptyReview name="字幕" hint="转写仍在生成中，稍后刷新重进本页即可看到。" />
      )}
    </div>
  );
}

function PptTab({
  onSeek,
  playing,
  seconds,
}: {
  onSeek: (seconds: number) => void;
  playing: PlayingState;
  seconds: number;
}) {
  const { pages, loading, error } = playing.ppt;
  const currentPage = useMemo(() => {
    if (!pages || pages.length === 0) return null;
    let found: VsjtuPptPage | null = null;
    for (const page of pages) if (page.seekTime !== null && page.seekTime <= seconds) found = page;
    return found ?? pages[0]!;
  }, [pages, seconds]);
  return (
    <div>
      <ReviewState error={error} loading={loading && pages === null} name="课件" />
      {pages && pages.length > 0 && (
        <>
          <p className="px-3 pb-1 pt-2 text-[11px] text-muted-foreground">
            PPT 逐页快照（{pages.length} 页）；点击跳到翻页时刻。
          </p>
          <ul className="grid gap-2 px-3 pb-3">
            {pages.map((page) => (
              <li key={page.index}>
                <button
                  className={cn(
                    'grid w-full gap-1 rounded-lg border p-1.5 text-left transition-colors hover:bg-muted/70',
                    currentPage?.index === page.index
                      ? 'border-primary/60 bg-accent/60'
                      : 'border-border/60',
                  )}
                  onClick={() => page.seekTime !== null && onSeek(page.seekTime)}
                  type="button"
                >
                  <img
                    alt={`第 ${page.index} 页`}
                    className="w-full rounded bg-muted object-contain"
                    loading="lazy"
                    src={page.imageUrl}
                  />
                  <span className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>第 {page.index} 页</span>
                    {page.seekTime !== null && <span>{formatSeconds(page.seekTime)}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {pages && pages.length === 0 && !loading && !error && (
        <EmptyReview name="课件" hint="课件切片仍在处理中，稍后刷新重进本页即可看到。" />
      )}
    </div>
  );
}

/** 复习页签的加载/错误/空共用展示；正常数据由各页签自行渲染。 */
function ReviewState({
  error,
  loading,
  name,
}: {
  error: string | null;
  loading: boolean;
  name: string;
}) {
  if (loading) return <p className="px-3 py-4 text-sm text-muted-foreground">正在加载{name}…</p>;
  if (error)
    return (
      <div className="grid gap-2 px-3 py-4">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  return null;
}

function EmptyReview({ name, hint }: { name: string; hint: string }) {
  return (
    <div className="grid gap-1 px-3 py-6 text-center">
      <MonitorPlay className="mx-auto size-5 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">暂无{name}</p>
      <p className="text-xs text-muted-foreground/80">{hint}</p>
    </div>
  );
}
