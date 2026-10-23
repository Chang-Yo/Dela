import alipayQr from '../../../../assets/credits/changyo/alipay.png';
import authorAvatar from '../../../../assets/credits/changyo/avatar.jpg';
import wechatQr from '../../../../assets/credits/changyo/wechat.png';
import icebeerAvatar from '../../../../assets/credits/icebeer/avatar.jpg';
import aizyeeeAvatar from '../../../../assets/credits/aizyeee/avatar.png';
import aaalpsssAvatar from '../../../../assets/credits/aaalpsss/avatar.png';
import huangtongAvatar from '../../../../assets/credits/huangtong601-ops/avatar.jpg';
import jinjiAvatar from '../../../../assets/credits/jinji-2005/avatar.jpg';
import cophqAvatar from '../../../../assets/credits/cophq/avatar.jpg';
import frameneoLogoBlack from '../../../../assets/sponsors/FRAMENEO_logo_black.png';
import frameneoLogoWhite from '../../../../assets/sponsors/FRAMENEO_logo_white.png';

export type SocialLinkKind = 'github' | 'blog' | 'zhihu' | 'website' | 'bilibili';

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
  avatar?: string;
  /** 品牌赞助商没有头像，改用明暗两版 logo，与 README 赞助鸣谢同一份素材。 */
  logo?: { light: string; dark: string };
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

// 名单取自 GitHub API（/repos/Chang-Yo/Dela/contributors），头像随源码入库，
// 与 Author 用同一套展示结构；更新名单走 PR + 发版，用户端不可改。
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
  {
    title: 'Contributors',
    people: [
      {
        name: 'aizyeee',
        avatar: aizyeeeAvatar,
        links: [
          { kind: 'github', url: 'https://github.com/aizyeee' },
          { kind: 'website', url: 'https://aizyeee.com' },
        ],
      },
      {
        name: 'AAAlpsss',
        avatar: aaalpsssAvatar,
        links: [{ kind: 'github', url: 'https://github.com/AAAlpsss' }],
      },
      {
        name: 'huangtong601-ops',
        avatar: huangtongAvatar,
        links: [{ kind: 'bilibili', url: 'https://space.bilibili.com/355707853' }],
      },
      {
        name: 'jinji-2005',
        avatar: jinjiAvatar,
        links: [{ kind: 'github', url: 'https://github.com/jinji-2005' }],
      },
      {
        name: 'cophQ',
        avatar: cophqAvatar,
        links: [{ kind: 'github', url: 'https://github.com/cophQ' }],
      },
    ],
  },
  {
    title: 'Sponsors',
    people: [
      {
        name: 'FRAMENEO',
        logo: { light: frameneoLogoBlack, dark: frameneoLogoWhite },
        links: [{ kind: 'website', url: 'https://www.frameneo.com/' }],
      },
      {
        name: '冰啤史莱姆',
        avatar: icebeerAvatar,
        links: [{ kind: 'zhihu', url: 'https://www.zhihu.com/people/66-72-53-62-30' }],
      },
    ],
  },
];
