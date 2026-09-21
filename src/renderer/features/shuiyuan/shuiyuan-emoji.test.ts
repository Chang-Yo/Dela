import { describe, expect, it } from 'vitest';
import { decodeShuiyuanTitle } from './shuiyuan-emoji';

describe('decodeShuiyuanTitle', () => {
  it('替换标题中的标准 emoji 短代码', () => {
    expect(decodeShuiyuanTitle(':ocean:饮水思源随意灌水楼')).toEqual(['🌊', '饮水思源随意灌水楼']);
    expect(decodeShuiyuanTitle('轻松一刻 :tada: 来分享')).toEqual(['轻松一刻 ', '🎉', ' 来分享']);
    expect(decodeShuiyuanTitle(':+1:')).toEqual(['👍']);
  });

  it('连续短代码逐个替换', () => {
    expect(decodeShuiyuanTitle(':ocean::tada:')).toEqual(['🌊', '🎉']);
  });

  it('未注册短代码按 Discourse 行为保留原文', () => {
    expect(decodeShuiyuanTitle(':unknown-thing: 标题')).toEqual([':unknown-thing: 标题']);
  });

  it('自定义 emoji 映射为站点图片段', () => {
    expect(
      decodeShuiyuanTitle('看看 :trollface:', [
        { name: 'trollface', url: '/images/emoji/trollface.png' },
      ]),
    ).toEqual([
      '看看 ',
      { name: 'trollface', url: 'https://shuiyuan.sjtu.edu.cn/images/emoji/trollface.png' },
    ]);
  });

  it('时间与比分不被当作短代码', () => {
    expect(decodeShuiyuanTitle('会议记录 14:30:00')).toEqual(['会议记录 14:30:00']);
    expect(decodeShuiyuanTitle('比分 3:2:1')).toEqual(['比分 3:2:1']);
  });

  it('无短代码时原样返回', () => {
    expect(decodeShuiyuanTitle('普通标题')).toEqual(['普通标题']);
    expect(decodeShuiyuanTitle('')).toEqual([]);
  });
});
