import { load, loadBuffer, type CheerioAPI } from 'cheerio';
import { z } from 'zod';

type HtmlNode = ReturnType<CheerioAPI>['0'];

export interface NoticeEntry {
  id: string;
  title: string;
  url: string;
  publishedAt: string | null;
}

export const noticeRuleSchema = z.discriminatedUnion('kind', [
  z.object({
    version: z.literal(1),
    kind: z.literal('html'),
    pageUrl: z.url(),
    label: z.string(),
    containerSelector: z.string().min(1),
    itemSelector: z.string().min(1),
    linkSelector: z.string().nullable(),
    expectsDates: z.boolean(),
    parts: z
      .array(
        z.object({
          containerSelector: z.string().min(1),
          itemSelector: z.string().min(1),
          linkSelector: z.string().nullable(),
          label: z.string().optional(),
        }),
      )
      .optional(),
  }),
  z.object({ version: z.literal(1), kind: z.literal('feed'), pageUrl: z.url(), label: z.string() }),
]);

export type NoticeRule = z.infer<typeof noticeRuleSchema>;

export interface NoticeCandidate {
  label: string;
  score: number;
  reasons: string[];
  entries: NoticeEntry[];
  rule: NoticeRule;
}

export interface NoticeAnalysis {
  pageUrl: string;
  title: string;
  status: 'ok' | 'needs-selection' | 'unsupported';
  candidates: NoticeCandidate[];
  feeds: { title: string; url: string }[];
  sectionLinks?: { title: string; url: string }[];
  diagnostics: string[];
}

export interface AnalyzeOptions {
  sampleTitle?: string;
  charset?: string;
}

const normalizeText = (text: string) =>
  text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[·•●]\s*/, '');
function semanticWords(value: string): string[] {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/);
}

function dateElements($: CheerioAPI, element: ReturnType<CheerioAPI>) {
  return element.find('time,[datetime],[class],div,span,p,td').filter((_, node) => {
    const candidate = $(node);
    if (candidate.is('time,[datetime]')) return true;
    if (candidate.is('a,h1,h2,h3,h4') || candidate.find('a[href]').length) return false;
    const text = normalizeText(orderedText($, node)).replace(/^[（([]\s*(.*?)\s*[）)\]]$/, '$1');
    return (
      semanticWords(candidate.attr('class') ?? '').some((word) =>
        ['date', 'time', 'calendar'].includes(word),
      ) ||
      (/^(?:发布时间|发布日期|(?:以上(?:新闻|公告|消息))?发布于|日期|Published(?:\s+on)?|Posted(?:\s+on)?)\s*[:：]?\s*/i.test(
        text,
      ) &&
        dateIn(text) !== null) ||
      (/^[\d\s年月日,.:/—–-]+$/.test(text) && dateIn(text) !== null) ||
      (/^[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}$/.test(text) && dateIn(text) !== null)
    );
  });
}

function orderedText($: CheerioAPI, node: HtmlNode | undefined): string {
  if (!node) return '';
  if (node.type === 'text') return $(node).text();
  return $(node)
    .contents()
    .toArray()
    .map((child) => orderedText($, child))
    .join(' ');
}

function stripChrome($: CheerioAPI): void {
  $('script,style,noscript,template').remove();
}

const chromeCache = new WeakMap<CheerioAPI, WeakMap<HtmlNode, boolean>>();

