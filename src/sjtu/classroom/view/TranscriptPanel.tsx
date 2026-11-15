import { useState } from 'react';
import { FileOutput, Play, RotateCcw } from 'lucide-react';
import { errorMessage } from '../../../core/protocol/contract';
import { showToast } from '../../../ui/toast';
import type { ClassroomVideo, VideoCourse } from '../contract';
import { Button } from '../../../ui/button';
import { SearchInput } from '../../../ui/search-input';
import { IconButton } from '../../../ui/icon-button';
import { cn } from '../../../ui/cn';
import { formatTime, lectureFileName, lectureTitle } from './player-format';
import { useClassroom } from './store';
import { classroomClient, useSelection, useTranscript } from './use-classroom';
import { Spinner } from '../../../ui/spinner';

export function TranscriptPanel() {
  const { course, video } = useSelection();
  if (!course || !video)
    return <p className="px-3 py-6 text-center text-xs text-ink-3">请先在节次中选择一场录像</p>;
  return <TranscriptReader key={video.id} course={course} video={video} />;
}

function TranscriptReader({ course, video }: { course: VideoCourse; video: ClassroomVideo }) {
  const result = useTranscript(video.id);
  const transcript = result.data;
  const loading = !transcript && result.isFetching;
  const error = result.error ? errorMessage(result.error) : '';
  const [query, setQuery] = useState('');
  const [exporting, setExporting] = useState(false);
  const time = useClassroom((state) => state.playbackTime);
  const seekTo = useClassroom((state) => state.seekTo);

  const keyword = query.trim();
  const segments =
    transcript?.segments.filter((segment) =>
      segment.text.toLocaleLowerCase().includes(keyword.toLocaleLowerCase()),
    ) ?? [];
  const exportText = async () => {
    setExporting(true);
    try {
      const { saved } = await classroomClient.exportTranscript({
        videoId: video.id,
        title: lectureFileName(course.name, video),
      });
      if (saved) showToast({ variant: 'success', title: '文稿已导出' });
    } catch (cause) {
      showToast({ variant: 'error', title: '导出失败', description: errorMessage(cause) });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-3 pb-2">
        <p className="mb-2 truncate text-xs text-ink-3">{lectureTitle(video)}</p>
        <div className="flex items-center gap-1">
          <SearchInput
            aria-label="搜索语音文稿"
            className="flex-1"
            placeholder="搜索文稿"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <IconButton
            aria-label="导出完整文稿"
            title="导出完整文稿"
            disabled={loading || !transcript || exporting}
            onClick={() => void exportText()}
          >
            {exporting ? <Spinner /> : <FileOutput />}
          </IconButton>
        </div>
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto px-2 pb-3"
        aria-label="语音文稿"
        aria-busy={loading}
      >
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-xs text-ink-3">
            <Spinner />
            正在加载文稿…
          </div>
        ) : !transcript ? (
          <div className="px-1 py-4 text-xs text-ink-3">
            <p>{error || '该录像暂无语音文稿'}</p>
            <Button
              className="mt-2"
              size="sm"
              variant="ghost"
              onClick={() => void result.refetch()}
            >
              <RotateCcw className="size-3.5" />
              重试
            </Button>
          </div>
        ) : (
          <>
            <p className="px-1 pb-2 text-xs text-ink-3">
              语音识别生成，仅供参考{keyword ? ` · ${segments.length} 段匹配` : ''}
            </p>
            {segments.length === 0 && (
              <p className="px-1 py-4 text-xs text-ink-3">没有匹配的内容</p>
            )}
            {segments.map((segment, index) => {
              const active = time * 1000 >= segment.startMs && time * 1000 < segment.endMs;
              return (
                <div
                  key={`${segment.startMs}-${index}`}
                  className={cn(
                    'mb-1 rounded-control px-2 py-2 text-sm leading-relaxed text-ink-2',
                    active && 'bg-selected text-ink',
                  )}
                >
                  <button
                    type="button"
                    className="mb-1 inline-flex items-center gap-1 rounded-chip px-1 py-0.5 text-xs tabular-nums text-ink-3 hover:bg-hover-strong hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
                    aria-label={`跳转到 ${formatTime(segment.startMs / 1000)}`}
                    onClick={() => seekTo(video.id, segment.startMs / 1000)}
                  >
                    <Play aria-hidden className="size-3" />
                    {formatTime(segment.startMs / 1000)}
                  </button>
                  <p className="whitespace-pre-wrap break-words">
                    <Highlight text={segment.text} query={keyword} />
                  </p>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.split(new RegExp(`(${escaped})`, 'gi')).map((part, index) =>
    index % 2 ? (
      <mark key={index} className="rounded-chip bg-accent-tint text-ink">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}
