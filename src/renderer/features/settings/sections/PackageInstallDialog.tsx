import { useEffect, useState } from 'react';
import { Dialog } from 'radix-ui';
import { FolderOpen, LoaderCircle } from 'lucide-react';
import type { PiPackageView } from '../../../../shared/api';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { errorText } from '../../../workspace/store';
import { dialogOverlay, dialogPanel } from '../../../components/ui/motion';
import { cn } from '../../../lib/utils';

/** 安装前告知：扩展的权限边界与责任归属。勾选确认后才能安装。 */
const risks = [
  '扩展是第三方代码，与 Dela 在同一进程、以同样的权限运行，能读写本机文件、访问网络，也能读到 Dela 保存的数据与凭据。',
  '远程项目里，扩展的代码同样在本机运行。',
  '包的行为由包作者负责；Dela 只负责安装、启用、禁用与卸载。',
];

/** 安装 Pi package：输入来源（npm / git / 本地目录），确认风险后安装；装好默认不启用。 */
export function PackageInstallDialog({
  onClose,
  onInstalled,
  runtimeReady,
}: {
  onClose: () => void;
  onInstalled: (views: PiPackageView[]) => void;
  /** npm 运行时就绪：没有时只能装本地目录与 git。 */
  runtimeReady: boolean;
}) {
  const [source, setSource] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => window.dela?.packages.onProgress((event) => setProgress(event.message)), []);

  const submit = async () => {
    const value = source.trim();
    if (!window.dela || busy || !value || !accepted) return;
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      onInstalled(await window.dela.packages.install(value));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root onOpenChange={(open) => !open && !busy && onClose()} open>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content className={cn(dialogPanel, 'max-h-[85vh] max-w-md overflow-y-auto')}>
          <Dialog.Title className="text-base font-semibold">安装 Pi package</Dialog.Title>
          <Dialog.Description className="mt-2 text-xs leading-relaxed text-ink-3">
            装好后默认关闭，在列表里启用。
          </Dialog.Description>
          <form
            className="mt-4 grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <label className="grid gap-2 text-13">
              来源
              <div className="flex gap-2">
                <Input
                  aria-label="包来源"
                  autoComplete="off"
                  autoFocus
                  className="font-mono text-xs"
                  disabled={busy}
                  onChange={(event) => setSource(event.target.value)}
                  placeholder="npm:@scope/name@1.0.0"
                  spellCheck={false}
                  value={source}
                />
                <Button
                  aria-label="选择本地目录"
                  disabled={busy}
                  onClick={() =>
                    void window.dela?.packages.pickLocal().then((path) => path && setSource(path))
                  }
                  size="icon"
                  type="button"
                  variant="outline"
                >
                  <FolderOpen />
                </Button>
              </div>
              <span className="text-xs leading-relaxed text-ink-3">
                npm:包名[@版本]、git:github.com/作者/仓库[@ref]、仓库网址，或本地目录。
                {!runtimeReady && ' npm 暂不可用，可先安装本地目录或 git 来源。'}
              </span>
            </label>

            <div className="grid gap-2 rounded-card bg-inset p-3">
              <ul className="grid list-disc gap-1.5 pl-4 text-xs leading-relaxed text-ink-2">
                {risks.map((risk) => (
                  <li key={risk}>{risk}</li>
                ))}
              </ul>
              <label className="flex items-center gap-2 text-xs text-ink">
                <input
                  checked={accepted}
                  className="size-3.5 accent-[var(--ink-2)]"
                  disabled={busy}
                  onChange={(event) => setAccepted(event.target.checked)}
                  type="checkbox"
                />
                我已了解，并信任这个来源
              </label>
            </div>

            {busy && progress && (
              <p className="flex items-center gap-1.5 text-xs text-ink-3" role="status">
                <LoaderCircle className="size-3 animate-spin" />
                <span className="truncate">{progress}</span>
              </p>
            )}
            {error && (
              <p className="text-xs [overflow-wrap:anywhere] text-red" role="alert">
                {error}
              </p>
            )}
            <div className="flex items-center justify-end gap-2">
              <Button disabled={busy} onClick={onClose} type="button" variant="ghost">
                取消
              </Button>
              <Button disabled={busy || !accepted || !source.trim()} type="submit">
                {busy ? '安装中…' : '安装'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
