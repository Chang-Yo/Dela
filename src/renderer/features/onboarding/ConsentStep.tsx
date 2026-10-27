import { useCallback, useEffect, useRef, useState } from 'react';
import privacy from '../../../../docs/privacy.md?raw';
import terms from '../../../../docs/terms.md?raw';
import { LegalMarkdown } from '../../components/legal-markdown';
import { OnboardingWindowBar } from './onboarding-window-bar';

/** 正文顶部的「最后更新」就是这一版的日期，接受记录据此回溯同意的是哪一版。 */
function revisionOf(markdown: string) {
  return /最后更新：(\S+)/.exec(markdown)?.[1] ?? 'unknown';
}

/** 两份都读到最底部并同意后才放行，这里没有跳过。 */
const documents = [
  { key: 'terms', title: '使用条款', markdown: terms, revision: revisionOf(terms) },
  { key: 'privacy', title: '隐私条款', markdown: privacy, revision: revisionOf(privacy) },
] as const;

// 滚动位置的浮点误差与浏览器取整能差几个像素，留一点容差，别让按钮卡在临界点上。
const bottomSlackPx = 8;

type BackupState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'exported'; path: string; skipped: string[] }
  | { kind: 'failed'; reason?: string };

type ConsentStepProps = {
  /** 本机已有数据时才给「导出本机数据」出口：全新安装没有可导出的东西。 */
  canBackup: boolean;
  /** 两份条款都接受后回调。 */
  onAgree: () => void;
};

/**
 * 条款接受页：开场动画之后、配置向导之前。
 * 「同意并继续」在文本框滚到底部之前保持禁用；换下一份条款时滚动位置与门禁一起重置。
 *
 * 「不同意并退出」走 window.quit() 真正结束进程。窗口栏的关闭按钮走的是 close()，
 * 那只是把窗口收进托盘、后台同步继续跑（这个托盘应用的既有约定），不是这里的语义。
 */
