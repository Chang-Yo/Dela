import { useCallback, useEffect, useState } from 'react';
import { FolderOpen, Pin, PinOff, RefreshCw, Trash2 } from 'lucide-react';
import type {
  CanvasCachePolicy,
  CanvasCacheScope,
  CanvasCacheStats,
} from '../../../../shared/canvas';
import { Button } from '../../../components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import { Switch } from '../../../components/ui/beautifului/atoms/Switch';
import { showToast } from '../../../app/toasts';
import { errorText } from '../../../workspace/store';
import { formatBytes } from '../../classroom/player-format';
import { fileManagerName } from '../../../lib/platform';
import { SectionHeader } from '../SectionHeader';
import { SettingRow } from '../SettingRow';
import { SettingsGroup } from '../SettingsGroup';

const emptyStats: CanvasCacheStats = {
  directory: '',
  fileCount: 0,
  bytes: 0,
  terms: [],
  policy: { enabled: false, maxBytes: 5 * 1024 ** 3, keepCurrentTerm: false },
  lastCleanupAt: null,
};

const capacityOptions = [
  [500 * 1024 ** 2, '500 MB'],
  [1024 ** 3, '1 GB'],
  [2 * 1024 ** 3, '2 GB'],
  [5 * 1024 ** 3, '5 GB'],
  [10 * 1024 ** 3, '10 GB'],
  [20 * 1024 ** 3, '20 GB'],
] as const;

function bytesText(bytes: number) {
  return formatBytes(bytes) ?? '0 B';
}

function sameScope(a: CanvasCacheScope | null, b: CanvasCacheScope) {
  if (!a || a.kind !== b.kind) return false;
  if (a.kind === 'all') return true;
  if (a.kind === 'term') return a.term === (b.kind === 'term' ? b.term : '');
  return a.courseId === (b.kind === 'course' ? b.courseId : 0);
}

