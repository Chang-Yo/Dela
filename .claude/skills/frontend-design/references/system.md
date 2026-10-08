# 设计系统的选择

1. 对于已经有前端代码和设计系统规范的项目，直接沿用原来标准即可；
2. 对于已有前端代码但尚未定义系统规范的项目，阅读代码，提取出合适的设计系统，同样可以参考以下案例；
3. 对于一个全新的项目，根据网页的风格要求，从以下案例中选择一套或多套学习。

**设计系统的规范最好放在单独的文件或文件夹中。**

## 字号规范

可以参考以下设计：

```
4px (16 x 0.25)
8px (16 x 0.5)
12px (16 x 0.75)
16px (16 x 1)
24px (16 x 1.5)
32px (16 x 2)
48px (16 x 3)
64px (16 x 4)
96px (16 x 6)
128px (16 x 8)
192px (16 x 12)
256px (16 x 16)
384px (16 x 24)
512px (16 x 32)
640px (16 x 40)
768px (16 x 48)
```

## 间距规范

使用 8px 网格系统（8pt Grid System），最小步长为 8px，偶尔辅以 4px 半步微调。

## 颜色规范

- **当没有指定主题色系时，默认只使用灰度色阶**
- **禁止文字和背景使用同一色相**，比如浅绿色背景用深绿色文本，浅红色背景用红色文本。宁可不加背景，或者采用不同色相的颜色

你可以参考下列几种配色来决定你的使用。建议选择时采用完整的一套，便于样式的统一。

### 灰色

| Name           | Value     | Token                    | Role                                                                                                               |
| -------------- | --------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Paper White    | `#fafafa` | `--color-paper-white`    | Page canvas, card surfaces, light button fills — the default background that everything else sits on               |
| Pure White     | `#ffffff` | `--color-pure-white`     | Elevated card surfaces, inset highlights, input fields                                                             |
| Hairline       | `#ebebeb` | `--color-hairline`       | 1px borders on buttons, links, and cards — visible at high zoom, invisible at speed                                |
| Ash            | `#c9c9c9` | `--color-ash`            | Disabled text, muted labels, brand name watermarks in customer logos                                               |
| Smoke          | `#a8a8a8` | `--color-smoke`          | Tertiary text, placeholder copy, subtle icon fills                                                                 |
| Graphite       | `#8f8f8f` | `--color-graphite`       | Footer micro-copy, secondary metadata                                                                              |
| Slate          | `#7d7d7d` | `--color-slate`          | Customer brand names in logo strips, muted heading variants                                                        |
| Stone          | `#666666` | `--color-stone`          | Muted captions, helper text, and de-emphasized UI labels.                                                          |
| Charcoal       | `#4d4d4d` | `--color-charcoal`       | Body paragraph text, card descriptions, button secondary labels — where reading weight lives                       |
| Obsidian       | `#171717` | `--color-obsidian`       | Primary headings, nav borders, dark button fills, list markers — near-black that avoids pure #000 harshness        |
| Carbon         | `#000000` | `--color-carbon`         | SVG icon fills, logo marks, the triangle brand glyph — pure black reserved for graphic elements only               |
| Terminal Green | `#297a3a` | `--color-terminal-green` | Green text accent for links, tags, and emphasized short phrases. Use as a supporting accent, not as a status color |

### 蓝色

| Name        | Value     | Token                 | Role                                                                                                                                      |
| ----------- | --------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Apple Blue  | `#0071e3` | `--color-apple-blue`  | Filled action buttons, selected states — the only chromatic interactive color, used sparingly so each appearance carries weight           |
| Link Blue   | `#0066cc` | `--color-link-blue`   | Outlined action borders, inline links — deeper saturation than Apple Blue, used where a filled pill would be too loud                     |
| Signal Blue | `#2997ff` | `--color-signal-blue` | Decorative borders, image outlines, icon strokes — the lightest blue in the system, used for atmospheric emphasis rather than interaction |
| Carbon      | `#1d1d1f` | `--color-carbon`      | Primary text, heading borders, nav rules, card borders — the dominant ink color, near-black with a whisper of warmth                      |
| Frost       | `#f5f5f7` | `--color-frost`       | Page canvas, body backgrounds, footer surface — the signature Apple light gray, slightly cooler than pure white                           |
| Ice         | `#f4f8fb` | `--color-ice`         | Elevated surface washes, subtle fills, button text on dark backgrounds — barely-blue tint that lifts a section without declaring it       |
| Smoke       | `#333333` | `--color-smoke`       | Secondary text, nav fills, button borders — the workhorse neutral for borders and icons that need more presence than mid-gray             |
| Graphite    | `#474747` | `--color-graphite`    | Nav text, nav borders, link borders — sits between Carbon and Smoke for tertiary hierarchy                                                |
| Ash         | `#707070` | `--color-ash`         | Footer text, list borders, nav borders, muted body text — the mid-gray for content that should be present but quiet                       |
| Mist        | `#858585` | `--color-mist`        | Body borders, icon strokes, button borders — the lightest functional gray, for hairline rules on light surfaces                           |
| Onyx        | `#000000` | `--color-onyx`        | Heading borders, nav borders, dark image backgrounds — true black for maximum contrast in promotional and heading contexts                |
| Pebble      | `#e2e2e5` | `--color-pebble`      | Button background fills, disabled surfaces — the only near-white surface that is deliberately grayer than the canvas                      |

