// 课堂视频播放器：常驻控制条（播放/进度/音量/倍速/全屏），多画面 SegmentedControl 切换。
// 键盘：Space 播放暂停、←→ ±5s、↑↓ 音量（焦点在按钮/滑杆上时让位于原生行为）。
import { useEffect, useRef, useState } from 'react';
import type * as React from 'react';
import {
  Check,
  Download,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { IconButton } from '../../../ui/icon-button';
import { SegmentedControl } from '../../../ui/segmented-control';
import { Slider } from '../../../ui/slider';
import { Button } from '../../../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '../../../ui/popover';
import { PanelToggleButton } from '../../../ui/panel-toggle';
import { errorMessage } from '../../../core/protocol/contract';
import { showToast } from '../../../ui/toast';
import type { ClassroomVideo, VideoCourse } from '../contract';
import { formatTime, lectureFileName, lectureMeta, lectureTitle } from './player-format';
import {
  clearPlaybackProgress,
  createProgressTracker,
  readPlaybackProgress,
  resumePlaybackTime,
} from './progress';
import { SeekBar } from './SeekBar';
import { useClassroom } from './store';
import { classroomClient, useStreams } from './use-classroom';
import { Spinner } from '../../../ui/spinner';

const RATE_OPTIONS = [0.75, 1, 1.25, 1.5, 2];
const VOLUME_KEY = 'dela.classroom.volume';
const RATE_KEY = 'dela.classroom.rate';
const RESUME_NOTICE_MS = 5000;

function readNumber(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function writeNumber(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* localStorage 不可用不影响播放 */
  }
}

export function Player({
  course,
  video,
  collapsedSidebar = false,
  onExpandSidebar,
}: {
  course: VideoCourse;
  video: ClassroomVideo;
  /** 侧栏折叠时在标题行首给一个展开按钮，布局不因折叠跳动。 */
  collapsedSidebar?: boolean;
  onExpandSidebar?: () => void;
}) {
  const streamsQuery = useStreams(video.id);
  const streams = streamsQuery.data;
  const streamsLoading = !streams && streamsQuery.isFetching;
  const streamsError = streamsQuery.error ? errorMessage(streamsQuery.error) : null;
  const seekRequest = useClassroom((state) => state.seekRequest);

  const [activeIndex, setActiveIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reloadSeq, setReloadSeq] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [volume, setVolume] = useState(() => Math.min(1, Math.max(0, readNumber(VOLUME_KEY, 1))));
  const [rate, setRate] = useState(() => readNumber(RATE_KEY, 1));
  const [fullscreen, setFullscreen] = useState(false);
  const [resumeNotice, setResumeNotice] = useState<number | null>(null);
  // 续播提示每场只出现一次；切换画面会再次触发 loadedmetadata。
  const [resumeOffered, setResumeOffered] = useState(false);
  // 外层按场次加 key，换场次即重挂，进度记录随之新建。
  const [progress] = useState(() => createProgressTracker(video.id));
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const active = streams ? streams[Math.min(activeIndex, streams.length - 1)] : undefined;
  const playbackUrl = active?.playbackUrl;

  useEffect(() => {
    const element = videoRef.current;
    if (!element || seekRequest?.videoId !== video.id) return;
    const applySeek = () => {
      if (useClassroom.getState().seekRequest !== seekRequest) return;
      const time = Math.min(
        seekRequest.seconds,
        Number.isFinite(element.duration) ? element.duration : seekRequest.seconds,
      );
      element.currentTime = time;
      setCurrentTime(time);
      setResumeNotice(null);
      progress.record(time, true);
      useClassroom.setState({ seekRequest: null, playbackTime: time });
    };
    if (element.readyState >= 1) applySeek();
    else element.addEventListener('loadedmetadata', applySeek, { once: true });
    return () => element.removeEventListener('loadedmetadata', applySeek);
  }, [seekRequest, video.id, playbackUrl, reloadSeq, progress]);

  // 续播提示按官方习惯短暂出现；自动消失，不挡住后续操作。
  useEffect(() => {
    if (resumeNotice === null) return;
    const timer = setTimeout(() => setResumeNotice(null), RESUME_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [resumeNotice]);

  // 页面隐藏或播放器卸载前再落一次盘。
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') progress.flush();
    };
    window.addEventListener('pagehide', progress.flush);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', progress.flush);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      progress.flush();
    };
  }, [progress]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const applyVolume = (next: number) => {
    const clamped = Math.min(1, Math.max(0, Math.round(next * 100) / 100));
    setVolume(clamped);
    writeNumber(VOLUME_KEY, clamped);
  };

  const applyRate = (next: number) => {
    setRate(next);
    writeNumber(RATE_KEY, next);
  };

  const togglePlay = () => {
    const element = videoRef.current;
    if (!element) return;
    if (element.paused) void element.play().catch(() => {});
    else element.pause();
  };

  const seek = (time: number) => {
    const element = videoRef.current;
    if (!element || !Number.isFinite(time)) return;
    element.currentTime = time;
    setCurrentTime(time);
    setResumeNotice(null);
    progress.record(time, true);
    useClassroom.setState({ playbackTime: time });
  };

  const restartFromBeginning = () => {
    clearPlaybackProgress(video.id);
    progress.reset(0);
    setResumeNotice(null);
    seek(0);
  };

  const download = async (view: number) => {
    try {
      await classroomClient.download({
        videoId: video.id,
        view,
        name: lectureFileName(course.name, video),
      });
    } catch (error) {
      showToast({ variant: 'error', title: '下载启动失败', description: errorMessage(error) });
    }
  };

  const selectView = (index: number) => {
    progress.record(videoRef.current?.currentTime ?? progress.position(), true);
    setResumeNotice(null);
    setActiveIndex(index);
  };

  // key 里带上重试序号：重挂 video 元素即重新发起整条加载链路。
  const retry = () => {
    setFailed(false);
    setReloadSeq((seq) => seq + 1);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest('button, input, [role="slider"]')) return;
    if (event.key === ' ') {
      event.preventDefault();
      togglePlay();
    } else if (event.key === 'ArrowLeft') {
      seek(Math.max(0, currentTime - 5));
    } else if (event.key === 'ArrowRight') {
      if (duration > 0) seek(Math.min(duration, currentTime + 5));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      applyVolume(volume + 0.05);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      applyVolume(volume - 0.05);
    }
  };

  const onLoadedMetadata = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    const element = event.currentTarget;
    const nextDuration = element.duration || 0;
    setDuration(nextDuration);
    // 文稿跳转优先于本地续播，避免同一场录像的两个恢复来源互相覆盖。
    setResumeOffered(true);
    if (seekRequest?.videoId === video.id) return;
    const saved = readPlaybackProgress(video.id);
    const resume = resumePlaybackTime(saved, nextDuration);
    if (resume === null) {
      if (saved !== null && nextDuration > 0) clearPlaybackProgress(video.id);
      setCurrentTime(0);
      progress.reset(0);
      useClassroom.setState({ playbackTime: 0 });
      return;
    }
    element.currentTime = resume;
    setCurrentTime(resume);
    progress.reset(resume);
    useClassroom.setState({ playbackTime: resume });
    if (!resumeOffered) setResumeNotice(resume);
  };

  const viewLabel = (index: number) => `画面${index + 1}`;
  const activeClamped = streams ? Math.min(activeIndex, streams.length - 1) : 0;

  return (
    <div
      className="flex h-full min-h-0 flex-col outline-none"
      onKeyDown={onKeyDown}
      ref={rootRef}
      tabIndex={0}
    >
      <div className="flex items-center gap-2 px-3 pt-2">
        {collapsedSidebar && onExpandSidebar && (
          <PanelToggleButton collapsed label="课程列表" onToggle={onExpandSidebar} />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">
            {course.name} · {lectureTitle(video)}
          </p>
          <p className="truncate text-xs tabular-nums text-ink-3">{lectureMeta(video)}</p>
        </div>
        {streams && streams.length > 1 && (
          <SegmentedControl
            onChange={(label) => selectView(Number(label.replace('画面', '')) - 1)}
            options={streams.map((_, index) => viewLabel(index))}
            value={viewLabel(activeClamped)}
          />
        )}
        <IconButton
          aria-label="下载当前画面"
          disabled={!active}
          onClick={() => active && void download(active.view)}
          title="下载当前画面"
        >
          {streamsLoading ? <Spinner /> : <Download />}
        </IconButton>
      </div>
      <div className="relative mx-3 mt-2 min-h-0 flex-1 overflow-hidden rounded-card bg-media shadow-hairline">
        {active && !failed ? (
          <video
            autoPlay
            className="h-full w-full object-contain"
            key={`${playbackUrl}#${reloadSeq}`}
            onClick={() => {
              rootRef.current?.focus();
              togglePlay();
            }}
            onDurationChange={(event) => setDuration(event.currentTarget.duration || 0)}
            onEnded={() => {
              setPlaying(false);
              clearPlaybackProgress(video.id);
              progress.reset(0);
              setResumeNotice(null);
            }}
            onError={() => setFailed(true)}
            onLoadedMetadata={onLoadedMetadata}
            onPause={(event) => {
              setPlaying(false);
              if (!event.currentTarget.ended)
                progress.record(event.currentTarget.currentTime, true);
            }}
            onPlay={() => setPlaying(true)}
            onProgress={(event) => {
              const ranges = event.currentTarget.buffered;
              let end = 0;
              for (let index = 0; index < ranges.length; index++)
                end = Math.max(end, ranges.end(index));
              setBufferedEnd(end);
            }}
            onTimeUpdate={(event) => {
              const time = event.currentTarget.currentTime;
              setCurrentTime(time);
              useClassroom.setState({ playbackTime: time });
              progress.record(time);
            }}
            preload="metadata"
            // src 变化时元素按 key 重挂，挂上后套用当前音量与倍速。
            ref={(element) => {
              videoRef.current = element;
              if (!element) return;
              element.volume = volume;
              element.playbackRate = rate;
            }}
            src={playbackUrl}
          />
        ) : failed ? (
          <div className="grid h-full place-items-center">
            <div className="flex flex-col items-center gap-2">
              <p className="text-sm text-on-media/70">视频加载失败，请重试</p>
              <Button onClick={retry} size="sm" variant="secondary">
                <RotateCcw className="size-3.5" />
                重试
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid h-full place-items-center">
            {streamsLoading ? (
              <Spinner size="lg" className="text-on-media/60" />
            ) : streamsError ? (
              <div className="flex flex-col items-center gap-2">
                <p className="text-sm text-on-media/70">{streamsError}</p>
                <Button onClick={() => void streamsQuery.refetch()} size="sm" variant="secondary">
                  <RotateCcw className="size-3.5" />
                  重试
                </Button>
              </div>
            ) : null}
          </div>
        )}
        {resumeNotice !== null && active && !failed && (
          <div
            className="absolute bottom-3 left-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-x-2 gap-y-1 rounded-control bg-media/80 px-3 py-2 text-sm text-on-media shadow-overlay"
            role="status"
          >
            <span className="tabular-nums">上次观看到 {formatTime(resumeNotice)}，已继续播放</span>
            <button
              className="shrink-0 text-on-media/80 underline underline-offset-2 transition-colors hover:text-on-media"
              onClick={restartFromBeginning}
              type="button"
            >
              回到开头
            </button>
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5 px-3 py-2">
        <IconButton aria-label={playing ? '暂停' : '播放'} onClick={togglePlay}>
          {playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
        </IconButton>
        <span className="shrink-0 text-xs tabular-nums text-ink-3">
          {formatTime(scrubTime ?? currentTime)}
        </span>
        <SeekBar
          bufferedEnd={bufferedEnd}
          className="min-w-0 flex-1"
          currentTime={currentTime}
          duration={duration}
          onScrub={setScrubTime}
          onSeek={seek}
        />
        <span className="shrink-0 text-xs tabular-nums text-ink-3">{formatTime(duration)}</span>
        <VolumeControl onChange={applyVolume} value={volume} />
        <RateMenu onSelect={applyRate} rate={rate} />
        <IconButton
          aria-label={fullscreen ? '退出全屏' : '全屏'}
          onClick={() => {
            if (document.fullscreenElement === rootRef.current) void document.exitFullscreen();
            else void rootRef.current?.requestFullscreen().catch(() => {});
          }}
          title={fullscreen ? '退出全屏' : '全屏'}
        >
          {fullscreen ? <Minimize /> : <Maximize />}
        </IconButton>
      </div>
    </div>
  );
}

function VolumeControl({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [open, setOpen] = useState(false);
  const Icon = value === 0 ? VolumeX : value < 0.5 ? Volume1 : Volume2;
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <IconButton aria-label={`音量 ${Math.round(value * 100)}%`} title="音量">
          <Icon />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-44 px-3 py-2.5">
        <div className="mb-1.5 flex items-center justify-between text-xs text-ink-3">
          <span>音量</span>
          <span className="tabular-nums">{Math.round(value * 100)}%</span>
        </div>
        <Slider ariaLabel="音量" max={1} onValueChange={onChange} step={0.05} value={value} />
      </PopoverContent>
    </Popover>
  );
}

function RateMenu({ rate, onSelect }: { rate: number; onSelect: (rate: number) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          aria-label={`播放速度 ${rate}x`}
          className="w-auto gap-0.5 px-2 text-xs font-medium tabular-nums"
          title="播放速度"
        >
          {rate}x
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {RATE_OPTIONS.map((option) => (
          <DropdownMenuItem key={option} onSelect={() => onSelect(option)}>
            <span className="flex size-4 items-center justify-center">
              {option === rate ? <Check className="size-3.5" /> : null}
            </span>
            <span className="tabular-nums">{option}x</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
