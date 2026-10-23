// Pi 扩展的界面请求在应用层统一接住：对话框（select / confirm / input / editor）按到达顺序逐个弹出，
// 通知与报错走 toast，写输入框直接改对应会话的草稿。挂在应用层而不是聊天标签里：扩展可能在用户
// 切走之后才发起请求，对话框不能因为标签被卸载而丢失（丢失的请求主进程会一直等到超时）。
import { useEffect, useState } from 'react';
import { Dialog } from 'radix-ui';
import type { ExtensionUiReply, ExtensionUiRequest } from '../../../shared/api';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { dialogOverlay, dialogPanel } from '../../components/ui/motion';
import { cn } from '../../lib/utils';
import { showToast } from '../../app/toasts';
import { useChatDrafts } from './drafts';

export function ExtensionUiHost() {
  const [queue, setQueue] = useState<ExtensionUiRequest[]>([]);

  useEffect(() => {
    const api = window.dela?.packages;
    if (!api) return;
    const stops = [
      api.onUiRequest((request) => setQueue((items) => [...items, request])),
      api.onUiDismiss((id) => setQueue((items) => items.filter((item) => item.id !== id))),
      api.onUiEvent((event) => {
        if (event.type === 'notify')
          showToast({
            variant: event.level === 'error' ? 'error' : 'neutral',
            title: event.level === 'warning' ? '扩展提醒' : '扩展消息',
            description: event.message,
          });
        else if (event.type === 'error')
          showToast({
            variant: 'error',
            title: `扩展出错：${event.extension}`,
            description: event.message,
          });
        else if (event.type === 'unsupported')
          showToast({
            variant: 'neutral',
            title: '扩展的部分界面在 Dela 中不可用',
            description: `${event.feature}依赖 Pi 的终端界面，已忽略。`,
          });
        else if (event.type === 'editor-text') {
          const { drafts, update } = useChatDrafts.getState();
          const current = drafts[event.sessionId]?.prompt ?? '';
          update(event.sessionId, {
            prompt: event.mode === 'paste' ? `${current}${event.text}` : event.text,
          });
        }
      }),
    ];
    return () => stops.forEach((stop) => stop());
  }, []);

  const current = queue[0];
  if (!current) return null;
  const answer = (value: ExtensionUiReply) => {
    setQueue((items) => items.filter((item) => item.id !== current.id));
    void window.dela?.packages.reply(current.id, value);
  };
  return <ExtensionDialog key={current.id} onAnswer={answer} request={current} />;
}

function ExtensionDialog({
  request,
  onAnswer,
}: {
  request: ExtensionUiRequest;
  onAnswer: (value: ExtensionUiReply) => void;
}) {
  const [text, setText] = useState(request.kind === 'editor' ? (request.prefill ?? '') : '');
  const description =
    request.kind === 'confirm'
      ? request.message
      : request.kind !== 'editor' && request.timeoutMs
        ? `${Math.round(request.timeoutMs / 1000)} 秒内未回应将自动取消。`
        : null;

  return (
    <Dialog.Root onOpenChange={(open) => !open && onAnswer(null)} open>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content
          {...(description ? {} : { 'aria-describedby': undefined })}
          className={cn(
            dialogPanel,
            'max-h-[85vh] overflow-y-auto',
            request.kind === 'editor' ? 'max-w-xl' : 'max-w-sm',
          )}
        >
          <span className="text-2xs font-medium text-ink-3">扩展请求</span>
          <Dialog.Title className="mt-1 text-base font-semibold [overflow-wrap:anywhere]">
            {request.title}
          </Dialog.Title>
          {description && (
            <Dialog.Description className="mt-2 text-xs leading-relaxed whitespace-pre-wrap text-ink-3">
              {description}
            </Dialog.Description>
          )}

          {request.kind === 'select' && (
            <ul aria-label={request.title} className="mt-4 grid gap-1" role="listbox">
              {request.options.map((option, index) => (
                <li key={`${index}:${option}`}>
                  <button
                    autoFocus={index === 0}
                    className="w-full rounded-control px-3 py-2 text-left text-13 text-ink-2 transition-colors duration-150 hover:bg-hover hover:text-ink focus-visible:bg-hover focus-visible:text-ink focus-visible:outline-none"
                    onClick={() => onAnswer(option)}
                    role="option"
                    aria-selected={false}
                    type="button"
                  >
                    {option}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {(request.kind === 'input' || request.kind === 'editor') && (
            <form
              className="mt-4 grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                onAnswer(text);
              }}
            >
              {request.kind === 'input' ? (
                <Input
                  aria-label={request.title}
                  autoFocus
                  onChange={(event) => setText(event.target.value)}
                  placeholder={request.placeholder}
                  value={text}
                />
              ) : (
                <Textarea
                  aria-label={request.title}
                  autoFocus
                  className="min-h-48 resize-y font-mono text-xs"
                  onChange={(event) => setText(event.target.value)}
                  value={text}
                />
              )}
              <div className="flex justify-end gap-2">
                <Button onClick={() => onAnswer(null)} type="button" variant="ghost">
                  取消
                </Button>
                <Button type="submit">确定</Button>
              </div>
            </form>
          )}

          {request.kind === 'confirm' && (
            <div className="mt-4 flex justify-end gap-2">
              <Button onClick={() => onAnswer(false)} variant="ghost">
                取消
              </Button>
              <Button autoFocus onClick={() => onAnswer(true)}>
                确定
              </Button>
            </div>
          )}
          {request.kind === 'select' && (
            <div className="mt-3 flex justify-end">
              <Button onClick={() => onAnswer(null)} variant="ghost">
                取消
              </Button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
