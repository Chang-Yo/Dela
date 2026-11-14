import { nameToEmoji } from 'gemoji';
import { Fragment, useMemo } from 'react';
import type { ShuiyuanCustomEmoji } from '../../../shared/api';
import { SHUIYUAN_ORIGIN } from './shuiyuan-format';
import { useShuiyuan } from './store';

/** 标题段：字符串为已替换的文本，对象为站点自定义 emoji（远程图片）。 */
type ShuiyuanTitleSegment = string | { name: string; url: string };

// Discourse 标题短代码形如 :ocean:；前后不接 ASCII 字母数字，避免误吃 14:30:00 这类时间。
const SHORTCODE_PATTERN = /(?<![a-zA-Z0-9]):([\p{L}\p{N}_+-]+):(?![a-zA-Z0-9])/gu;

/** 标题里的 emoji 短代码 → Unicode emoji / 自定义 emoji 段；未注册的按 Discourse 行为保留原文。 */
export function decodeShuiyuanTitle(
  title: string,
  customEmoji?: readonly ShuiyuanCustomEmoji[],
): ShuiyuanTitleSegment[] {
  const custom = new Map(customEmoji?.map((item) => [item.name, item.url]));
  const segments: ShuiyuanTitleSegment[] = [];
  let cursor = 0;
  for (const match of title.matchAll(SHORTCODE_PATTERN)) {
    const name = match[1];
    const start = match.index;
    if (name === undefined || start === undefined) continue;
    const emoji = nameToEmoji[name];
    const url = custom.get(name);
    if (emoji === undefined && url === undefined) continue;
    if (start > cursor) segments.push(title.slice(cursor, start));
    segments.push(
      emoji ?? (url!.startsWith('/') ? { name, url: SHUIYUAN_ORIGIN + url } : { name, url: url! }),
    );
    cursor = start + match[0].length;
  }
  if (cursor < title.length) segments.push(title.slice(cursor));
  return segments;
}

/** 标题渲染：信息流、阅读页、收藏与来源卡共用，站点结构未就绪时自定义 emoji 退回原文。 */
export function ShuiyuanTitle({ text }: { text: string }) {
  const structure = useShuiyuan((state) => state.structure);
  const segments = useMemo(
    () => decodeShuiyuanTitle(text, structure?.customEmoji),
    [text, structure],
  );
  return (
    <>
      {segments.map((segment, index) => (
        <Fragment key={index}>
          {typeof segment === 'string' ? (
            segment
          ) : (
            <img
              alt={`:${segment.name}:`}
              className="inline-block h-[1.1em] w-auto align-text-bottom"
              draggable={false}
              loading="lazy"
              src={segment.url}
            />
          )}
        </Fragment>
      ))}
    </>
  );
}