function isChrome($: CheerioAPI, node: HtmlNode): boolean {
  let cache = chromeCache.get($);
  if (!cache) {
    cache = new WeakMap();
    chromeCache.set($, cache);
  }
  const ancestors: HtmlNode[] = [];
  let current: HtmlNode | undefined = node;
  let excluded = false;
  while (current) {
    const known = cache.get(current);
    if (known !== undefined) {
      excluded = known;
      break;
    }
    ancestors.push(current);
    const wrapper: ReturnType<CheerioAPI> = $(current);
    if (
      wrapper.is(
        'nav,menu,[role="navigation"],[role="menu"],[role="menubar"],[role="banner"],[role="contentinfo"],[hidden],[aria-hidden="true"]',
      )
    ) {
      excluded = true;
      break;
    }
    const localHeader = wrapper.is('header') && wrapper.closest('article,section').length > 0;
    if (wrapper.is('header,footer') && !localHeader) {
      excluded = true;
      break;
    }
    if (!wrapper.is('html,body,main,[role="main"]')) {
      excluded = [wrapper.attr('class') ?? '', wrapper.attr('id') ?? '']
        .join(' ')
        .split(/\s+/)
        .some((token) => {
          if (localHeader && /^header\d*$/i.test(token)) return false;
          if (
            /^(?:(?:site|main|primary|secondary|top|bottom)[_-])?(?:nav(?:igation|bar)?|menu|header|footer|foot)\d*$/i.test(
              token,
            )
          )
            return true;
          if (/^(?:menu|nav)[_-](?:l|r|left|right)$/i.test(token)) return false;
          const words = semanticWords(token);
          return (
            !['has', 'with', 'without', 'no'].includes(words[0] ?? '') &&
            words.some((word) => /^(?:sub)?(?:nav(?:igation|bar)?|menu|menubar)\d*$/.test(word))
          );
        });
      if (excluded) break;
    }
    current = wrapper.parent().get(0);
  }
  for (const ancestor of ancestors) cache.set(ancestor, excluded);
  return excluded;
}
const noiseTitle =
  /^(?:更多[+＋>]?|查看(?:详情|更多)|了解详情|详情|首页|上一页|下一页|末页|返回|more|read more|next|previous)$/i;
const authenticationTitle =
  /^(?:(?:sign[ -]?(?:in|up|out)|log[ -]?(?:in|out))(?: with .+)?|register|create (?:an? |your )?account|continue with .+|(?:forgot|reset) (?:your )?password\??|(?:用户|账号|账户|立即)?(?:登录|登陆|注册)|统一身份认证登录|(?:忘记|重置|找回)密码[?？]?)$/i;

export function validateNoticeUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('订阅地址仅支持不含账号密码的 HTTP(S) URL');
  return url.href;
}

function articleUrl(rawUrl: string, baseUrl: string, anchorIds?: Set<string>): string | null {
  if (!rawUrl.trim()) return null;
  try {
    const url = new URL(rawUrl, baseUrl);
    validateNoticeUrl(url.href);
    const base = new URL(baseUrl);
    base.hash = '';
    const fragment = url.hash;
    url.hash = '';
    if (url.href === base.href) {
      return fragment && anchorIds?.has(decodeURIComponent(fragment.slice(1)))
        ? url.href + fragment
        : null;
    }
    return rawUrl.trim().startsWith('#') ? null : url.href;
  } catch {
    return null;
  }
}

function documentFor(input: string | Buffer, charset?: string) {
  const prefix = typeof input === 'string' ? input : input.toString();
  const isFeed = /^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<(?:rss|feed)(?:\s|>)/i.test(
    prefix,
  );
  const options = { xml: isFeed, encoding: { transportLayerEncodingLabel: charset } };
  const $ = typeof input === 'string' ? load(input, options) : loadBuffer(input, options);
  const anchors = new Set<string>();
  $('article').each((_, node) => {
    const targets = [node, ...$(node).find('h1[id],h2[id],h3[id]').toArray()];
    for (const target of targets) {
      const id = $(target).attr('id');
      if (
        id &&
        $(node)
          .find('h1 a[href],h2 a[href],h3 a[href]')
          .toArray()
          .some((link) => $(link).attr('href') === `#${id}`)
      )
        anchors.add(id);
    }
  });
  articleAnchors.set($, anchors);
  return { $, isFeed };
}

