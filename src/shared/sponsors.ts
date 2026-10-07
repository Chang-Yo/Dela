// 在线赞助名单契约（docs/sponsorship-plan.md §6，接口草案 v1-draft-1）。
// renderer 只取得公开数据与本地加载状态，不接触支付、订单或网页身份。

export interface SponsorPersonView {
  /** 服务端分配的稳定公开 ID；客户端仅作列表 key，不解析内容。 */
  id: string;
  /** 纯文本昵称，按 React 文本渲染，不解释为 Markdown 或 HTML。 */
  name: string;
  /** 已验证为批准 origin 下 /media/avatars/ 前缀的绝对地址；null 显示默认头像。 */
  avatarUrl: string | null;
}

export interface SponsorsState {
  /** null 表示本地无可用名单（从未成功获取或超过最大保留期）；空数组是合法的最新名单。 */
  sponsors: readonly SponsorPersonView[] | null;
  /** 本地最近一次成功检查（200/304）的时间，与服务端名单发布时间 updatedAt 语义不同。 */
  checkedAt: string | null;
  /** 网络刷新进行中（自动或手动触发共用）。 */
  refreshing: boolean;
  /** 最近一次刷新失败的用户可见文案；null 表示最近一次成功或尚未尝试。 */
  error: string | null;
}

export interface SponsorsApi {
  /** 读取本地缓存状态，不联网。 */
  getState(): Promise<SponsorsState>;
  /** 自动刷新（进入关于页、关于页可见时窗口重新聚焦）：合并并发请求并受冷却退避约束。 */
  refresh(): Promise<SponsorsState>;
  /** 手动刷新（重试/刷新按钮）：绕过冷却立即联网，仍与进行中的请求合并。 */
  refreshNow(): Promise<SponsorsState>;
  /** 在系统浏览器打开固定 origin 的赞助网页入口（/support）。 */
  openSupportPage(): Promise<void>;
}