### 棕色

| Name          | Value     | Token                   | Role                                                                                                                   |
| ------------- | --------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Warm Cream    | `#ffedd7` | `--color-warm-cream`    | Light text on dark surfaces, inverse labels, and high-contrast captions.                                               |
| Walnut Shadow | `#100904` | `--color-walnut-shadow` | Page canvas and deepest background — warm near-black, not pure black. The void behind every product reveal             |
| Bark Brown    | `#382416` | `--color-bark-brown`    | Elevated surface and filled button background — the one chromatic step above the canvas, used for the single solid CTA |
| Cork Border   | `#40372e` | `--color-cork-border`   | Hairline dividers, dashed section separators, subtle container borders — warmer than the canvas by one step            |
| Driftwood     | `#6c5f51` | `--color-driftwood`     | Mid-tone warm gray for secondary dividers and muted structural elements — the bridge between Bark and Cream            |
| Ember Accent  | `#dc5000` | `--color-ember-accent`  | Orange text accent for links, tags, and emphasized short phrases.                                                      |
| Pure Black    | `#000000` | `--color-pure-black`    | SVG icon fills and decorative vector elements only — never used as a background or text color                          |

### 蓝紫色

| Name            | Value     | Token                     | Role                                                                                                                 |
| --------------- | --------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Indigo Ink      | `#533afd` | `--color-indigo-ink`      | Violet action color for filled buttons, selected navigation states, and focused conversion moments.                  |
| Indigo Hover    | `#7389ff` | `--color-indigo-hover`    | Violet text accent for links, tags, and emphasized short phrases. Do not promote it to the primary CTA color         |
| Midnight Ink    | `#061b31` | `--color-midnight-ink`    | Primary heading and body text — deep near-black with a cool blue undertone that anchors the entire type system       |
| Slate           | `#64748d` | `--color-slate`           | Gray text accent for links, tags, and emphasized short phrases.                                                      |
| Steel           | `#50617a` | `--color-steel`           | Tertiary body text and helper copy — sits between slate and the muted violet tints used on sub-labels                |
| Smoke           | `#839bc8` | `--color-smoke`           | Muted violet-tinted text for large decorative headings and supporting copy — never for body paragraphs               |
| Pure White      | `#ffffff` | `--color-pure-white`      | Page canvas and elevated card surfaces; the default background against which everything else is measured             |
| Mist            | `#f8fafd` | `--color-mist`            | Footer background and section banding — a barely-perceptible cool tint that separates regions without a visible line |
| Frost           | `#e5edf5` | `--color-frost`           | Primary border color, subtle surface tint, and button hover backgrounds; the workhorse neutral that divides content  |
| Lavender Border | `#b9b9f9` | `--color-lavender-border` | Hairline outline button border (1px) — the violet companion to indigo fills; pairs with white text for ghost CTAs    |
| Lilac Border    | `#d6d9fc` | `--color-lilac-border`    | Secondary outline button border and softer dividers; a paler sibling of lavender for tertiary ghost actions          |
| Periwinkle Wash | `#e8e9ff` | `--color-periwinkle-wash` | Lightest violet surface — soft tinted backgrounds for highlighted cards, tag pills, and subtle emphasis blocks       |
| Deep Violet     | `#182659` | `--color-deep-violet`     | Heaviest accent stroke — rare use for emphasized borders or graphic frames; reads almost as a navy                   |
| Amethyst Edge   | `#7f71e6` | `--color-amethyst-edge`   | Mid-violet outline border for developer-facing buttons; sits between indigo ink and lavender border                  |

### 米黄色

