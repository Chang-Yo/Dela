import { useActionState, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download, ExternalLink, Paperclip } from 'lucide-react';
import type { Navigate } from '../../../app/module';
import { createClient, errorMessage } from '../../../core/protocol/contract';
import { showToast } from '../../../ui/toast';
import { Button } from '../../../ui/button';
import { HtmlFrame } from '../../../ui/html-frame';
import { Input } from '../../../ui/input';
import { jwcContract, type JwcNotice } from '../contract';
import { ErrorText } from '../../../ui/error-text';
import { Spinner } from '../../../ui/spinner';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../../../ui/dialog';
import { Field } from '../../../ui/field';

const jwcClient = createClient(jwcContract, window.dela?.bridge);

export function JwcNoticeView({
  target: { noticeId },
  navigate,
}: {
  target: { noticeId: string };
  navigate: Navigate;
}) {
  const query = useQuery({
    queryKey: ['jwc', 'notice', noticeId],
    queryFn: () => jwcClient.notice(noticeId),
  });
  const notice = query.data;
  const [attachment, setAttachment] = useState<JwcNotice['attachments'][number] | null>(null);
  const attachmentsRef = useRef<HTMLElement>(null);
  const openLink = (url: string) => {
    const file = notice?.attachments.find((entry) => entry.url === url);
    if (file) setAttachment(file);
    else window.open(url);
  };
  return (
    <div className="mx-auto h-full w-full max-w-4xl overflow-y-auto px-6 py-6 [scrollbar-width:none] max-md:px-4">
      <header>
        <div className="mb-3 flex items-center justify-between gap-3">
          <Button size="sm" variant="ghost" onClick={() => navigate({ page: 'notifications' })}>
            <ArrowLeft className="size-4" />
            返回通知
          </Button>
          {notice && (
            <Button size="sm" variant="ghost" onClick={() => window.open(notice.url)}>
              <ExternalLink className="size-4" />
              查看原文
            </Button>
          )}
        </div>
        <h1 className="break-words text-xl font-semibold">{notice?.title}</h1>
        <p className="mt-2 flex flex-wrap items-center gap-x-1.5 text-sm text-ink-3">
          <span>教务处</span>
          {notice && (
            <>
              <span aria-hidden="true">·</span>
              <span>
                {new Date(notice.publishedAt).toLocaleDateString('zh-CN', {
                  timeZone: 'Asia/Shanghai',
                })}
              </span>
            </>
          )}
          {notice && notice.attachments.length > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-chip outline-none transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
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
      {query.error ? (
        <div role="alert" className="py-6 text-sm text-danger">
          <p>{errorMessage(query.error)}</p>
          <Button className="mt-3" variant="outline" onClick={() => void query.refetch()}>
            重试
          </Button>
        </div>
      ) : !notice ? (
        <p role="status" className="flex items-center gap-2 py-6 text-sm text-ink-3">
          <Spinner />
          正在读取通知…
        </p>
      ) : (
        <>
          <HtmlFrame
            baseUrl={notice.url}
            className="mt-5 overflow-hidden rounded-card bg-paper"
            html={notice.html}
            onLink={openLink}
            title="教务处通知正文"
          />
          {notice.attachments.length > 0 && (
            <section
              ref={attachmentsRef}
              aria-label="相关附件"
              className="mt-6 scroll-mt-6 border-t border-line pt-4"
            >
              <h2 className="text-sm font-medium text-ink-3">附件</h2>
              <ul className="-mx-2 mt-1">
                {notice.attachments.map((file) => (
                  <li key={file.id}>
                    <button
                      type="button"
                      className="group flex w-full items-start gap-2 rounded-control px-2 py-1.5 text-left text-sm text-ink-2 outline-none transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
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
          noticeId={noticeId}
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
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [code, setCode] = useState('');
  // 每张验证码只能用一次：换一张时递增 revision，旧图不缓存。
  const captchaQuery = useQuery({
    queryKey: ['jwc', 'captcha', noticeId, attachment.id, revision],
    queryFn: () => jwcClient.captcha({ noticeId, attachmentId: attachment.id }),
    staleTime: Infinity,
    gcTime: 0,
  });
  const captcha = captchaQuery.data;
  const nextCaptcha = () => {
    setCode('');
    setRevision((value) => value + 1);
  };
  const [, submit, pending] = useActionState(async () => {
    if (!captcha) return;
    setError('');
    try {
      const result = await jwcClient.download({ token: captcha.token, code });
      if (result.status === 'invalid-code') {
        setError('验证码不正确或已过期，请重新输入');
        nextCaptcha();
      } else if (result.status === 'saved') {
        showToast({ variant: 'success', title: '附件已保存' });
        onClose();
      }
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }, undefined);
  const shownError = error || (captchaQuery.error ? errorMessage(captchaQuery.error) : '');
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent size="sm">
        <DialogTitle>下载附件</DialogTitle>
        <DialogDescription className="break-words">{attachment.name}</DialogDescription>
        <form action={submit} className="mt-4 flex flex-col gap-3">
          <div className="flex items-center gap-3">
            {captcha ? (
              <img src={captcha.image} alt="下载验证码" className="h-10 w-auto rounded-control" />
            ) : (
              <span role="status" className="text-sm text-ink-3">
                {captchaQuery.error ? '验证码未加载' : '正在加载验证码…'}
              </span>
            )}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setError('');
                nextCaptcha();
              }}
            >
              换一张
            </Button>
          </div>
          <Field label="验证码">
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
          </Field>
          {shownError && <ErrorText size="sm">{shownError}</ErrorText>}
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={pending || !captcha || !/^\d{4}$/.test(code)}>
              {pending ? '正在下载…' : '下载'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
