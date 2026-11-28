import { useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { errorMessage } from '../../../core/protocol/contract';
import { Alert } from '../../../ui/alert';
import { Button } from '../../../ui/button';
import { Input } from '../../../ui/input';
import { cn } from '../../../ui/lib/cn';
import type { NoticePreview } from '../contract';
import { useWebsiteSubscriptions, websiteSubscriptionsClient } from './use-website-subscriptions';

export function WebsiteSubscriptionsPanel({ onViewNotices }: { onViewNotices: () => void }) {
  const subscriptionsQuery = useWebsiteSubscriptions();
  const subscriptions = subscriptionsQuery.data;
  const noticeEnabled = subscriptions?.experimental ?? false;
  const [busy, setBusy] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [keyword, setKeyword] = useState('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<NoticePreview | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState(0);
  const [expandedCandidates, setExpandedCandidates] = useState<number[]>([]);
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | null>(null);

  const keywords = keyword.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const candidates = (preview?.candidates ?? [])
    .map((candidate, index) => ({
      candidate,
      index,
      entries: candidate.entries.filter((entry) =>
        keywords.every((word) =>
          `${candidate.label} ${entry.title}`.toLocaleLowerCase().includes(word),
        ),
      ),
    }))
    .filter(({ entries }) => entries.length > 0);
  const selectedIndex = candidates.some(({ index }) => index === selectedCandidate)
    ? selectedCandidate
    : candidates[0]?.index;
  const sectionLinks = (preview?.sectionLinks ?? []).filter((link) =>
    keywords.every((word) => link.title.toLocaleLowerCase().includes(word)),
  );

  const handlePreview = async (targetUrl = url, render = false) => {
    if (!targetUrl.trim() || busy) return;
    setBusy(true);
    setPanelError(null);
    setPreview(null);
    setSuccessMessage(null);
    try {
      const result = await websiteSubscriptionsClient.previewNoticeSubscription({
        url: targetUrl.trim(),
        render,
      });
      setPreview(result);
      setSelectedCandidate(0);
      setExpandedCandidates([]);
    } catch (cause) {
      setPanelError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async () => {
    if (!preview || selectedIndex === undefined || busy) return;
    setBusy(true);
    setPanelError(null);
    try {
      await websiteSubscriptionsClient.addNoticeSubscription({
        token: preview.token,
        candidate: selectedIndex,
      });
      const candidate = preview.candidates[selectedIndex]!;
      const label = candidate.label.replace(/\s*查看更多\s*$/, '');
      setSuccessMessage(`已订阅「${label}」；${candidate.entries.length} 条公告已加入通知列表。`);
      setPreview(null);
      setUrl('');
      setKeyword('');
      await subscriptionsQuery.refetch();
    } catch (cause) {
      setPanelError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (id: string) => {
    if (busy) return;
    setBusy(true);
    setPanelError(null);
    try {
      await websiteSubscriptionsClient.removeNoticeSubscription(id);
      setSuccessMessage(null);
      setConfirmingRemoveId(null);
      await subscriptionsQuery.refetch();
    } catch (cause) {
      setPanelError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {noticeEnabled ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-medium text-ink">已订阅</h2>
            <p className="mt-1 text-xs text-ink-3">
              自动检查更新，新公告显示为未读，已有公告标为已读。
            </p>
          </div>
          {subscriptions?.notices.length || successMessage ? (
            <Button onClick={onViewNotices} size="sm" variant="outline">
              查看订阅公告
            </Button>
          ) : null}
        </div>
      ) : null}
      {successMessage ? (
        <p className="text-sm text-ink-2" role="status">
          {successMessage}
        </p>
      ) : null}
      {subscriptionsQuery.error ? (
        <Alert role="alert">{errorMessage(subscriptionsQuery.error)}</Alert>
      ) : null}
      {subscriptions && !noticeEnabled ? (
        <p className="text-sm text-ink-3">可在「设置 › 通知」中开启通用公告订阅。</p>
      ) : null}

      {noticeEnabled ? (
        <>
          {subscriptions && subscriptions.notices.length > 0 ? (
            <div className="flex flex-col gap-2 pt-1">
              {subscriptions.notices.map((item) => (
                <div
                  className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-inset px-3 py-2"
                  key={item.id}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink">{item.label}</div>
                    <div className="truncate text-xs text-ink-3">
                      {item.pageUrl}
                      {item.acquisition === 'rendered' ? ' · 页面渲染' : ''}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-3">
                      <span>
                        已收集 {item.entryCount} 条 · {item.unreadCount} 条未读
                      </span>
                      <span>
                        {item.error ? '更新失败' : '自动更新中'}
                        {item.lastSuccessAt
                          ? ` · 最近检查 ${new Date(item.lastSuccessAt).toLocaleString('zh-CN')}`
                          : ''}
                      </span>
                    </div>
                    {item.error ? (
                      <div className="mt-1 text-xs text-danger">{item.error}</div>
                    ) : null}
                  </div>
                  {confirmingRemoveId === item.id ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        disabled={busy}
                        onClick={() => void handleRemove(item.id)}
                        size="sm"
                        variant="destructive"
                      >
                        确认移除
                      </Button>
                      <Button
                        disabled={busy}
                        onClick={() => setConfirmingRemoveId(null)}
                        size="sm"
                        variant="ghost"
                      >
                        取消
                      </Button>
                    </div>
                  ) : (
                    <Button
                      disabled={busy}
                      onClick={() => setConfirmingRemoveId(item.id)}
                      size="sm"
                      variant="ghost"
                    >
                      移除
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex flex-col gap-2 pt-1">
            <h3 className="text-sm font-medium text-ink">添加订阅</h3>
            <div className="flex gap-2 max-md:flex-col">
              <Input
                aria-label="公告列表页网址"
                disabled={busy}
                onChange={(event) => {
                  setUrl(event.target.value);
                  setPreview(null);
                }}
                placeholder="官网或公告列表页网址"
                value={url}
              />
              <Input
                aria-label="查找栏目或公告"
                className="md:max-w-64"
                disabled={busy}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="关键词：栏目或公告标题"
                value={keyword}
              />
              <Button
                className="shrink-0"
                disabled={busy || !url.trim()}
                onClick={() => void handlePreview()}
                size="sm"
                variant="outline"
              >
                <Plus className="size-4" />
                预览栏目
              </Button>
            </div>

            {preview ? (
              <div className="flex flex-col gap-2 rounded-card bg-inset p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 break-words text-sm font-medium text-ink-2">
                    {preview.title || '页面预览'}
                  </span>
                  {preview.acquisition === 'http' ? (
                    <Button
                      className="shrink-0"
                      disabled={busy}
                      onClick={() => void handlePreview(preview.pageUrl, true)}
                      size="sm"
                      variant="ghost"
                    >
                      使用页面渲染重试
                    </Button>
                  ) : null}
                </div>
                {preview.feeds.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
                    <span>发现 Feed：</span>
                    {preview.feeds.map((feed) => (
                      <Button
                        disabled={busy}
                        key={feed.url}
                        onClick={() => {
                          setUrl(feed.url);
                          void handlePreview(feed.url, false);
                        }}
                        size="sm"
                        variant="outline"
                      >
                        {feed.title || feed.url}
                      </Button>
                    ))}
                  </div>
                ) : null}
                {preview.candidates.length === 0 ? (
                  <div className="flex flex-col gap-2">
                    <p className="text-sm text-ink-3">
                      {preview.sectionLinks?.length
                        ? '当前页面未识别出公告列表，请选择栏目继续。'
                        : '未识别到可订阅的公告列表。请尝试公告列表页网址。'}
                    </p>
                    {sectionLinks.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {sectionLinks.map((link) => (
                          <Button
                            disabled={busy}
                            key={link.url}
                            onClick={() => {
                              setUrl(link.url);
                              setKeyword('');
                              void handlePreview(link.url);
                            }}
                            size="sm"
                            title={link.url}
                            variant="outline"
                          >
                            {link.title}
                          </Button>
                        ))}
                      </div>
                    ) : preview.sectionLinks?.length ? (
                      <p className="text-xs text-ink-3">没有匹配的栏目或公告，请更换关键词。</p>
                    ) : null}
                  </div>
                ) : (
                  <>
                    <div className="flex flex-col gap-1.5">
                      {candidates.length === 0 ? (
                        <p className="px-3 py-2 text-sm text-ink-3">
                          没有匹配的栏目或公告，请更换关键词。
                        </p>
                      ) : null}
                      {candidates.map(({ candidate, index, entries }) => {
                        const expanded = expandedCandidates.includes(index);
                        const label = candidate.label.replace(/\s*查看更多\s*$/, '');
                        return (
                          <div
                            className={cn(
                              'rounded-card transition-colors duration-base',
                              selectedIndex === index ? 'bg-inset' : 'hover:bg-hover',
                            )}
                            key={`${candidate.label}-${index}`}
                          >
                            <button
                              aria-label={`选择栏目：${label}`}
                              aria-pressed={selectedIndex === index}
                              className="flex w-full flex-col gap-1 rounded-card px-3 py-2 text-left"
                              onClick={() => setSelectedCandidate(index)}
                              type="button"
                            >
                              <div className="flex w-full flex-wrap items-center justify-between gap-2">
                                <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-ink">
                                  <Check
                                    aria-hidden="true"
                                    className={cn(
                                      'size-4 shrink-0',
                                      selectedIndex !== index && 'invisible',
                                    )}
                                  />
                                  {label}
                                </span>
                                <span
                                  className="text-xs tabular-nums text-ink-3"
                                  title={candidate.reasons.join('、')}
                                >
                                  {keywords.length > 0
                                    ? `匹配 ${entries.length} / 共 ${candidate.entries.length} 条`
                                    : `${candidate.entries.length} 条`}
                                </span>
                              </div>
                              {(expanded ? entries : entries.slice(0, 3)).map((entry) => (
                                <div
                                  className="flex w-full items-baseline justify-between gap-2 text-xs text-ink-3"
                                  key={entry.url}
                                >
                                  <span className="min-w-0 truncate" title={entry.title}>
                                    {entry.title}
                                  </span>
                                  <span className="shrink-0 tabular-nums">
                                    {entry.publishedAt ?? '日期未知'}
                                  </span>
                                </div>
                              ))}
                            </button>
                            {entries.length > 3 ? (
                              <div className="flex justify-end px-3 pb-2">
                                <Button
                                  aria-expanded={expanded}
                                  aria-label={`${expanded ? '收起' : '查看更多'}：${label}`}
                                  onClick={() =>
                                    setExpandedCandidates((current) =>
                                      current.includes(index)
                                        ? current.filter((value) => value !== index)
                                        : [...current, index],
                                    )
                                  }
                                  size="sm"
                                  variant="ghost"
                                >
                                  {expanded ? '收起' : '查看更多'}
                                </Button>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex justify-end gap-2 pt-1">
                      <Button
                        disabled={busy}
                        onClick={() => setPreview(null)}
                        size="sm"
                        variant="ghost"
                      >
                        取消
                      </Button>
                      <Button
                        disabled={busy || selectedIndex === undefined}
                        onClick={() => void handleConfirm()}
                        size="sm"
                      >
                        订阅所选栏目
                      </Button>
                    </div>
                  </>
                )}
                {preview.diagnostics.length > 0 ? (
                  <details className="text-xs text-ink-3">
                    <summary className="cursor-pointer">识别详情</summary>
                    <p className="mt-2 break-words">{preview.diagnostics.join('；')}</p>
                  </details>
                ) : null}
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      {panelError ? (
        <p className="text-xs text-danger" role="alert">
          {panelError}
        </p>
      ) : null}
    </>
  );
}
