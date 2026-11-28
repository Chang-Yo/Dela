import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeNoticePage, extractNoticeEntries } from '../parser';

const homepageUrl = 'https://www.si.sjtu.edu.cn/';
const listUrl = 'https://www.si.sjtu.edu.cn/content/news-list?menuIds=2,8,18&params=5&singlePage=1';
const homepage = readFileSync(new URL('./fixtures/innovation-home.html', import.meta.url), 'utf8');
const list = readFileSync(new URL('./fixtures/innovation-notices.html', import.meta.url), 'utf8');

describe('notice section links', () => {
  it('offers real section links when homepage notices have no replayable links', () => {
    const result = analyzeNoticePage(homepage, homepageUrl);

    expect(result.status).toBe('unsupported');
    expect(result.candidates).toEqual([]);
    expect(result.sectionLinks).toContainEqual({ title: '通知公告', url: listUrl });
    expect(result.sectionLinks).toHaveLength(2);
  });

  it('keeps section links separate from article candidates and excludes unsafe or external URLs', () => {
    const result = analyzeNoticePage(
      `<nav>
        <a href="/notices">通知公告</a><a href="/notices">通知公告</a>
        <a href="https://other.example/news">学院新闻</a>
        <a href="javascript:alert(1)">新闻动态</a>
        <a href="#news">新闻动态</a>
        <a href="http://127.0.0.1/notices">新闻动态</a>
        <a href="/about">学院介绍</a>
        <a href="/information">信息发布</a><a href="/public">通知・公示</a>
        <a href="/news">News</a>
      </nav>`,
      'https://school.example/',
    );

    expect(result.sectionLinks).toEqual([
      { title: '通知公告', url: 'https://school.example/notices' },
      { title: '信息发布', url: 'https://school.example/information' },
      { title: '通知・公示', url: 'https://school.example/public' },
      { title: 'News', url: 'https://school.example/news' },
    ]);
    expect(result.candidates).toEqual([]);
  });

  it('parses and replays the real linked list without using a display control as its label', () => {
    const result = analyzeNoticePage(list, listUrl);
    const candidate = result.candidates[0]!;

    expect(result.status).toBe('ok');
    expect(candidate.label).toBe('上海交通大学学生创新中心-通知公告');
    expect(candidate.entries).toHaveLength(12);
    expect(candidate.entries[0]).toMatchObject({
      title: '第四届上海交通大学“联想”创新创业奖开放申请啦',
      url: 'https://www.si.sjtu.edu.cn/content/news-detail?params=9e17de7ccfe346c39ffa7d420b75ab8f&menuIds=2,8,18',
      publishedAt: '2026-11-12',
    });
    expect(candidate.entries.every((entry) => entry.publishedAt !== null)).toBe(true);
    expect(extractNoticeEntries(list, candidate.rule)).toEqual(candidate.entries);
  });
});
