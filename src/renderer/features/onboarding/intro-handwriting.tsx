import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';
import { INTRO_LETTERING } from './intro-lettering';

export type LetteringKey = keyof typeof INTRO_LETTERING;

/**
 * 描边粗细，单位是用户单位——viewBox 就是 em 盒，所以 1 个单位等于一个字号宽。
 * 0.025 即字号的 2.5%：30px 下约 0.75px、60px 下约 1.5px，只勾出一条笔迹。
 */
const STROKE_WIDTH = 0.025;

/**
 * 手写文字：字形在构建期已转成精确路径，这里按书写顺序逐个描出——同一字的多个轮廓
 * 共用一条虚线，i 的点、o 的内圈这类短轮廓自然落在末段收笔。相邻字错开 charDelay
 * 且小于单字时长，笔势彼此衔接，读起来是一条连续动作而不是把轮廓一起画完。
 */
export function HandwritingLine({
  charDelay,
  className,
  delay,
  duration,
  instant = false,
  line,
}: {
  line: LetteringKey;
  /** 字号与颜色走外层 class（font-script / text-6xl 等），尺寸按 em 跟着字号缩放。 */
  className?: string;
  duration: number;
  /** 相邻字的起始间隔（秒），应小于 duration 才会连笔。 */
  charDelay: number;
  delay: number;
  /** 减弱动效时直接给出终态，不做描边。 */
  instant?: boolean;
}) {
  const { box, glyphs } = INTRO_LETTERING[line];
  return (
    <svg
      // 逐字路径读屏没有意义，整行给一个 aria-label。
      aria-label={glyphs.map((glyph) => glyph.char).join('')}
      className={cn('block overflow-visible', className)}
      style={{
        width: `${box.width}em`,
        height: `${box.height}em`,
      }}
      role="img"
      viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
    >
      {glyphs.map((glyph, index) => {
        // 一个字的所有轮廓必须合成同一个 path：e/a/o/g 的内圈只有作为同一 path 的子路径，
        // nonzero 填充才会挖空它；拆成多个 path 会把内圈一并填实，大字呈墨块。
        const d = glyph.contours.map((contour) => contour.d).join(' ');
        // 虚线长度取该字最长轮廓：短轮廓于是只在末段显现，不会提前露出碎片。
        const dash = glyph.contours.reduce((max, contour) => Math.max(max, contour.length), 0);
        return (
          <g key={`${index}-${glyph.char}`} transform={`translate(${glyph.x} 0)`}>
            <motion.path
              animate={{ fillOpacity: 1, strokeDashoffset: 0 }}
              d={d}
              fill="currentColor"
              initial={instant ? false : { fillOpacity: 0, strokeDashoffset: dash }}
              stroke="currentColor"
              strokeDasharray={dash}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={STROKE_WIDTH}
              transition={
                instant
                  ? { duration: 0 }
                  : { delay: delay + index * charDelay, duration, ease: 'easeOut' }
              }
            />
          </g>
        );
      })}
    </svg>
  );
}
