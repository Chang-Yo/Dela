// 过渡期集中登记现有页面的跳转参数；页面迁入 modules/ 后，登记随页面搬进各自模块。
declare module '../app/module' {
  interface NavTargets {
    projects: { entryId: string };
    sources: { sourceId: string };
  }
}

export {};
