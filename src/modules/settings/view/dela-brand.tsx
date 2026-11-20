import blackLogo from '../../../../assets/Dela_black_bg.svg';
import whiteLogo from '../../../../assets/Dela_white_bg.svg';
import { cn } from '../../../ui/lib/cn';

export function DelaBrand({ alt = 'Dela', className }: { alt?: string; className?: string }) {
  return (
    <span className={cn('inline-grid', className)}>
      <img
        alt={alt}
        className="dela-brand-light col-start-1 row-start-1 h-full w-auto"
        src={whiteLogo}
      />
      <img
        alt=""
        aria-hidden="true"
        className="dela-brand-dark col-start-1 row-start-1 h-full w-auto"
        src={blackLogo}
      />
    </span>
  );
}
