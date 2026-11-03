import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from 'radix-ui';
import { ArrowLeft, Download, ExternalLink, LoaderCircle, Paperclip } from 'lucide-react';
import type { JwcNotice, NotificationItem } from '../../../shared/notifications';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { dialogOverlay, dialogPanel } from '../../components/ui/motion';
import { sanitizeHtml } from '../../lib/sanitize-html';
import { useRootFontSize } from '../../lib/root-font-size';
import { cn } from '../../lib/utils';
import { errorText } from '../../workspace/store';
import { showToast } from '../../app/toasts';

const INITIAL_BODY_HEIGHT = 240;

export function JwcNoticeView({ item, onBack }: { item: NotificationItem; onBack: () => void }) {
  const [notice, setNotice] = useState<JwcNotice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [attachment, setAttachment] = useState<JwcNotice['attachments'][number] | null>(null);
  const [body, setBody] = useState<HTMLElement | null>(null);
  const [height, setHeight] = useState(INITIAL_BODY_HEIGHT);
  const attachmentsRef = useRef<HTMLElement>(null);
  const rootSize = useRootFontSize();
  useEffect(() => {
    let active = true;
    setError(null);
    void window.dela!.notifications.getJwcNotice(item.id).then(
      (value) => {
        if (active) setNotice(value);
      },
      (reason) => {
        if (active) setError(errorText(reason));
      },
    );
    return () => {
      active = false;
    };
  }, [item.id, retry]);
  useEffect(() => {
    if (!body) return;
    const update = () => setHeight(body.scrollHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(body);
    return () => observer.disconnect();
  }, [body]);
  const html = useMemo(
    () => (notice ? sanitizeHtml(notice.html, notice.url, rootSize) : ''),
    [notice, rootSize],
  );
  const openLink = (url: string) => {
    const file = notice?.attachments.find((entry) => entry.url === url);
    if (file) setAttachment(file);
    else
      void window
        .dela!.canvas.openLink(url)
        .catch((reason) =>
          showToast({ variant: 'error', title: '打开链接失败', description: errorText(reason) }),
        );
  };
  return (
    <div className="mx-auto h-full w-full max-w-4xl overflow-y-auto px-6 py-6 [scrollbar-width:none] max-md:px-4">
      <header>
        <div className="mb-3 flex items-center justify-between gap-3">
          <Button size="sm" variant="ghost" onClick={onBack}>
            <ArrowLeft className="size-4" />
            返回通知
          </Button>
          {item.href.kind === 'jwc' && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (item.href.kind === 'jwc') openLink(item.href.url);
              }}
            >
              <ExternalLink className="size-4" />
              查看原文
            </Button>
          )}
        </div>
        <h1 className="break-words text-xl font-semibold">{item.title}</h1>
        <p className="mt-2 flex flex-wrap items-center gap-x-1.5 text-13 text-ink-3">
          <span>教务处</span>
          <span aria-hidden="true">·</span>
          <span>
            {new Date(item.createdAt).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })}
          </span>
          {notice && notice.attachments.length > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-chip outline-none transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-bui-accent"
                onClick={() =>
                  attachmentsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }
              >
                <Paperclip className="size-3.5" />
                {notice.attachments.length} 个附件
              </button>
            </>
          )}
        </p>
      </header>
      {error ? (
        <div role="alert" className="py-6 text-13 text-red">
          <p>{error}</p>
          <Button className="mt-3" variant="outline" onClick={() => setRetry((value) => value + 1)}>
            重试
          </Button>
        </div>
      ) : !notice ? (
        <p role="status" className="flex items-center gap-2 py-6 text-13 text-ink-3">
          <LoaderCircle className="size-4 animate-spin" />
          正在读取通知…
        </p>
      ) : (
        <>
          <iframe
            title="教务处通知正文"
            className="mt-5 block w-full overflow-hidden rounded-card border-0 bg-white"
            sandbox="allow-same-origin"
            referrerPolicy="no-referrer"
            srcDoc={html}
            style={{ height }}
            onLoad={(event) => {
              const document = event.currentTarget.contentDocument;
              setBody(document?.body ?? null);
              document?.addEventListener('click', (click) => {
                const target = (click.target as Element).closest?.('a[href]');
                if (target) {
                  click.preventDefault();
                  openLink(target.getAttribute('href')!);
                }
              });
            }}
          />
          {notice.attachments.length > 0 && (
            <section
              ref={attachmentsRef}
              aria-label="相关附件"
              className="mt-6 scroll-mt-6 border-t border-line pt-4"
            >
              <h2 className="text-13 font-medium text-ink-3">附件</h2>
              <ul className="-mx-2 mt-1">
                {notice.attachments.map((file) => (
                  <li key={file.id}>
                    <button
                      type="button"
                      className="group flex w-full items-start gap-2 rounded-control px-2 py-1.5 text-left text-13 text-ink-2 outline-none transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-bui-accent"
                      onClick={() => setAttachment(file)}
                    >
                      <Paperclip className="mt-0.5 size-3.5 shrink-0 text-ink-3" />
                      <span className="min-w-0 flex-1 break-words group-hover:underline group-hover:underline-offset-2">
                        {file.name}
                      </span>
                      <Download className="mt-0.5 size-3.5 shrink-0 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      {attachment && (
        <AttachmentDownload
          key={attachment.id}
          noticeId={item.id}
          attachment={attachment}
          onClose={() => setAttachment(null)}
        />
      )}
    </div>
  );
}

function AttachmentDownload({
  noticeId,
  attachment,
  onClose,
}: {
  noticeId: string;
  attachment: JwcNotice['attachments'][number];
  onClose: () => void;
}) {
  const [captcha, setCaptcha] = useState<{ token: string; image: string } | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [code, setCode] = useState('');
  useEffect(() => {
    let active = true;
    setCaptcha(null);
    setCode('');
    void window.dela!.notifications.getJwcCaptcha(noticeId, attachment.id).then(
      (value) => {
        if (active) setCaptcha(value);
      },
      (reason) => {
        if (active) setError(errorText(reason));
      },
    );
    return () => {
      active = false;
    };
  }, [noticeId, attachment.id, revision]);
  const [, submit, pending] = useActionState(async () => {
    if (!captcha) return;
    setError('');
    try {
      const result = await window.dela!.notifications.downloadJwcAttachment(captcha.token, code);
      if (result.status === 'invalid-code') {
        setError('验证码不正确或已过期，请重新输入');
        setRevision((value) => value + 1);
      } else if (result.status === 'saved') {
        showToast({ variant: 'success', title: '附件已保存' });
        onClose();
      }
    } catch (reason) {
      setError(errorText(reason));
    }
  }, undefined);
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content className={cn(dialogPanel, 'max-w-sm')}>
          <Dialog.Title className="text-base font-semibold">下载附件</Dialog.Title>
          <Dialog.Description className="mt-2 break-words text-13 text-ink-3">
            {attachment.name}
          </Dialog.Description>
          <form action={submit} className="mt-4 flex flex-col gap-3">
            <div className="flex items-center gap-3">
              {captcha ? (
                <img src={captcha.image} alt="下载验证码" className="h-10 w-auto rounded-control" />
              ) : (
                <span role="status" className="text-13 text-ink-3">
                  {error ? '验证码未加载' : '正在加载验证码…'}
                </span>
              )}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  setError('');
                  setRevision((value) => value + 1);
                }}
              >
                换一张
              </Button>
            </div>
            <label className="flex flex-col gap-2 text-13">
              验证码
              <Input
                autoFocus
                inputMode="numeric"
                autoComplete="off"
                maxLength={4}
                pattern="[0-9]{4}"
                required
                value={code}
                onChange={(event) => setCode(event.target.value)}
                disabled={pending}
                placeholder="输入四位数字"
              />
            </label>
            {error && (
              <p role="alert" className="text-13 text-red">
                {error}
              </p>
            )}
            <div className="mt-2 flex justify-end gap-2">
              <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
                取消
              </Button>
              <Button type="submit" disabled={pending || !captcha || !/^\d{4}$/.test(code)}>
                {pending ? '正在下载…' : '下载'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
