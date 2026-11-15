# 0020. 模块经工作台端口打开标签

- 状态：已接受
- 日期：2026-11-15

## 背景

聊天、会话与审阅界面要迁进 `modules/chat`，但它们直接调用外壳：导航 store 的 `openChat`、`newChat`、`openGeneralChat`、`openSettings`，读外壳的 `view` 与 `lastHomeSessionId`，用 `openTarget(tabId, { aside })` 在旁边打开改动文件与审阅。view 不能引用外壳。已迁移的标签内容模块各自从外壳拿一份上下文（note 的 `NoteDraftSource`、preview 的 `ContentLoader`、chat 的 `ChatTabSource`），「打开文档」在三处写法不同。

## 决定

- **页面跳转仍只有 `navigate`（0019）。** 会话相关的动作都写成跳转目标：`chat: { projectId: string | null; sessionId?: string }`，省略 `sessionId` 表示新建。落点（首页、通用工作台、项目工作台）和新会话的用途由外壳按当前视图决定，与现在一致，模块不读外壳的 `view`。`chat`、`settings` 的登记从 `shared/nav-targets.ts` 搬进 chat 与 settings 的契约。
- **工作台端口**：`app/module.ts` 新增接口，外壳实现一份：

  ```ts
  export interface Workbench {
    /** 按 open-target 的规则打开标签；aside 放到焦点组右侧。 */
    open(tab: TabId, options?: { aside?: boolean }): void;
    /** 文档 key（条目、来源、远端节点、绝对路径）由外壳换成笔记或预览标签。 */
    openDocument(key: string, options?: { aside?: boolean }): void;
  }
  ```

  端口和 `navigate` 一起经模块自己的上下文传入：`ChatTabSource` 增加 `navigate`、`workbench`，取代 `onOpenSource`。打开标签的规则仍只写在 open-target 一处。note、preview 的上下文以后改到时换用同一接口，本次不动。

- **首页会话归 chat 模块**：「上次停留的会话」移进 chat 的 store。首页「打开哪个会话」的请求仍随导航历史由外壳持有（后退、换项目时清掉），外壳处理落在首页的 `chat` 目标时以 prop 交给 `ChatHome` 一个新的请求对象，类型由 chat 定义，`ChatHome` 按 0019 在渲染期比较。

## 后果

- 迁移后 chat、review、sessions 只剩一处引用外壳（见下）。外壳经 chat 视图出口取 `ChatHome`、`ChatTab`、`ReviewTab`、`useSessions`、`useRuns`、`ArchivedSection` 等；标签组件在出口用 `lazy` 导出，保留分包。
- chat 视图用到的 `shared/api`（会话指令等）随迁移收进 chat 契约；`opensInApp` 经 `ChatTabSource` 传入。
- 暂不决定：
  - 归档会话时关闭它的标签：`updateSession` 仍直接操作布局，记为 lint 过渡例外。
  - 离开页面前的守卫（0019 预告）：外壳仍直接调用邮件的 `leaveComposer`。
