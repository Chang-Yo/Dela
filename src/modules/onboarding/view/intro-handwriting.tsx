import type { CSSProperties } from 'react';
import { cn } from '../../../ui/lib/cn';
import { INTRO_LETTERING } from './intro-lettering';

export type LetteringKey = keyof typeof INTRO_LETTERING;

const STROKE_WIDTH = 0.025;

/**
 * 手写文字：字形构建期已转成路径，按书写顺序逐个描出，同一字的多个轮廓共用一条虚线；
 * 相邻字错开 charDelay 且小于单字时长，笔势才连贯。
 */
export function HandwritingLine({
  charDelay,
  className,
  delay,
  duration,
  line,
}: {
  line: LetteringKey;
  className?: string;
  duration: number;
  charDelay: number;
  delay: number;
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
            <path
              className="animate-stroke-draw motion-reduce:animate-none"
              d={d}
              fill="currentColor"
              stroke="currentColor"
              strokeDasharray={dash}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={STROKE_WIDTH}
              style={
                {
                  '--dash': dash,
                  animationDelay: `${delay + index * charDelay}s`,
                  animationDuration: `${duration}s`,
                } as CSSProperties
              }
            />
          </g>
        );
      })}
    </svg>
  );
}
