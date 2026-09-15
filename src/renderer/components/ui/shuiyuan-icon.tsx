import shuiyuanLogo from '../../../../assets/shuiyuan_logo.svg';

/** 水源社区图标（用户提供的水滴 SVG），用于主导航等处替代 lucide 通用图标。 */
export function ShuiyuanIcon({
  className,
  strokeWidth: _strokeWidth,
}: {
  className?: string;
  /** 兼容主导航统一传参；位图图标没有描边概念。 */
  strokeWidth?: number;
}) {
  return <img alt="" aria-hidden="true" className={className} src={shuiyuanLogo} />;
}
