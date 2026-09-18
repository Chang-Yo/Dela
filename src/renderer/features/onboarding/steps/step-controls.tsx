import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { Check, Loader2 } from 'lucide-react';
import { cn } from '../../../lib/utils';

// 向导步骤的统一控件：纯白画布上使用固定中性配色，不随明暗主题变化。
// 所有主按钮全宽、同一高度与圆角，保证五个步骤的排版节奏一致。

export type StepButtonState = 'idle' | 'busy' | 'success';

type StepButtonProps = {
  state: StepButtonState;
  idleLabel: string;
  busyLabel: string;
  /** success 态的按钮文案，如「连接成功，下一步」；点击进入下一步。 */
  successLabel: string;
  disabled?: boolean;
  type?: ButtonHTMLAttributes<HTMLButtonElement>['type'];
  /**
   * 仅 type="button" 的独立按钮使用；表单内的提交按钮不要传，
   * 走 form onSubmit 单通道，保证原生 required 校验对点击和回车同样生效。
   */
  onClick?: () => void;
};

export function StepButton({
  state,
  idleLabel,
  busyLabel,
  successLabel,
  disabled,
  type = 'submit',
  onClick,
}: StepButtonProps) {
  return (
    <button
      className={cn(
        'grid h-10 w-full place-items-center rounded-lg text-sm font-medium text-white transition-all',
        state === 'success'
          ? 'bg-[var(--onboarding-accent)] hover:opacity-90'
          : 'bg-neutral-900 hover:bg-neutral-700',
        (disabled || state === 'busy') && 'cursor-not-allowed opacity-50 hover:bg-neutral-900',
      )}
      disabled={disabled || state === 'busy'}
      onClick={onClick}
      type={type}
    >
      <span className="flex items-center gap-2">
        {state === 'busy' && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        {state === 'success' && <Check className="size-4" aria-hidden="true" />}
        {state === 'idle' ? idleLabel : state === 'busy' ? busyLabel : successLabel}
      </span>
    </button>
  );
}

const fieldClasses =
  'w-full rounded-lg border border-neutral-200 bg-white text-sm text-neutral-900 outline-none transition-[border-color,box-shadow] placeholder:text-neutral-400 focus:border-neutral-400 focus:ring-4 focus:ring-neutral-900/5 aria-invalid:border-red-400';

export function StepInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldClasses, 'h-10 px-3', className)} {...rest} />;
}

export function StepSelect({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(fieldClasses, 'h-10 px-3', className)} {...rest} />;
}

export function StepTextarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(fieldClasses, 'min-h-24 resize-y px-3 py-2 font-mono text-xs', className)}
      {...rest}
    />
  );
}
