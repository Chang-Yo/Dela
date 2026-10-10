// 课程手风琴列表：点课程展开该课录像；行 hover 浮现下载（多画面时下拉选画面）。
// 行风格对齐资料面板树行：inset 底上 hover 用 hover-2 拉开层次（见 explorer 同款裁决）。
import { useState } from 'react';
import { ChevronRight, Download, Loader2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { IconButton } from '../../components/ui/beautifului/atoms/IconButton';
import { cn } from '../../lib/utils';
import type { ClassroomVideo, VideoCourse } from '../../../shared/vsjtu';
import { formatTime, lectureMeta, lectureTitle } from './player-format';
import { useClassroom } from './store';

export function CourseList() {
  const courses = useClassroom((state) => state.courses);
  if (courses.length === 0) {
    return <p className="px-3 py-6 text-center text-[12px] text-ink-3">本学期暂无课堂录像课程</p>;
  }
  return (
    <nav aria-label="课程与录像" className="flex flex-col gap-0.5 px-2 pb-2">
      {courses.map((course) => (
        <CourseSection key={course.id} course={course} />
      ))}
    </nav>
  );
}

function CourseSection({ course }: { course: VideoCourse }) {
  const open = useClassroom((state) => state.expanded === course.id);
  const toggleCourse = useClassroom((state) => state.toggleCourse);
  const videos = useClassroom((state) => state.videos[course.id]);
  const loading = useClassroom((state) => state.videosLoading[course.id] ?? false);
  const error = useClassroom((state) => state.videosError[course.id] || null);
  const ensureVideos = useClassroom((state) => state.ensureVideos);

  return (
    <div>
      <button
        aria-expanded={open}
        className={cn(
          'flex h-7 w-full items-center gap-1 rounded-chip px-1.5 text-[13px] transition-colors duration-150',
          open ? 'font-medium text-ink' : 'text-ink-2 hover:bg-hover-2 hover:text-ink',
        )}
        onClick={() => toggleCourse(course.id)}
        type="button"
      >
        <ChevronRight
          aria-hidden
          className={cn(
            'size-3 shrink-0 text-ink-3 transition-transform duration-150 motion-reduce:transition-none',
            open && 'rotate-90',
          )}
        />
        <span className="min-w-0 flex-1 truncate text-left">{course.name}</span>
        {!open && videos && (
          <span className="shrink-0 pr-1 text-[11px] tabular-nums text-ink-3">{videos.length}</span>
        )}
      </button>
      {open && (
        <div className="mb-1 ml-4 mt-0.5 flex flex-col gap-0.5">
          {loading && !videos ? (
            [0, 1, 2].map((index) => <VideoRowSkeleton key={index} />)
          ) : error && !videos ? (
            <p className="px-2 py-2 text-[12px] text-ink-3">
              {error}
              <button
                className="ml-2 underline underline-offset-2"
                onClick={() => void ensureVideos(course.id)}
                type="button"
              >
                重试
              </button>
            </p>
          ) : videos && videos.length > 0 ? (
            videos.map((video) => <VideoRow key={video.id} course={course} video={video} />)
          ) : (
            <p className="px-2 py-2 text-[12px] text-ink-3">暂无录像</p>
          )}
        </div>
      )}
    </div>
  );
}

function VideoRowSkeleton() {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="h-3.5 w-3/5 animate-pulse rounded-chip bg-hover-2" />
        <div className="h-3 w-2/5 animate-pulse rounded-chip bg-hover-2" />
      </div>
    </div>
  );
}

function VideoRow({ course, video }: { course: VideoCourse; video: ClassroomVideo }) {
  const selected = useClassroom((state) => state.selectedVideoId === video.id);
  const selectVideo = useClassroom((state) => state.selectVideo);

  return (
    // 行间不画分隔线：选中/悬停是圆角底色块，下载钮 hover 浮现。
    <div
      className={cn(
        'group flex items-center gap-1 rounded-chip pl-2 pr-0.5 transition-colors duration-150',
        selected ? 'bg-hover-2' : 'hover:bg-hover-2',
      )}
    >
      <button
        className="flex min-w-0 flex-1 flex-col gap-0.5 py-1.5 text-left"
        onClick={() => selectVideo(course.id, video.id)}
        type="button"
      >
        <span
          className={cn('truncate text-[13px]', selected ? 'font-medium text-ink' : 'text-ink-2')}
        >
          {lectureTitle(video)}
        </span>
        <span className="truncate text-[11.5px] tabular-nums text-ink-3">{lectureMeta(video)}</span>
      </button>
      <DownloadButton course={course} video={video} />
    </div>
  );
}

function DownloadButton({ course, video }: { course: VideoCourse; video: ClassroomVideo }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const streams = useClassroom((state) => state.streams[video.id]);
  const streamsLoading = useClassroom((state) => state.streamsLoading === video.id);
  const streamsError = useClassroom((state) => state.streamsError[video.id] || null);
  const ensureStreams = useClassroom((state) => state.ensureStreams);
  const download = useClassroom((state) => state.download);
  const pending = busy || streamsLoading;

  return (
    <DropdownMenu
      onOpenChange={(next) => {
        setOpen(next);
        if (next && !streams && !streamsLoading) {
          setBusy(true);
          void ensureStreams(video.id).finally(() => setBusy(false));
        }
      }}
      open={open}
    >
      <DropdownMenuTrigger asChild>
        <span className="inline-flex opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100">
          <IconButton
            aria-label={`下载 ${lectureTitle(video)}`}
            className="hover:bg-hover-2"
            disabled={pending}
            title="下载"
          >
            {pending ? <Loader2 className="animate-spin" /> : <Download />}
          </IconButton>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {streams ? (
          streams.map((stream, index) => (
            <DropdownMenuItem
              key={stream.view}
              onSelect={() => void download(course.name, video, stream.view)}
            >
              <span>画面{index + 1}</span>
              <span className="ml-auto text-[12px] tabular-nums text-ink-3">
                {stream.duration > 0 ? formatTime(stream.duration) : ''}
              </span>
            </DropdownMenuItem>
          ))
        ) : (
          <p className="px-2 py-1.5 text-[12px] text-ink-3">{streamsError || '正在读取画面…'}</p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
