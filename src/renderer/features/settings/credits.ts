import alipayQr from '../../../../assets/credits/changyo/alipay.png';
import authorAvatar from '../../../../assets/credits/changyo/avatar.jpg';
import wechatQr from '../../../../assets/credits/changyo/wechat.png';

export type SocialLinkKind = 'github' | 'blog' | 'zhihu';

export interface SocialLink {
  kind: SocialLinkKind;
  url: string;
  label?: string;
}

export type SponsorChannelKind = 'wechat' | 'alipay';

export interface SponsorChannel {
  kind: SponsorChannelKind;
  qr: string;
  label?: string;
}

export interface CreditPerson {
  name: string;
  avatar: string;
  links?: SocialLink[];
  sponsor?: {
    channels: SponsorChannel[];
    note?: string;
  };
}

export interface CreditSection {
  /** 栏目标题，全表唯一，兼作列表 key */
  title: string;
  people: CreditPerson[];
}

// 数据随源码打包进渲染产物，更新名单走 PR + 发版，用户端不可改。
export const creditSections: CreditSection[] = [
  {
    title: 'Author',
    people: [
      {
        name: 'ChangYo',
        avatar: authorAvatar,
        links: [
          { kind: 'github', url: 'https://github.com/Chang-Yo' },
          { kind: 'blog', url: 'https://changyo.pages.dev' },
        ],
        sponsor: {
          channels: [
            { kind: 'wechat', qr: wechatQr },
            { kind: 'alipay', qr: alipayQr },
          ],
          note: '请作者喝一杯',
        },
      },
    ],
  },
];
