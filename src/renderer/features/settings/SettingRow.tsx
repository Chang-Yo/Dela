import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

/**
 * 设置分区单行：标签列（标题+说明）贴左，控件列右对齐到内容右缘同一条竖线；
 * 行间用分隔线承担边界（外观/工作区/远程共用）。控件与失败提示都落在右侧控件列。
 * `leading` 是标签列前面的身份方块（如远程连接的云朵头像），它属于标签列，不参与右侧对齐。
 * 分组容器（SettingsGroup）负责给这行留出左右内边距，所以分隔线在容器里自然内缩。
 *
 * 窄屏也保持「标签左、控件右」同一行：标签列给 11rem 起跳宽度（约 13 个汉字）撑住可读性，
 * 控件放不下时自己换到下一行并右对齐，而不是把标签压成竖排。控件再宽也不会挤扁标签。
 */
export function SettingRow({
  children,
  description,
  leading,
  nested,
  settingId,
  title,
}: {
  children: ReactNode;
  /** 说明可以是多行：远程连接把「目的地 · 私钥」与探测结果都放在这里。 */
  description?: ReactNode;
  leading?: ReactNode;
  /** 从属行（如总开关下的子项）：缩进一级，分隔线也跟着起点内移。 */
  nested?: boolean;
  settingId: string;
  title: string;
}) {
  const label = (
    <div className="grid content-start gap-1">
      <h3 className="text-13 font-medium text-ink">{title}</h3>
      {description && <p className="text-xs leading-relaxed text-ink-3">{description}</p>}
    </div>
  );
  return (
    <div
      className={cn('border-b border-line py-3.5 last:border-0', nested && 'ml-4')}
      data-setting-id={settingId}
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {leading ? (
          <div className="flex w-44 min-w-0 grow items-center gap-3">
            {leading}
            {label}
          </div>
        ) : (
          <div className="w-44 grow">{label}</div>
        )}
        <div className="ml-auto grid content-start justify-items-end gap-2">{children}</div>
      </div>
    </div>
  );
}