export function CanvasCacheSection() {
  const [stats, setStats] = useState<CanvasCacheStats | null>(null);
  const [confirming, setConfirming] = useState<CanvasCacheScope | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!window.dela) {
      setStats(emptyStats);
      return;
    }
    try {
      setError(null);
      setStats(await window.dela.canvas.getCacheStats());
    } catch (cause) {
      setError(errorText(cause));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openDirectory = async () => {
    if (!window.dela || busy) return;
    try {
      await window.dela.canvas.openCacheDirectory();
    } catch (cause) {
      showToast({
        variant: 'error',
        title: `打开 ${fileManagerName} 失败`,
        description: errorText(cause),
      });
    }
  };

  const clear = async (scope: CanvasCacheScope) => {
    if (!window.dela || busy) return;
    setBusy(true);
    try {
      const result = await window.dela.canvas.clearCache(scope);
      setConfirming(null);
      await refresh();
      showToast({
        variant: 'success',
        title: result.removedFiles
          ? `已清理 ${result.removedFiles} 个文件（${bytesText(result.freedBytes)}）`
          : '没有可清理的文件',
        description: result.blockedFiles
          ? `${result.blockedFiles} 个文件正在使用，暂未清理。`
          : undefined,
      });
    } catch (cause) {
      showToast({ variant: 'error', title: '清理 Canvas 缓存失败', description: errorText(cause) });
    } finally {
      setBusy(false);
    }
  };

  const updatePolicy = async (next: CanvasCachePolicy) => {
    if (!window.dela || busy) return;
    setBusy(true);
    try {
      setStats(await window.dela.canvas.updateCachePolicy(next));
    } catch (cause) {
      showToast({ variant: 'error', title: '保存自动清理设置失败', description: errorText(cause) });
    } finally {
      setBusy(false);
    }
  };

  const toggleCoursePin = async (courseId: number, pinned: boolean) => {
    if (!window.dela || busy) return;
    setBusy(true);
    try {
      await window.dela.canvas.setCachePin({ kind: 'course', courseId }, !pinned);
      await refresh();
    } catch (cause) {
      showToast({ variant: 'error', title: '保存固定设置失败', description: errorText(cause) });
    } finally {
      setBusy(false);
    }
  };

  const current = stats ?? emptyStats;
  return (
    <div className="grid gap-10">
      <SectionHeader title="Canvas 缓存" />
      <SettingsGroup
        title="缓存位置"
        description="预览或读取课件时，Dela 会按需保存本地副本；显式导出的文件不受这里的清理影响。"
      >
        <SettingRow settingId="canvas-cache-directory" title="保存位置">
          <div className="flex min-w-0 max-w-full items-center justify-end gap-3">
            <span
              className="max-w-96 truncate text-xs text-ink-3"
              title={current.directory || undefined}
            >
              {current.directory || '正在读取…'}
            </span>
            <Button
              disabled={!stats || busy}
              onClick={() => void openDirectory()}
              size="sm"
              variant="secondary"
            >
              <FolderOpen />
              打开目录
            </Button>
          </div>
        </SettingRow>
        <SettingRow settingId="canvas-cache-size" title="占用空间">
          <span className="text-xs tabular-nums text-ink-3">
            {stats ? `${bytesText(current.bytes)} · ${current.fileCount} 个文件` : '正在计算…'}
          </span>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup
        description="自动清理默认关闭；开启后，Dela 会按容量和最近使用时间回收课程缓存。固定的课程和文件不会被清理。"
        title="自动清理"
      >
        <SettingRow settingId="canvas-cache-auto-cleanup" title="自动清理缓存">
          <Switch
            checked={current.policy.enabled}
            disabled={!stats || busy}
            label="自动清理缓存"
            onChange={(enabled) => void updatePolicy({ ...current.policy, enabled })}
          />
        </SettingRow>
        <SettingRow
          description="超过上限后，优先清理较久没有使用的文件。"
          nested
          settingId="canvas-cache-max-bytes"
          title="最大占用"
        >
          <Select
            disabled={!stats || busy}
            onValueChange={(value) =>
              void updatePolicy({ ...current.policy, maxBytes: Number(value) })
            }
            value={String(current.policy.maxBytes)}
          >
            <SelectTrigger aria-label="Canvas 缓存最大占用" className="min-w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {capacityOptions.map(([value, label]) => (
                <SelectItem key={value} value={String(value)}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingRow
          description="清理时优先保留最新学期；固定的旧学期缓存仍会保留。"
          nested
          settingId="canvas-cache-keep-current-term"
          title="只保留当前学期"
        >
          <Switch
            checked={current.policy.keepCurrentTerm}
            disabled={!stats || busy}
            label="只保留当前学期"
            onChange={(keepCurrentTerm) =>
              void updatePolicy({ ...current.policy, keepCurrentTerm })
            }
          />
        </SettingRow>
        <SettingRow settingId="canvas-cache-last-cleanup" title="最近清理">
          <span className="text-xs text-ink-3">
            {current.lastCleanupAt
              ? new Date(current.lastCleanupAt).toLocaleString('zh-CN')
              : '尚未自动清理'}
          </span>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup
        action={
          <Button
            aria-label="刷新 Canvas 缓存统计"
            disabled={!stats || busy}
            onClick={() => void refresh()}
            size="icon-sm"
            title="刷新统计"
            variant="ghost"
          >
            <RefreshCw />
          </Button>
        }
        description={error ?? '按学期和课程查看本地缓存；清理后仍可从 Canvas 重新获取。'}
        title="按课程清理"
      >
        {current.terms.length ? (
          <div className="grid divide-y divide-line">
            {current.terms.map((term) => {
              const termScope: CanvasCacheScope = { kind: 'term', term: term.term };
              const termConfirming = sameScope(confirming, termScope);
              return (
                <div className="grid gap-2 py-4 first:pt-3 last:pb-3" key={term.term}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate text-13 font-medium text-ink">{term.term}</h3>
                      <p className="text-xs tabular-nums text-ink-3">
                        {bytesText(term.bytes)} · {term.fileCount} 个文件
                      </p>
                    </div>
                    {termConfirming ? (
                      <div className="flex items-center gap-2">
                        <Button
                          disabled={busy}
                          onClick={() => void clear(termScope)}
                          size="sm"
                          variant="destructive"
                        >
                          {busy ? '清理中…' : '确认清理'}
                        </Button>
                        <Button
                          disabled={busy}
                          onClick={() => setConfirming(null)}
                          size="sm"
                          variant="ghost"
                        >
                          取消
                        </Button>
                      </div>
                    ) : (
                      <Button
                        disabled={busy}
                        onClick={() => setConfirming(termScope)}
                        size="sm"
                        variant="secondary"
                      >
                        <Trash2 />
                        清理学期
                      </Button>
                    )}
                  </div>
                  <div className="grid gap-1 pl-3">
                    {term.courses.map((course) => {
                      if (course.id === null) {
                        return (
                          <div
                            className="flex items-center justify-between gap-3 py-1.5"
                            key={course.name}
                          >
                            <span className="truncate text-xs text-ink-2">{course.name}</span>
                            <span className="shrink-0 text-xs tabular-nums text-ink-3">
                              {bytesText(course.bytes)} · {course.fileCount} 个文件
                            </span>
                          </div>
                        );
                      }
                      const courseScope: CanvasCacheScope = { kind: 'course', courseId: course.id };
                      const courseConfirming = sameScope(confirming, courseScope);
                      return (
                        <div
                          className="flex flex-wrap items-center justify-between gap-2 py-1.5"
                          key={course.id}
                        >
                          <span className="min-w-0 truncate text-xs text-ink-2">{course.name}</span>
                          <div className="flex shrink-0 items-center gap-2">
                            <span className="text-xs tabular-nums text-ink-3">
                              {bytesText(course.bytes)} · {course.fileCount} 个文件
                            </span>
                            {course.pinned && (
                              <Pin aria-hidden="true" className="size-3.5 text-ink-3" />
                            )}
                            {course.id !== null && (
                              <Button
                                aria-label={
                                  course.pinned ? `取消固定${course.name}` : `固定${course.name}`
                                }
                                disabled={busy}
                                onClick={() => void toggleCoursePin(course.id!, course.pinned)}
                                size="icon-sm"
                                title={course.pinned ? '取消固定缓存' : '固定缓存'}
                                variant="ghost"
                              >
                                {course.pinned ? <PinOff /> : <Pin />}
                              </Button>
                            )}
                            {courseConfirming ? (
                              <>
                                <Button
                                  disabled={busy}
                                  onClick={() => void clear(courseScope)}
                                  size="sm"
                                  variant="destructive"
                                >
                                  {busy ? '清理中…' : '确认'}
                                </Button>
                                <Button
                                  disabled={busy}
                                  onClick={() => setConfirming(null)}
                                  size="sm"
                                  variant="ghost"
                                >
                                  取消
                                </Button>
                              </>
                            ) : (
                              <Button
                                disabled={busy}
                                onClick={() => setConfirming(courseScope)}
                                size="sm"
                                variant="ghost"
                              >
                                清理
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="px-1 py-4 text-xs text-ink-3">暂无已缓存的 Canvas 文件。</p>
        )}
      </SettingsGroup>

      <SettingsGroup title="全部缓存">
        <SettingRow
          description="只删除 Dela 管理的 Canvas 文件，不影响工作区和显式导出的文件。"
          settingId="canvas-cache-clear-all"
          title="清理全部 Canvas 缓存"
        >
          {sameScope(confirming, { kind: 'all' }) ? (
            <div className="flex items-center gap-2">
              <Button
                disabled={busy || !stats?.fileCount}
                onClick={() => void clear({ kind: 'all' })}
                size="sm"
                variant="destructive"
              >
                {busy ? '清理中…' : '确认清理'}
              </Button>
              <Button disabled={busy} onClick={() => setConfirming(null)} size="sm" variant="ghost">
                取消
              </Button>
            </div>
          ) : (
            <Button
              disabled={busy || !stats?.fileCount}
              onClick={() => setConfirming({ kind: 'all' })}
              size="sm"
              variant="secondary"
            >
              <Trash2 />
              清理全部
            </Button>
          )}
        </SettingRow>
      </SettingsGroup>
    </div>
  );
}
