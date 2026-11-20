import type { ComponentProps } from 'react';
import { Check } from 'lucide-react';
import { Button } from '../../../ui/button';
import { Select, SelectContent, SelectTrigger, SelectValue } from '../../../ui/select';
import { Spinner } from '../../../ui/spinner';

export type StepButtonState = 'idle' | 'busy' | 'success';

type StepButtonProps = {
  state: StepButtonState;
  idleLabel: string;
  busyLabel: string;
  successLabel: string;
  disabled?: boolean;
  type?: ComponentProps<typeof Button>['type'];
  /** 仅独立的 type="button" 使用；表单内提交按钮走 form onSubmit，保证 required 校验对点击和回车一致。 */
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
    <Button
      className="w-full data-[state=success]:bg-accent"
      data-state={state}
      disabled={disabled || state === 'busy'}
      onClick={onClick}
      size="lg"
      type={type}
    >
      {state === 'busy' && <Spinner />}
      {state === 'success' && <Check aria-hidden="true" />}
      {state === 'idle' ? idleLabel : state === 'busy' ? busyLabel : successLabel}
    </Button>
  );
}

export function StepSelect({
  label,
  children,
  placeholder,
  ...rest
}: ComponentProps<typeof Select> & {
  label: string;
  placeholder?: string;
}) {
  return (
    <Select {...rest}>
      <SelectTrigger aria-label={label} className="w-full" size="lg">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      {/* 弹层 portal 到 body，脱离向导的 .theme-light 作用域，需单独带上。 */}
      <SelectContent className="theme-light">{children}</SelectContent>
    </Select>
  );
}
