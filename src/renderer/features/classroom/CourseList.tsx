import { Button } from '../../components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { cn } from '../../lib/utils';
import type { ClassroomVideo, VideoCourse } from '../../../shared/vsjtu';
import { lectureMeta, lectureTitle } from './player-format';
import { useClassroom } from './store';

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

  return (
    <div
      className={cn(
        'flex items-center rounded-chip px-2 transition-colors duration-150',
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
    </div>
  );
}
