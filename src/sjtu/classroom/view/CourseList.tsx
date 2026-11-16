import { errorMessage } from '../../../core/protocol/contract';
import { Button } from '../../../ui/button';
import { EmptyState } from '../../../ui/empty-state';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../ui/select';
import { Skeleton } from '../../../ui/skeleton';
import { cn } from '../../../ui/cn';
import type { ClassroomVideo, VideoCourse } from '../contract';
import { lectureMeta, lectureTitle } from './player-format';
import { useClassroom } from './store';
import { useCourses, useSelection } from './use-classroom';

export function CoursePicker() {
  const courses = useCourses().data ?? [];
  const { course } = useSelection();
  const selectCourse = useClassroom((state) => state.selectCourse);
  return (
    <div className="px-3 pb-3 pt-2">
      <Select
        value={course ? String(course.id) : ''}
        onValueChange={(value) => selectCourse(Number(value))}
        disabled={courses.length === 0}
      >
        <SelectTrigger aria-label="当前课程" className="w-full">
          <SelectValue placeholder="暂无课程" />
        </SelectTrigger>
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
  const { course, videos } = useSelection();
  if (!course) return <EmptyState title="本学期暂无课堂录像课程" />;
  return (
    <nav aria-label="节次" className="flex flex-col gap-1 px-2 pb-2">
      {videos.data ? (
        videos.data.length ? (
          videos.data.map((video) => <VideoRow key={video.id} course={course} video={video} />)
        ) : (
          <EmptyState title="暂无录像" />
        )
      ) : videos.isError && !videos.isFetching ? (
        <div className="px-2 py-3 text-xs text-ink-3">
          <p>{errorMessage(videos.error)}</p>
          <Button size="sm" variant="ghost" onClick={() => void videos.refetch()}>
            重试
          </Button>
        </div>
      ) : (
        [0, 1, 2].map((index) => <VideoRowSkeleton key={index} />)
      )}
    </nav>
  );
}

function VideoRowSkeleton() {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Skeleton className="h-3.5 w-3/5" />
        <Skeleton className="h-3 w-2/5" />
      </div>
    </div>
  );
}

function VideoRow({ course, video }: { course: VideoCourse; video: ClassroomVideo }) {
  const selected = useClassroom((state) => state.videoId === video.id);
  const selectVideo = useClassroom((state) => state.selectVideo);

  return (
    <div
      className={cn(
        'flex items-center rounded-chip px-2 transition-colors duration-base',
        selected ? 'bg-selected' : 'hover:bg-hover-strong',
      )}
    >
      <button
        aria-current={selected ? 'true' : undefined}
        className="flex min-w-0 flex-1 flex-col gap-0.5 py-1.5 text-left"
        onClick={() => selectVideo(course.id, video.id)}
        type="button"
      >
        <span className={cn('truncate text-sm', selected ? 'font-medium text-ink' : 'text-ink-2')}>
          {lectureTitle(video)}
        </span>
        <span className="truncate text-xs tabular-nums text-ink-3">{lectureMeta(video)}</span>
      </button>
    </div>
  );
}
