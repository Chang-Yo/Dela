"""把开屏手写文字的字形导出成 SVG path，供渲染层逐字连续描边。

用法：python scripts/generate-intro-lettering.py
依赖（仅开发期，不进应用依赖）：fonttools + brotli
  python -m pip install --target <临时目录> fonttools brotli

坐标以 font-size = 1em 为单位、y 轴向下、基线在 y = 0，渲染层直接用 em 尺寸摆放。
长度按笔画分段采样累加，供 stroke-dasharray 精确使用；轮廓长度算错就会出现虚线残留。
"""

from __future__ import annotations

import math
from pathlib import Path

from fontTools.pens.basePen import BasePen
from fontTools.ttLib import TTFont

FONT_PATH = Path('assets/fonts/Italianno.woff2')
OUT_PATH = Path('src/renderer/features/onboarding/intro-lettering.ts')
LINES = {
    'name': 'Dela',
    'quote': 'In a shallow age, refuse to float.',
    'author': '— ChangYo',
}
CURVE_STEPS = 24
DECIMALS = 3
# 字体是子集：没有空格字形，也没有 em dash。空格按常见字宽给固定值，
# 破折号借用字体自己的连字符并横向拉伸，保持同一笔风格。
SPACE_ADVANCE = 0.26
DASH_GLYPH = 'hyphen'
DASH_STRETCH = 2.2


def _fmt(value: float) -> str:
    text = f'{value:.{DECIMALS}f}'.rstrip('0').rstrip('.')
    return '0' if text in ('', '-0') else text


def _quad_length(p0, p1, p2) -> float:
    length = 0.0
    prev = p0
    for step in range(1, CURVE_STEPS + 1):
        t = step / CURVE_STEPS
        u = 1 - t
        point = (
            u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
            u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
        )
        length += math.dist(prev, point)
        prev = point
    return length


def _cubic_length(p0, p1, p2, p3) -> float:
    length = 0.0
    prev = p0
    for step in range(1, CURVE_STEPS + 1):
        t = step / CURVE_STEPS
        u = 1 - t
        point = (
            u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0],
            u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1],
        )
        length += math.dist(prev, point)
        prev = point
    return length


class OutlinePen(BasePen):
    """逐轮廓收集 path 与长度；轮廓之间是独立子路径，长度必须分开算。"""

    def __init__(self, glyphSet, upem: int, x_scale: float = 1.0):
        super().__init__(glyphSet)
        self.upem = upem
        self.x_scale = x_scale
        self.contours: list[dict] = []
        self._xs: list[float] = []
        self._ys: list[float] = []
        self._current: dict | None = None
        self._start: tuple[float, float] | None = None
        self._last: tuple[float, float] | None = None

    def _scale(self, point) -> tuple[float, float]:
        return (point[0] * self.x_scale, point[1])

    def _point(self, point) -> tuple[float, float]:
        self._xs.append(point[0])
        self._ys.append(point[1])
        return point

    def _moveTo(self, raw_point):
        point = self._scale(raw_point)
        self._point(point)
        self._current = {'commands': [f'M{_fmt(point[0] / self.upem)} {_fmt(-point[1] / self.upem)}'], 'length': 0.0}
        self.contours.append(self._current)
        self._start = point
        self._last = point

    def _lineTo(self, raw_point):
        point = self._scale(raw_point)
        self._point(point)
        assert self._current and self._last
        self._current['commands'].append(
            f'L{_fmt(point[0] / self.upem)} {_fmt(-point[1] / self.upem)}'
        )
        self._current['length'] += math.dist(self._last, point) / self.upem
        self._last = point

    def _qCurveToOne(self, raw_point1, raw_point2):
        point1, point2 = self._scale(raw_point1), self._scale(raw_point2)
        self._point(point1)
        self._point(point2)
        assert self._current and self._last
        self._current['commands'].append(
            'Q{cx} {cy} {x} {y}'.format(
                cx=_fmt(point1[0] / self.upem),
                cy=_fmt(-point1[1] / self.upem),
                x=_fmt(point2[0] / self.upem),
                y=_fmt(-point2[1] / self.upem),
            )
        )
        self._current['length'] += _quad_length(self._last, point1, point2) / self.upem
        self._last = point2

    def _curveToOne(self, raw_point1, raw_point2, raw_point3):
        point1, point2, point3 = (
            self._scale(raw_point1),
            self._scale(raw_point2),
            self._scale(raw_point3),
        )
        self._point(point1)
        self._point(point2)
        self._point(point3)
        assert self._current and self._last
        self._current['commands'].append(
            'C{c1x} {c1y} {c2x} {c2y} {x} {y}'.format(
                c1x=_fmt(point1[0] / self.upem),
                c1y=_fmt(-point1[1] / self.upem),
                c2x=_fmt(point2[0] / self.upem),
                c2y=_fmt(-point2[1] / self.upem),
                x=_fmt(point3[0] / self.upem),
                y=_fmt(-point3[1] / self.upem),
            )
        )
        self._current['length'] += _cubic_length(self._last, point1, point2, point3) / self.upem
        self._last = point3

    def _closePath(self):
        if self._current is None:
            return
        self._current['commands'].append('Z')
        if self._start is not None and self._last is not None and self._last != self._start:
            self._current['length'] += math.dist(self._last, self._start) / self.upem

    def _endPath(self):
        self._closePath()


