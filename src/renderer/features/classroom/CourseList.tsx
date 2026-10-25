import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { Button } from '../../components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { IconButton } from '../../components/ui/beautifului/atoms/IconButton';
import { cn } from '../../lib/utils';
import type { ClassroomVideo, VideoCourse } from '../../../shared/vsjtu';
import { formatTime, lectureMeta, lectureTitle } from './player-format';
import { useClassroom } from './store';
import { useExperimentEnabled } from '../settings/experimental';

export function CoursePicker() {
  const courses = useClassroom((state) => state.courses);
  const selectedCourseId = useClassroom((state) => state.selectedCourseId);
  const selectCourse = useClassroom((state) => state.selectCourse);
  return (
    <div className="px-3 pb-3 pt-2">
      <Select
        value={selectedCourseId === null ? '' : String(selectedCourseId)}
        onValueChange={(value) => selectCourse(Number(value))}
        disabled={courses.length === 0}
      >
        <SelectTrigger aria-label="当前课程" className="w-full">
          <SelectValue placeholder="暂无课程" />
        </SelectTrigger>
        {/* 面板与触发器同宽：课程名动辄二十字以上，等宽加截断比加宽面板更可读。 */}
        <SelectContent className="w-(--radix-select-trigger-width)">
          {courses.map((course) => (
            <SelectItem key={course.id} value={String(course.id)}>
              {course.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function CourseList() {
  const course = useClassroom((state) =>
    state.courses.find((course) => course.id === state.selectedCourseId),
  );
  const videos = useClassroom((state) => state.videos[state.selectedCourseId ?? -1]);
  const loading = useClassroom((state) => state.videosLoading[state.selectedCourseId ?? -1]);
  const error = useClassroom((state) => state.videosError[state.selectedCourseId ?? -1]);
  const ensureVideos = useClassroom((state) => state.ensureVideos);
  if (!course)
    return <p className="px-3 py-6 text-center text-xs text-ink-3">本学期暂无课堂录像课程</p>;
  return (
    <nav aria-label="节次" className="flex flex-col gap-1 px-2 pb-2">
      {loading && !videos ? (
        [0, 1, 2].map((index) => <VideoRowSkeleton key={index} />)
      ) : error && !videos ? (
        <div className="px-2 py-3 text-xs text-ink-3">
          <p>{error}</p>
          <Button size="sm" variant="ghost" onClick={() => void ensureVideos(course.id)}>
            重试
          </Button>
        </div>
      ) : videos?.length ? (
        videos.map((video) => <VideoRow key={video.id} course={course} video={video} />)
      ) : (
        <p className="px-2 py-3 text-xs text-ink-3">暂无录像</p>
      )}
    </nav>
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
  const downloadEnabled = useExperimentEnabled('videoDownload');

  return (
    // 行间不画分隔线：选中/悬停是圆角底色块，下载钮 hover 浮现。
    <div
      className={cn(
        'group flex items-center gap-1 rounded-chip pl-2 pr-0.5 transition-colors duration-150',
        selected ? 'bg-hover-2' : 'hover:bg-hover-2',
      )}
    >
      <button
        aria-current={selected ? 'true' : undefined}
        className="flex min-w-0 flex-1 flex-col gap-0.5 py-1.5 text-left"
        onClick={() => selectVideo(course.id, video.id)}
        type="button"
      >
        <span className={cn('truncate text-13', selected ? 'font-medium text-ink' : 'text-ink-2')}>
          {lectureTitle(video)}
        </span>
        <span className="truncate text-xs tabular-nums text-ink-3">{lectureMeta(video)}</span>
      </button>
      {downloadEnabled && <DownloadButton course={course} video={video} />}
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
              <span className="ml-auto text-xs tabular-nums text-ink-3">
                {stream.duration > 0 ? formatTime(stream.duration) : ''}
              </span>
            </DropdownMenuItem>
          ))
        ) : (
          <p className="px-2 py-1.5 text-xs text-ink-3">{streamsError || '正在读取画面…'}</p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
