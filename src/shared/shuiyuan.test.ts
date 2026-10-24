import { describe, expect, it } from 'vitest';
import { shuiyuanTopicFromUrl } from './shuiyuan';

describe('shuiyuanTopicFromUrl', () => {
  it('识别主题与楼层深链', () => {
    expect(shuiyuanTopicFromUrl('https://shuiyuan.sjtu.edu.cn/t/topic/254574')).toEqual({
      topicId: 254574,
    });
    expect(shuiyuanTopicFromUrl('https://shuiyuan.sjtu.edu.cn/t/254574/12?u=a')).toEqual({
      topicId: 254574,
      postNumber: 12,
    });
  });

  it('站外、非主题与携带凭据的地址不拦截，交给系统浏览器', () => {
    for (const url of [
      'https://evil.example/t/topic/1',
      'https://shuiyuan.sjtu.edu.cn.evil.example/t/topic/1',
      'https://shuiyuan.sjtu.edu.cn/u/someone',
      'https://shuiyuan.sjtu.edu.cn/t/topic/1/2/3',
      'https://u:p@shuiyuan.sjtu.edu.cn/t/topic/1',
      '/t/topic/1',
    ])
      expect(shuiyuanTopicFromUrl(url)).toBeNull();
  });
});