def main() -> None:
    font = TTFont(FONT_PATH)
    upem = font['head'].unitsPerEm
    cmap = font.getBestCmap()
    glyph_set = font.getGlyphSet()
    hmtx = font['hmtx']

    lines: dict[str, dict] = {}
    for key, text in LINES.items():
        pen_x = 0.0
        glyphs = []
        xs: list[float] = []
        ys: list[float] = []
        for char in text:
            if char == ' ':
                glyphs.append({'char': char, 'advance': SPACE_ADVANCE, 'x': pen_x, 'contours': []})
                pen_x += SPACE_ADVANCE
                continue
            codepoint = ord(char)
            name = cmap.get(codepoint)
            x_scale = 1.0
            if name is None and char == '—':
                name, x_scale = DASH_GLYPH, DASH_STRETCH
            if name is None:
                raise SystemExit(f'{key}: 字体缺少字符 {char!r}')
            pen = OutlinePen(glyph_set, upem, x_scale)
            glyph_set[name].draw(pen)
            advance = hmtx[name][0] / upem * x_scale
            glyphs.append(
                {
                    'char': char,
                    'advance': advance,
                    'x': pen_x,
                    'contours': [
                        {'d': ' '.join(contour['commands']), 'length': contour['length']}
                        for contour in pen.contours
                    ],
                }
            )
            pen_x += advance
            xs.extend(pen._xs)
            ys.extend(pen._ys)
        min_x = (min(xs) if xs else 0.0) / upem
        max_x = (max(xs) if xs else pen_x * upem) / upem
        # y 轴已翻转：字形向上为负，所以行盒顶边取 min(-y)、底边取 max(-y)。
        top = (-max(ys) if ys else 0.0) / upem
        bottom = (-min(ys) if ys else 0.0) / upem
        lines[key] = {
            'glyphs': glyphs,
            'width': pen_x,
            'box': {
                'x': min_x,
                'y': top,
                'width': max(max_x, pen_x) - min_x,
                'height': bottom - top,
            },
        }

    out = [
        '// 由 scripts/generate-intro-lettering.py 生成，勿手改。',
        '// 单位是 font-size = 1em，y 轴向下，基线在 y = 0。',
        '',
        'export type LetteringContour = { d: string; length: number };',
        '',
        'export type LetteringGlyph = {',
        '  char: string;',
        '  advance: number;',
        '  x: number;',
        '  contours: LetteringContour[];',
        '};',
        '',
        'export type LetteringLine = {',
        '  glyphs: LetteringGlyph[];',
        '  width: number;',
        '  box: { x: number; y: number; width: number; height: number };',
        '};',
        '',
        'export const INTRO_LETTERING = {',
    ]
    for key, line in lines.items():
        out.append(f'  {key}: {{')
        out.append(f"    width: {_fmt(line['width'])},")
        box = line['box']
        out.append(
            '    box: {{ x: {}, y: {}, width: {}, height: {} }},'.format(
                _fmt(box['x']), _fmt(box['y']), _fmt(box['width']), _fmt(box['height'])
            )
        )
        out.append('    glyphs: [')
        for glyph in line['glyphs']:
            out.append('      {')
            out.append(f"        char: {glyph['char']!r},")
            out.append(f"        advance: {_fmt(glyph['advance'])},")
            out.append(f"        x: {_fmt(glyph['x'])},")
            if not glyph['contours']:
                out.append('        contours: [],')
            else:
                out.append('        contours: [')
                for contour in glyph['contours']:
                    out.append(
                        "          { d: '%s', length: %s },"
                        % (contour['d'], _fmt(contour['length']))
                    )
                out.append('        ],')
            out.append('      },')
        out.append('    ],')
        out.append('  },')
    out.append('} satisfies Record<string, LetteringLine>;')
    out.append('')

    OUT_PATH.write_text('\n'.join(out), encoding='utf-8', newline='\n')
    total = sum(len(g['contours']) for line in lines.values() for g in line['glyphs'])
    print(f'{OUT_PATH} 已生成：{len(lines)} 行、{total} 个轮廓、{OUT_PATH.stat().st_size} 字节')


if __name__ == '__main__':
    main()
