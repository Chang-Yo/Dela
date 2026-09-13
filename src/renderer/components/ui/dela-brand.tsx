import blackLogo from '../../../../assets/Dela_black_bg.svg';
import whiteLogo from '../../../../assets/Dela_white_bg.svg';
import { cn } from '../../lib/utils';

/**
 * 应用内品牌图：浅色主题显示白底、深色显示黑底，切换规则在 globals.css
 * （与明暗 token 同源）。两张图同尺寸叠放在同一网格单元，切换无布局位移。
 */
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