function dateIn(text: string): string | null {
  const normalized = normalizeText(text);
  const direct = normalized.match(/\b(\d{4})\s*[-./年]\s*(\d{1,2})\s*[-./月]\s*(\d{1,2})(?:日|\b)/);
  const reversed = normalized.match(/(?:^|\s)(\d{1,2})\s+(\d{4})\s*[-./]\s*(\d{1,2})(?:\s|$)/);
  const monthFirst = normalized.match(
    /(?:^|\s)(\d{1,2})\s*[-./]\s*(\d{1,2})\s*\/?\s*(\d{4})(?:\s|$)/,
  );
  const english = normalized.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+(\d{1,2}),?\s+(\d{4})\b/i,
  );
  const months = [
    'jan',
    'feb',
    'mar',
    'apr',
    'may',
    'jun',
    'jul',
    'aug',
    'sep',
    'oct',
    'nov',
    'dec',
  ];
  const parts: [number, number, number] | null = direct
    ? [Number(direct[1]), Number(direct[2]), Number(direct[3])]
    : reversed
      ? [Number(reversed[2]), Number(reversed[3]), Number(reversed[1])]
      : monthFirst
        ? [Number(monthFirst[3]), Number(monthFirst[1]), Number(monthFirst[2])]
        : english
          ? [
              Number(english[3]),
              months.indexOf(english[1]!.slice(0, 3).toLowerCase()) + 1,
              Number(english[2]),
            ]
          : null;
  if (!parts) return null;
  const [year, month, day] = parts;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function rowDate($: CheerioAPI, row: HtmlNode): string | null {
  const dated = dateElements($, $(row));
  for (const node of dated.toArray()) {
    const datetime = $(node).attr('datetime')?.trim();
    if (
      datetime &&
      dateIn(datetime.slice(0, 10)) &&
      /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(datetime)
    ) {
      const timestamp = new Date(datetime);
      if (!Number.isNaN(timestamp.valueOf())) return timestamp.toISOString();
    }
    const date = dateIn(datetime ?? orderedText($, node));
    if (date) return date;
  }
  const content = $(row).clone();
  content.find('a,h1,h2,h3,h4,p').remove();
  return dateIn(orderedText($, content.get(0)));
}

function linkTitle($: CheerioAPI, link: HtmlNode): string {
  const element = $(link);
  const heading =
    element
      .find(
        'h1,h2,h3,h4,[class~="h1"],[class~="h2"],[class~="h3"],[class~="h4"],[class*="title"],[class~="tit"]',
      )
      .toArray()
      .map((node) => normalizeText($(node).text()))
      .find((title) => title.length >= 4 && !/^[\d\s年月日:./-]+$/.test(title)) ?? '';
  const content = element.clone();
  dateElements($, content).remove();
  let title = normalizeText(
    element.attr('title') || (heading.length >= 4 ? heading : content.text()),
  );
  title = title.replace(/(?:查看|了解)(?:详情|更多)\s*[>+＋]*$/g, '').trim();
  return title;
}

const articleAnchors = new WeakMap<CheerioAPI, Set<string>>();
const linkCache = new WeakMap<
  CheerioAPI,
  WeakMap<HtmlNode, { node: HtmlNode; title: string; url: string }[]>
>();

