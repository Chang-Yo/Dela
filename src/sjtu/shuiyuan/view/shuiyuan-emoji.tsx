import { nameToEmoji } from 'gemoji';
import { Fragment } from 'react';
import type { ShuiyuanCustomEmoji } from '../contract';
import { SHUIYUAN_ORIGIN } from './shuiyuan-format';
import { useSiteStructure } from './use-shuiyuan';

type ShuiyuanTitleSegment = string | { name: string; url: string };

// Discourse 标题短代码形如 :ocean:；前后不接 ASCII 字母数字，避免误吃 14:30:00 这类时间。
const SHORTCODE_PATTERN = /(?<![a-zA-Z0-9]):([\p{L}\p{N}_+-]+):(?![a-zA-Z0-9])/gu;

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

export function ShuiyuanTitle({ text }: { text: string }) {
  const segments = decodeShuiyuanTitle(text, useSiteStructure()?.customEmoji);
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