export function ConsentStep({ canBackup, onAgree }: ConsentStepProps) {
  const [index, setIndex] = useState(0);
  const [readToEnd, setReadToEnd] = useState(false);
  const [backup, setBackup] = useState<BackupState>({ kind: 'idle' });
  const boxRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const current = documents[index]!;
  const isLast = index === documents.length - 1;
  // 界面里能拿到 window.dela 才谈得上导出；浏览器预览下这一页仍然只是只读正文。
  const offersBackup = canBackup && Boolean(window.dela);

  const sync = useCallback(() => {
    const box = boxRef.current;
    if (!box) return;
    // 读到底就不再回退：导出提示出现、窗口变矮这类只改变文本框高度的抖动不该把已经读完的人
    // 重新锁住——正文没变，读过的就是读过了，否则刚点完导出还得再滚一下才能同意。
    setReadToEnd(
      (was) => was || box.scrollHeight - box.scrollTop - box.clientHeight <= bottomSlackPx,
    );
  }, []);

  // 文本框与正文都要观察：窗口只往两侧拉宽时文本框自身高度不变（它由 grid 轨道决定），
  // 但正文会重排——可能不再溢出，也可能多出几行，两种情况下都没有滚动事件可听。
  // 换条款时另外把焦点交给正文：「同意并继续」在那一刻变回禁用，焦点留在它身上会被浏览器
  // 丢回 body，键盘与读屏用户就此失去位置。首屏不抢焦点，那时还没有人失去位置。
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    sync();
    if (index > 0) box.focus();
    const observer = new ResizeObserver(sync);
    observer.observe(box);
    if (contentRef.current) observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, [index, sync]);

  const agree = () => {
    if (!readToEnd) return;
    // 留证：只追加一行，版本由界面给，时间与应用版本由主进程盖章，写失败由主进程记日志，
    // 这里不拦住用户继续同意。
    void window.dela?.consent.record(current.key, current.revision).catch(() => {});
    if (isLast) {
      onAgree();
      return;
    }
    // 与换页同批提交：新一份条款不会带着上一份的「已到底」短暂地可用一帧。
    setIndex(index + 1);
    setReadToEnd(false);
  };

  const runBackup = async () => {
    const api = window.dela;
    if (!api || backup.kind === 'running') return;
    setBackup({ kind: 'running' });
    try {
      const result = await api.backup.exportData();
      if (result.status === 'cancelled') setBackup({ kind: 'idle' });
      else if (result.status === 'failed') setBackup({ kind: 'failed', reason: result.reason });
      else setBackup({ kind: 'exported', path: result.path, skipped: result.skipped });
    } catch {
      setBackup({ kind: 'failed' });
    }
  };

  const backupHint = () => {
    if (backup.kind === 'running') return '正在导出本机数据…';
    if (backup.kind === 'failed')
      return backup.reason ? `导出失败：${backup.reason}` : '导出失败，可以稍后重试。';
    if (backup.kind === 'exported') {
      // 只报事实，不猜原因：复制失败可能来自占用，也可能来自权限、磁盘空间或符号链接，
      // 主进程一律按「这个条目没复制成功」回报。
      const skipped = backup.skipped.length
        ? `；以下条目没有复制成功：${backup.skipped.join('、')}，导出内容可能不完整`
        : '';
      return `已导出到 ${backup.path}${skipped}`;
    }
    return '导出内容包含凭据与密钥，建议保存到本机位置。';
  };

  const hint = backupHint();

  return (
    <div className="grid h-dvh grid-rows-[auto_1fr_auto] bui-light bg-surface text-ink">
      <OnboardingWindowBar />

      {/* 文本框没有确定高度就不会滚：minmax(0,1fr) 与 min-h-0 让它在矮窗口里被压缩，
       * 而不是把页面撑高。 */}
      <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] justify-items-center gap-4 px-6 pt-8">
        <header className="grid w-full max-w-[42rem] gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{current.title}</h1>
          <p className="text-13 leading-relaxed text-ink-3">
            第 {index + 1} 份，共 {documents.length} 份 · 阅读至底部后即可继续
          </p>
        </header>
        {/* key 让换条款时重建元素：滚动位置在提交前就归零，不必等 effect。 */}
        <div
          aria-label={`${current.title}正文`}
          className="w-full max-w-[42rem] min-h-0 overflow-y-auto overscroll-contain rounded-card border border-line bg-page px-5 py-4 text-13 leading-relaxed text-ink-2"
          data-consent-text=""
          key={current.key}
          onScroll={sync}
          ref={boxRef}
          role="region"
          tabIndex={0}
        >
          <div ref={contentRef}>
            <LegalMarkdown markdown={current.markdown} />
          </div>
        </div>
      </div>

      <div className="grid gap-3 px-6 pb-6 pt-5">
        {offersBackup ? (
          <p
            className="mx-auto w-full max-w-[42rem] text-13 leading-relaxed text-ink-3"
            role="status"
          >
            {hint}
          </p>
        ) : null}
        <div className="mx-auto flex w-full max-w-[42rem] items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {offersBackup ? (
              <button
                className="h-10 rounded-card px-5 text-13 text-ink-2 shadow-hairline transition-colors hover:bg-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                disabled={backup.kind === 'running'}
                onClick={() => void runBackup()}
                type="button"
              >
                导出本机数据
              </button>
            ) : null}
            <button
              className="h-10 rounded-card px-5 text-13 text-ink-2 shadow-hairline transition-colors hover:bg-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
              disabled={backup.kind === 'running'}
              onClick={() => {
                window.dela?.window.quit();
              }}
              type="button"
            >
              不同意并退出
            </button>
          </div>
          <button
            className="h-10 rounded-card bg-ink px-6 text-13 font-medium text-surface transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!readToEnd}
            onClick={agree}
            type="button"
          >
            同意并继续
          </button>
        </div>
      </div>
    </div>
  );
}