| Name           | Value     | Token                    | Role                                                                                                             |
| -------------- | --------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Bone Parchment | `#f8f8f6` | `--color-bone-parchment` | Page canvas, large background areas, nav bar, secondary cards                                                    |
| Paper White    | `#ffffff` | `--color-paper-white`    | Elevated card surfaces, primary content surfaces above the canvas                                                |
| Soft Stone     | `#efeeeb` | `--color-soft-stone`     | Nested card surfaces, subtle background variation, alternate section bands                                       |
| Carbon Ink     | `#121212` | `--color-carbon-ink`     | Primary text, headings, icon fills — warm near-black rather than pure black                                      |
| Graphite       | `#373734` | `--color-graphite`       | Secondary headings, button text, nav text — softer than carbon                                                   |
| Ashen          | `#7b7974` | `--color-ashen`          | Muted helper text, captions, fine print, disclaimer copy                                                         |
| Pebble         | `#9c9a92` | `--color-pebble`         | Tertiary text, copyright, very low-priority labels                                                               |
| Mist           | `#b7b7b5` | `--color-mist`           | Hairline nav dividers, subtle border lines                                                                       |
| Chalk          | `#e7e6e1` | `--color-chalk`          | Decorative illustration fills, soft background tints                                                             |
| Obsidian       | `#000000` | `--color-obsidian`       | Footer background — only true black on the page                                                                  |
| Clay           | `#d97757` | `--color-clay`           | Orange decorative accent for icons, marks, and small graphic details. Do not promote it to the primary CTA color |

### 彩色

| Name        | Value     | Token                 | Role                                                                                                                                      |
| ----------- | --------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Void        | `#08090a` | `--color-void`        | Page canvas, full-bleed backgrounds — the default everything sits on                                                                      |
| Carbon      | `#0f1011` | `--color-carbon`      | Card surfaces, nav bars — one step above canvas for contained content                                                                     |
| Obsidian    | `#161718` | `--color-obsidian`    | Elevated surfaces, deeper card panels                                                                                                     |
| Graphite    | `#23252a` | `--color-graphite`    | Subtle borders, dividers, ghost button outlines — low-contrast structural edges                                                           |
| Smoke       | `#383b3f` | `--color-smoke`       | Hairline borders at higher contrast than graphite — section separators                                                                    |
| Ash         | `#62666d` | `--color-ash`         | Muted body text, inactive icons, secondary metadata                                                                                       |
| Fog         | `#8a8f98` | `--color-fog`         | Tertiary text, placeholder copy, icon fills                                                                                               |
| Mist        | `#d0d6e0` | `--color-mist`        | Secondary headings, button text on dark surfaces                                                                                          |
| Bone        | `#e5e5e6` | `--color-bone`        | Near-white surface fills, high-contrast button text                                                                                       |
| Paper       | `#ffffff` | `--color-paper`       | Primary headings, hero type, max-contrast emphasis text                                                                                   |
| Acid Lime   | `#e4f222` | `--color-acid-lime`   | Primary action buttons, active nav indicators — electric accent that breaks the monochrome system                                         |
| Pulse Green | `#27a644` | `--color-pulse-green` | Green outline accent for tags, dividers, and focused UI edges. Use as a supporting accent, not as a status color                          |
| Coral Red   | `#eb5757` | `--color-coral-red`   | Red wash for highlight backgrounds, decorative bands, and soft emphasis behind content. Use as a supporting accent, not as a status color |
| Signal Teal | `#02b8cc` | `--color-signal-teal` | Decorative accent, informational icon fills                                                                                               |
| Iris Violet | `#6366f1` | `--color-iris-violet` | Tag/badge fills — soft chromatic punctuation on tags and labels                                                                           |
| Lavender    | `#8b5cf6` | `--color-lavender`    | Secondary tag fills, category indicators                                                                                                  |

## 圆角风格

根据对应的网页风格选择对应的圆角风格。

### 无圆角

不设置圆角，采用清晰的直角和直线设计。

### Vercel风格

| Element | Value  |
| ------- | ------ |
| nav     | 2px    |
| cards   | 6px    |
| pills   | 9999px |
| buttons | 6px    |

### Apple风格

| Element | Value |
| ------- | ----- |
| tags    | 980px |
| cards   | 8px   |
| images  | 8px   |
| inputs  | 8px   |
| buttons | 980px |

### shadcn风格

| Element | Value |
| ------- | ----- |
| cards   | 24px  |
| small   | 6px   |
| badges  | 18px  |
| inputs  | 18px  |
| nested  | 10px  |
| buttons | 18px  |

### Goodnotes风格

| Element | Value |
| ------- | ----- |
| tags    | 10px  |
| cards   | 10px  |
| links   | 4px   |
| inputs  | 10px  |
| buttons | 10px  |