function primaryLink($: CheerioAPI, row: HtmlNode, pageUrl: string) {
  let cache = linkCache.get($);
  if (!cache) {
    cache = new WeakMap();
    linkCache.set($, cache);
  }
  const collect = (node: HtmlNode): { node: HtmlNode; title: string; url: string }[] => {
    const known = cache.get(node);
    if (known) return known;
    const distinct = new Map<string, { node: HtmlNode; title: string; url: string }>();
    if (!isChrome($, node)) {
      const handler = $(node).attr('onclick') ?? '';
      const literal = handler.match(
        /^\s*(?:(?:window\.)?location\.href\s*=\s*(['"])([^'"]+)\1|(?:windowOpen|window\.open)\(\s*(['"])([^'"]+)\3\s*\))\s*;?\s*$/,
      );
      const href = $(node).attr('href') ?? literal?.[2] ?? literal?.[4];
      const articleHeading = $(node).is('article')
        ? $(node)
            .find('h1 a[href],h2 a[href],h3 a[href]')
            .toArray()
            .find((link) => articleAnchors.get($)?.has(($(link).attr('href') ?? '').slice(1)))
        : undefined;
      if (articleHeading) {
        const link = articleHeading;
        for (const target of collect(link)) distinct.set(target.url, target);
      } else if (href !== undefined) {
        const title = linkTitle($, node);
        const url = articleUrl(href, pageUrl, articleAnchors.get($));
        if (
          url &&
          title.length >= 4 &&
          title.length <= 250 &&
          !noiseTitle.test(title) &&
          !authenticationTitle.test(title)
        )
          distinct.set(url, { node, title, url });
      } else {
        for (const child of $(node).children().toArray()) {
          for (const link of collect(child)) {
            const previous = distinct.get(link.url);
            if (!previous || link.title.length > previous.title.length)
              distinct.set(link.url, link);
          }
          if (distinct.size > 1) break;
        }
      }
    }
    const links = [...distinct.values()];
    cache.set(node, links);
    return links;
  };
  const links = collect(row);
  return links.length === 1 ? links[0]! : null;
}

function selectorPart($: CheerioAPI, node: HtmlNode): string {
  const element = $(node);
  const tag = String(element.prop('tagName')).toLowerCase();
  const classes = (element.attr('class') ?? '').split(/\s+/).filter(Boolean).slice(0, 2);
  return tag + classes.map((value) => `[class~=${JSON.stringify(value)}]`).join('');
}

function pathTo($: CheerioAPI, node: HtmlNode, stop?: HtmlNode): string | null {
  if (node === stop) return null;
  const segments: string[] = [];
  let current: HtmlNode | undefined = node;
  while (current && current !== stop && !$(current).is('html')) {
    const element: ReturnType<CheerioAPI> = $(current);
    const id = element.attr('id');
    const idSelector = id ? `[id=${JSON.stringify(id)}]` : null;
    if (!stop && idSelector && $(idSelector).length === 1) {
      segments.unshift(idSelector);
      return segments.join(' > ');
    }
    let segment = selectorPart($, current);
    const parent: ReturnType<CheerioAPI> = element.parent();
    if (parent.children(segment).length > 1) {
      const tag = String(element.prop('tagName')).toLowerCase();
      segment += `:nth-of-type(${
        parent
          .children(tag)
          .toArray()
          .findIndex((node) => node === current) + 1
      })`;
    }
    segments.unshift(segment);
    current = parent.get(0);
  }
  return segments.join(' > ');
}

function labelFor($: CheerioAPI, container: HtmlNode, fallback: string): string {
  const hint = (element: ReturnType<CheerioAPI>): string | null => {
    if (
      !element.length ||
      element.is('ul,ol,table,button,input,select,[role="button"],[role="tablist"]') ||
      element.find('button,input,select,[role="button"],[role="tablist"]').length > 0 ||
      element.find('a[href]').length > 1 ||
      element.find('ul,ol,table').length > 0
    )
      return null;
    const selector = 'h1,h2,h3,h4,[role="heading"],[class*="title"]';
    const heading = element.is(selector) ? element : element.find(selector).first();
    const label = normalizeText(
      element.attr('aria-label') ||
        heading.find('p').first().text() ||
        heading.text() ||
        element.text(),
    );
    if (label && label.length <= 80 && !noiseTitle.test(label)) return label;
    const image = element.find('img').first();
    const accessible = normalizeText(image.attr('alt') ?? image.attr('title') ?? '');
    if (accessible && accessible.length <= 80) return accessible;
    const imageHint = /(?:^|[/_.-])(notice|announcement|news|event)(?=[_.?/-]|$)/i.exec(
      image.attr('src') ?? '',
    );
    return imageHint?.[1] ?? null;
  };
  let current: HtmlNode | undefined = container;
  for (let depth = 0; current && depth < 4; depth++) {
    const element: ReturnType<CheerioAPI> = $(current);
    const direct = hint(element.children('h1,h2,h3,h4,[role="heading"],[class*="title"]').first());
    if (direct) return direct;
    for (const sibling of element.prevAll().slice(0, 2).toArray()) {
      const label = hint($(sibling));
      if (label) return label;
    }
    const navigation = 'nav,[role="navigation"],[role="menu"],[role="menubar"]';
    if (element.siblings(navigation).length || element.siblings().find(navigation).length) break;
    current = element.parent().get(0);
  }
  return fallback;
}

function feedDate(text: string): string | null {
  const value = normalizeText(text);
  if (z.iso.date().safeParse(value).success) return value;
  let timestamp = value;
  const iso = value.match(
    /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i,
  );
  if (iso) {
    const zone = iso[4]!.toUpperCase().replace(/^([+-]\d{2})(\d{2})$/, '$1:$2');
    timestamp = `${iso[1]}T${iso[2]}${iso[3] ?? ':00'}${zone}`;
    if (!z.iso.datetime({ offset: true }).safeParse(timestamp).success) return null;
  } else {
    const rfc = value.match(
      /^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),? )?(\d{1,2}) ([A-Za-z]{3}) (\d{4}|\d{2}) (\d{2}:\d{2}(?::\d{2})?) (?:UT|GMT|Z|[ECMP][DS]T|[+-](?:[01]\d|2[0-3])[0-5]\d)$/i,
    );
    if (!rfc || !z.iso.time().safeParse(rfc[4]).success) return null;
    const year =
      rfc[3]!.length === 2 ? Number(rfc[3]) + (Number(rfc[3]) < 50 ? 2000 : 1900) : Number(rfc[3]);
    if (!dateIn(`${rfc[2]} ${rfc[1]}, ${year}`)) return null;
  }
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

function feedEntries($: CheerioAPI, pageUrl: string): NoticeEntry[] {
  const entries = new Map<string, NoticeEntry>();
  $('item,entry').each((_, node) => {
    const item = $(node);
    const link = item.children('link[rel="alternate"],link:not([rel])').first();
    let baseUrl = pageUrl;
    for (const ancestor of [...link.parents().toArray().reverse(), ...link.toArray()]) {
      const base = $(ancestor).attr('xml:base');
      if (base) baseUrl = new URL(base, baseUrl).href;
    }
    const url = articleUrl(link.attr('href') ?? link.text(), baseUrl);
    const title = normalizeText(item.children('title').first().text());
    const rawDate = item.children('pubDate,published').first().text();
    if (url && title)
      entries.set(url, {
        id: url,
        title,
        url,
        publishedAt: feedDate(rawDate),
      });
  });
  return [...entries.values()];
}

function retainEntry(entries: Map<string, NoticeEntry>, entry: NoticeEntry): void {
  const previous = entries.get(entry.id);
  if (
    !previous ||
    Number(Boolean(entry.publishedAt)) > Number(Boolean(previous.publishedAt)) ||
    (Boolean(entry.publishedAt) === Boolean(previous.publishedAt) &&
      entry.title.length > previous.title.length)
  ) {
    entries.set(entry.id, entry);
  }
}

export function analyzeNoticePage(
  input: string | Buffer,
  rawUrl: string,
  options: AnalyzeOptions = {},
): NoticeAnalysis {
  const pageUrl = validateNoticeUrl(rawUrl);
  const { $, isFeed } = documentFor(input, options.charset);
  const baseHref = $('base[href]').first().attr('href');
  const linkBase = baseHref ? new URL(baseHref, pageUrl).href : pageUrl;
  const title = normalizeText(
    isFeed ? $('channel > title,feed > title').first().text() : $('title').first().text(),
  );
  const result: NoticeAnalysis = {
    pageUrl,
    title,
    status: 'unsupported',
    candidates: [],
    feeds: [],
    sectionLinks: [],
    diagnostics: [],
  };
  if (isFeed) {
    const entries = feedEntries($, pageUrl);
    if (entries.length)
      result.candidates.push({
        label: title || 'Feed',
        score: 100,
        reasons: ['原生 RSS/Atom'],
        entries,
        rule: { version: 1, kind: 'feed', pageUrl, label: title || 'Feed' },
      });
  } else {
    const sectionLinks = new Map<string, { title: string; url: string }>();
    $('a[href]').each((_, node) => {
      const sectionTitle = normalizeText($(node).attr('title') || $(node).text());
      if (
        sectionTitle.length > 30 ||
        !/通知|公告|公示|信息发布|新闻|资讯|要闻|动态|\b(?:news|notices?|announcements?)\b/i.test(
          sectionTitle,
        )
      )
        return;
      const url = articleUrl($(node).attr('href') ?? '', linkBase);
      if (url && new URL(url).origin === new URL(pageUrl).origin)
        sectionLinks.set(url, { title: sectionTitle, url });
    });
    result.sectionLinks = [...sectionLinks.values()];
    $('link[rel~="alternate"]').each((_, node) => {
      if (!/application\/(?:rss|atom)\+xml/i.test($(node).attr('type') ?? '')) return;
      const url = articleUrl($(node).attr('href') ?? '', linkBase);
      if (url) result.feeds.push({ title: $(node).attr('title') ?? 'Feed', url });
    });
    const hasScripts = $('script[src]').length > 0;
    stripChrome($);
    if ($('*').length > 20_000) {
      result.diagnostics.push('页面超过 20000 个 DOM 元素，原型停止结构分析');
      return result;
    }
    const sample = options.sampleTitle ? normalizeText(options.sampleTitle) : null;
    const unique = new Map<string, NoticeCandidate>();
    $('ul,ol,tbody,table,section,div,main,article,dl').each((_, container) => {
      const groups = new Map<
        string,
        { row: HtmlNode; linkSelector: string | null; entry: NoticeEntry }[]
      >();
      $(container)
        .children('li,tr,div,article,section,a,dd')
        .each((_, row) => {
          const link = primaryLink($, row, linkBase);
          if (!link) return;
          const linkSelector =
            pathTo($, link.node, row)?.replace(/:nth-of-type\(\d+\)/g, '') ?? null;
          const tag = String($(row).prop('tagName')).toLowerCase();
          const key = `${tag}|${linkSelector}`;
          const group = groups.get(key) ?? [];
          group.push({
            row,
            linkSelector,
            entry: { id: link.url, title: link.title, url: link.url, publishedAt: rowDate($, row) },
          });
          groups.set(key, group);
        });
      for (const group of groups.values()) {
        const records = new Map<string, NoticeEntry>();
        for (const { entry } of group) retainEntry(records, entry);
        const entries = [...records.values()];
        if (entries.length < (sample ? 1 : 2)) continue;
        const identity = entries
          .map((entry) => entry.id)
          .sort()
          .join('\n');
        const first = group[0]!;
        const previous = unique.get(identity);
        if (
          previous?.rule.kind === 'html' &&
          previous.entries.filter((entry) => entry.publishedAt).length >=
            entries.filter((entry) => entry.publishedAt).length &&
          (previous.rule.linkSelector?.split(' > ').length ?? 0) <=
            (first.linkSelector?.split(' > ').length ?? 0)
        )
          continue;
        const commonClasses = ($(first.row).attr('class') ?? '')
          .split(/\s+/)
          .filter(
            (value) =>
              value &&
              group.every(({ row }) => ($(row).attr('class') ?? '').split(/\s+/).includes(value)),
          )
          .slice(0, 2);
        const itemSelector =
          String($(first.row).prop('tagName')).toLowerCase() +
          commonClasses.map((value) => `[class~=${JSON.stringify(value)}]`).join('');
        const label = labelFor($, container, title || '候选栏目');
        const dateRatio = entries.filter((entry) => entry.publishedAt).length / entries.length;
        const score = Math.round(
          Math.min(
            100,
            20 +
              Math.min(entries.length, 5) * 2 +
              dateRatio * 25 +
              (/通知|公告|notice|announcement/i.test(label) ? 15 : 0) +
              ($(container).closest('main,[role="main"]').length ? 10 : 0),
          ),
        );
        unique.set(identity, {
          label,
          score,
          reasons: [
            `${entries.length} 条重复结构`,
            `日期覆盖 ${Math.round(dateRatio * 100)}%`,
            ...(sample ? ['匹配用户标题样例'] : []),
          ],
          entries,
          rule: {
            version: 1,
            kind: 'html',
            pageUrl,
            label,
            containerSelector: pathTo($, container)!,
            itemSelector,
            linkSelector: first.linkSelector,
            expectsDates: dateRatio >= 0.5,
          },
        });
      }
    });
    const candidates = [...unique.values()];
    const scopes = new Map<HtmlNode, NoticeCandidate[]>();
    for (const candidate of candidates) {
      if (candidate.rule.kind !== 'html' || candidate.entries.length < 2) continue;
      let scope = $(candidate.rule.containerSelector).parent().get(0);
      for (let depth = 0; scope && depth < 2; depth++, scope = $(scope).parent().get(0)) {
        if ($(scope).is('html,body,main')) break;
        const group = scopes.get(scope) ?? [];
        group.push(candidate);
        scopes.set(scope, group);
      }
    }
    for (const [scope, group] of scopes) {
      if (group.length < 2 || new Set(group.map((candidate) => candidate.label)).size !== 1)
        continue;
      if (
        group.some(
          (candidate) =>
            candidate.entries.filter((entry) => entry.publishedAt).length /
              candidate.entries.length <
            0.5,
        )
      )
        continue;
      const parts = group.map((candidate) => candidate.rule).filter((rule) => rule.kind === 'html');
      const nested = parts.some((part) =>
        parts.some(
          (other) =>
            part !== other && $(part.containerSelector).parents(other.containerSelector).length > 0,
        ),
      );
      if (nested) continue;
      const branches = $(scope).children().toArray();
      if (
        parts.some((part) => {
          let current = $(part.containerSelector).get(0);
          while (current && current !== scope) {
            const element: ReturnType<CheerioAPI> = $(current);
            if (
              element.is('[role="tabpanel"]') ||
              semanticWords(`${element.attr('id') ?? ''} ${element.attr('class') ?? ''}`).some(
                (word) => /^tabs?\d*$/.test(word),
              )
            )
              return true;
            current = element.parent().get(0);
          }
          return false;
        })
      )
        continue;
      if (
        branches.some(
          (branch) =>
            parts.filter((part) => {
              const container = $(part.containerSelector).get(0);
              return container === branch || $(container).parents().toArray().includes(branch);
            }).length > 1,
        ) &&
        parts.some((part) => $(part.containerSelector).parent().get(0) !== scope)
      )
        continue;
      const merged = new Map<string, NoticeEntry>();
      for (const candidate of group) {
        for (const entry of candidate.entries) {
          retainEntry(merged, entry);
        }
      }
      if (merged.size <= Math.max(...group.map((candidate) => candidate.entries.length))) continue;
      const label = labelFor($, scope, title || '候选栏目');
      const entries = [...merged.values()];
      candidates.push({
        label,
        score: Math.min(100, Math.max(...group.map((candidate) => candidate.score)) + 5),
        reasons: [`${entries.length} 条同栏目多布局记录`, `${parts.length} 个独立容器`],
        entries,
        rule: {
          version: 1,
          kind: 'html',
          pageUrl,
          label,
          containerSelector: pathTo($, scope)!,
          itemSelector: parts[0]!.itemSelector,
          linkSelector: parts[0]!.linkSelector,
          expectsDates: entries.filter((entry) => entry.publishedAt).length / entries.length >= 0.5,
          parts: parts.map(({ containerSelector, itemSelector, linkSelector, label }) => ({
            containerSelector,
            itemSelector,
            linkSelector,
            label,
          })),
        },
      });
    }
    result.candidates = candidates.filter((candidate) => {
      if (sample && !candidate.entries.some((entry) => normalizeText(entry.title) === sample))
        return false;
      if (candidate.entries.length !== 1 || candidate.rule.kind !== 'html') return true;
      const container = $(candidate.rule.containerSelector);
      return !candidates.some(
        (other) =>
          other.entries.length > 1 &&
          (!sample || other.entries.some((entry) => normalizeText(entry.title) === sample)) &&
          other.rule.kind === 'html' &&
          other.entries.some((entry) => entry.id === candidate.entries[0]!.id) &&
          container.parents(other.rule.containerSelector).length > 0,
      );
    });
    result.candidates.sort((a, b) => b.score - a.score);
    if (!result.candidates.length)
      result.diagnostics.push(
        sample
          ? '没有找到匹配标题样例的栏目'
          : '未识别到至少两条有效公告；可能是单篇页面、登录页或需要 JavaScript 渲染',
      );
    if (hasScripts) result.diagnostics.push('本次仅分析服务器 HTML，未执行页面 JavaScript');
  }
  result.status =
    result.candidates.length > 1
      ? 'needs-selection'
      : result.candidates.length
        ? 'ok'
        : 'unsupported';
  return result;
}

export function extractNoticeEntries(
  input: string | Buffer,
  rule: NoticeRule,
  charset?: string,
): NoticeEntry[] {
  validateNoticeUrl(rule.pageUrl);
  const { $, isFeed } = documentFor(input, charset);
  const baseHref = $('base[href]').first().attr('href');
  const linkBase = baseHref ? new URL(baseHref, rule.pageUrl).href : rule.pageUrl;
  if (rule.kind === 'feed') {
    const entries = isFeed ? feedEntries($, rule.pageUrl) : [];
    if (!entries.length) throw new Error('订阅 Feed 失配或为空，请重新确认');
    return entries;
  }
  stripChrome($);
  const containers = $(rule.containerSelector);
  if (containers.length !== 1) throw new Error('订阅栏目定位失配，请重新确认');
  const currentLabel = labelFor(
    $,
    containers.get(0)!,
    normalizeText($('title').first().text()) || '候选栏目',
  );
  if (currentLabel !== rule.label) throw new Error('订阅栏目名称变化，请重新确认');
  const entries = new Map<string, NoticeEntry>();
  for (const part of rule.parts ?? [rule]) {
    const source = $(part.containerSelector);
    if (source.length !== 1) throw new Error('订阅栏目分组失配，请重新确认');
    if (
      part.label !== undefined &&
      labelFor($, source.get(0)!, normalizeText($('title').first().text()) || '候选栏目') !==
        part.label
    )
      throw new Error('订阅栏目分组名称变化，请重新确认');
    const rows = source.children(part.itemSelector);
    rows.each((_, row) => {
      const targets = part.linkSelector === null ? $(row) : $(row).find(part.linkSelector);
      const primary = primaryLink($, row, linkBase);
      if (!primary || !targets.toArray().some((node) => node === primary.node)) return;
      retainEntry(entries, {
        id: primary.url,
        title: primary.title,
        url: primary.url,
        publishedAt: rowDate($, row),
      });
    });
  }
  const items = [...entries.values()];
  if (!items.length || (rule.expectsDates && !items.some((entry) => entry.publishedAt)))
    throw new Error('订阅栏目结构失配或为空，请重新确认');
  return items;
}
