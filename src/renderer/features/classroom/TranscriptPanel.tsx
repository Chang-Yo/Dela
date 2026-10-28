import { useEffect, useRef, useState } from 'react';
import { FileOutput, Loader2, MessageCircle, Play, RotateCcw, Search } from 'lucide-react';
import type { ClassroomVideo, VideoCourse, VideoTranscript } from '../../../shared/vsjtu';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { IconButton } from '../../components/ui/beautifului/atoms/IconButton';
import { showToast } from '../../app/toasts';
import { errorText } from '../../workspace/store';
import { cn } from '../../lib/utils';
import { formatTime, lectureFileName, lectureTitle } from './player-format';
import { useClassroom } from './store';
import { openStudyChat } from '../../lib/study-context';

export function TranscriptPanel() {
  const course = useClassroom((state) =>
    state.courses.find((course) => course.id === state.selectedCourseId),
  );
  const video = useClassroom((state) =>
    state.videos[state.selectedCourseId ?? -1]?.find((video) => video.id === state.selectedVideoId),
  );
  if (!course || !video)
    return <p className="px-3 py-6 text-center text-xs text-ink-3">请先在节次中选择一场录像</p>;
  return <TranscriptReader key={video.id} course={course} video={video} />;
}

function TranscriptReader({ course, video }: { course: VideoCourse; video: ClassroomVideo }) {
  const [transcript, setTranscript] = useState<VideoTranscript | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [reload, setReload] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [selectedText, setSelectedText] = useState('');
  const transcriptRef = useRef<HTMLDivElement>(null);
  const time = useClassroom((state) => state.playbackTime);
  const seekTo = useClassroom((state) => state.seekTo);

  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setError('');
    void window
      .dela!.vsjtu.transcript(video.id)
      .then((value) => {
        if (!disposed) setTranscript(value);
      })
      .catch((cause) => {
        if (!disposed) setError(errorText(cause));
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [video.id, reload]);

  const keyword = query.trim();
  const segments =
    transcript?.segments.filter((segment) =>
      segment.text.toLocaleLowerCase().includes(keyword.toLocaleLowerCase()),
    ) ?? [];
  const exportText = async () => {
    setExporting(true);
    try {
      const result = await window.dela!.vsjtu.exportTranscript(
        video.id,
        lectureFileName(course.name, video),
      );
      if (result.saved) showToast({ variant: 'success', title: '文稿已导出' });
    } catch (cause) {
      showToast({ variant: 'error', title: '导出失败', description: errorText(cause) });
    } finally {
      setExporting(false);
    }
  };

  const askSelectedText = async () => {
    const text = selectedText.trim();
    if (!text) return;
    const selectedSegments =
      transcript?.segments.filter(
        (segment) => text.includes(segment.text) || segment.text.includes(text),
      ) ?? [];
    const first = selectedSegments[0];
    const last = selectedSegments.at(-1) ?? first;
    try {
      await openStudyChat({
        prompt: [
          '请围绕我在课堂字幕中选中的内容回答后续问题。',
          `课程：${course.name}`,
          `录播：${lectureTitle(video)}`,
          first && last
            ? `字幕位置：${formatTime(first.startMs / 1000)}–${formatTime(last.endMs / 1000)}`
            : '字幕位置：用户选中的片段',
          `用户选中的字幕：\n${text.slice(0, 12000)}`,
          '请先解释选段，再指出它和前后知识点的关系；回答需要引用字幕时间位置。',
        ].join('\n'),
        sessionKey: `lecture:${video.id}`,
      });
      setSelectedText('');
    } catch (cause) {
      showToast({ variant: 'error', title: '打开字幕提问失败', description: errorText(cause) });
    }
  };

  const captureSelection = () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !transcriptRef.current) return;
    const range = selection.getRangeAt(0);
    if (!transcriptRef.current.contains(range.commonAncestorContainer)) return;
    const text = selection.toString().trim();
    if (text) setSelectedText(text);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-3 pb-2">
        <p className="mb-2 truncate text-xs text-ink-3">{lectureTitle(video)}</p>
        <div className="flex items-center gap-1">
          <div className="relative min-w-0 flex-1">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-2.5 top-2 size-4 text-ink-3"
            />
            <Input
              aria-label="搜索语音文稿"
              className="pl-8"
              placeholder="搜索文稿"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <IconButton
            aria-label="导出完整文稿"
            title="导出完整文稿"
            disabled={loading || !!error || !transcript || exporting}
            onClick={() => void exportText()}
          >
            {exporting ? <Loader2 className="animate-spin" /> : <FileOutput />}
          </IconButton>
          {selectedText && (
            <IconButton
              aria-label="询问选中的字幕"
              title="询问选中的字幕"
              onClick={() => void askSelectedText()}
            >
              <MessageCircle />
            </IconButton>
          )}
        </div>
      </div>
      <div
        ref={transcriptRef}
        className="min-h-0 flex-1 overflow-y-auto px-2 pb-3"
        aria-label="语音文稿"
        aria-busy={loading}
        onMouseUp={captureSelection}
      >
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-xs text-ink-3">
            <Loader2 className="size-4 animate-spin" />
            正在加载文稿…
          </div>
        ) : error || !transcript ? (
          <div className="px-1 py-4 text-xs text-ink-3">
            <p>{error || '该录像暂无语音文稿'}</p>
            <Button
              className="mt-2"
              size="sm"
              variant="ghost"
              onClick={() => setReload((value) => value + 1)}
            >
              <RotateCcw className="size-3.5" />
              重试
            </Button>
          </div>
        ) : (
          <>
            <p className="px-1 pb-2 text-2xs text-ink-3">
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
                    'mb-1 rounded-control px-2 py-2 text-13 leading-relaxed text-ink-2',
                    active && 'bg-hover-2 text-ink',
                  )}
                >
                  <button
                    type="button"
                    className="mb-1 inline-flex items-center gap-1 rounded-chip px-1 py-0.5 text-xs tabular-nums text-ink-3 hover:bg-hover-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-bui-accent"
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
      <mark key={index} className="rounded-sm bg-bui-accent-tint text-ink">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}
