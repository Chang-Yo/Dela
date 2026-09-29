import { useState } from 'react';
import { Dialog } from 'radix-ui';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import type { McpServerView } from '../../../../../shared/api';
import { errorText } from '../../../../workspace/store';
import { mcpUpdatePatch, parseMcpForm } from './mcp-logic';

export type McpEditState = { mode: 'create' } | { mode: 'edit'; server: McpServerView } | null;

/** code 类 textarea（args/env），样式与连接页令牌输入一致。 */
const codeAreaClass =
  'min-h-20 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:border-destructive dark:bg-input/30';

/** MCP 添加/编辑共用表单：新建提交 addMcpServer；编辑提交部分补丁（command/args/env 留空保持原值，视图不携带现值）。 */
export function McpFormDialog({
  editing,
  onClose,
  onSaved,
}: {
  editing: Exclude<McpEditState, null>;
  onClose: () => void;
  /** 提交成功后回传主进程返回的最新服务器列表（含 connecting 中间态）。 */
  onSaved: (views: McpServerView[]) => void;
}) {
  const isEdit = editing.mode === 'edit';
  const [name, setName] = useState(isEdit ? editing.server.name : '');
  const [command, setCommand] = useState('');
  const [argsText, setArgsText] = useState('');
  const [envText, setEnvText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const dela = window.dela;
    if (!dela || busy) return;
    // 先本地校验（名称/命令/env 格式），失败保留输入就地报错；通道错误同样保留输入。
    const parsed = parseMcpForm({ name, command, argsText, envText }, { commandRequired: !isEdit });
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const views = isEdit
        ? await dela.capability.updateMcpServer(editing.server.id, mcpUpdatePatch(parsed))
        : await dela.capability.addMcpServer(parsed);
      onSaved(views);
      onClose();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root onOpenChange={(open) => !open && !busy && onClose()} open>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30 data-[state=open]:animate-in data-[state=open]:fade-in duration-150" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-full max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-background p-6 shadow-xl max-md:w-[calc(100%-2rem)]">
          <Dialog.Title className="text-base font-semibold">
            {isEdit ? `编辑 ${editing.server.name}` : '添加 MCP 服务器'}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {isEdit
              ? '修改名称或连接配置；留空的 command / 参数 / 环境变量保持原值不变（保存后会重连）。'
              : '以 stdio 方式启动本地命令进程，为 Agent 提供外部工具与资源；保存后自动连接。'}
          </Dialog.Description>
          <form
            className="mt-4 grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <label className="grid gap-2 text-sm">
              名称
              <Input
                autoComplete="off"
                onChange={(event) => setName(event.target.value)}
                placeholder="weather"
                required
                value={name}
              />
            </label>
            <label className="grid gap-2 text-sm">
              command
              <Input
                autoComplete="off"
                onChange={(event) => setCommand(event.target.value)}
                placeholder={isEdit ? '留空保持不变' : 'npx'}
                required={!isEdit}
                spellCheck={false}
                value={command}
              />
            </label>
            <label className="grid gap-2 text-sm">
              参数（每行一个）
              <textarea
                className={codeAreaClass}
                onChange={(event) => setArgsText(event.target.value)}
                placeholder={'-y\n@modelcontextprotocol/server-weather'}
                rows={3}
                spellCheck={false}
                value={argsText}
              />
            </label>
            <label className="grid gap-2 text-sm">
              环境变量（每行 KEY=VALUE）
              <textarea
                className={codeAreaClass}
                onChange={(event) => setEnvText(event.target.value)}
                placeholder={'WEATHER_API_KEY=…'}
                rows={3}
                spellCheck={false}
                value={envText}
              />
            </label>
            {error && (
              <p className="text-xs text-destructive" role="alert">
                {error}
              </p>
            )}
            <div className="flex items-center justify-end gap-2">
              <Button disabled={busy} onClick={onClose} variant="ghost">
                取消
              </Button>
              <Button disabled={busy} type="submit">
                {busy ? '处理中…' : '保存'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
