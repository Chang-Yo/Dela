# 0017. 契约声明推送事件，状态快照进查询缓存

- 状态：已接受
- 日期：2026-11-14

## 背景

0009 定下“后端推送的数据流每个领域一个 store，由 IPC bridge 统一订阅一次”，但 0011 的契约只有请求-响应，推送仍走 v2 的 `window.dela.<domain>.onUpdate`。同一个推送被多处各自订阅：`todo:state` 三处，`notifications:state`、`session:on-update` 等各两处。每处都手写“先订阅、再读取、用 alive 与 version ref 防止旧响应覆盖新推送”，同一份数据在不同页面各存一份副本。

## 决定

- `defineContract(namespace, procedures, events)`：事件与入参一样用 zod 声明，只承载类型，不做运行时校验。主进程用 `emit(contract, name, payload)` 经 `ClientBroadcaster` 发送 `${namespace}:${name}`。
- preload 的 bridge 增加 `subscribe(channel, listener)`，只放行已登记契约的事件；订阅时经 `contract:subscribe` 向主进程登记本窗口，此后主进程的事件才会送达。
- 推送分三类：
  - **状态快照**（推送的是完整状态，如待办、通知、更新状态）：查询缓存是唯一副本。契约里用同名的过程与事件配对（`state` 过程读取、`state` 事件推送），`connectQueryEvents` 在渲染端启动时为配对的事件订阅一次，收到后先取消同键的在途查询再写入缓存。组件只用 `useQuery`。
  - **失效通知**（过程带参数，快照推不出每个读取，如按时间段读取日程）：同名事件不带内容，`connectQueryEvents` 只让该过程带参数的读取过期重读。
  - **事件流**（推送的是增量，如会话运行事件、终端输出）：进入该领域的 store，同样只在 app 启动时订阅一次。
- 组件里不再出现 `onUpdate` 订阅、alive 守卫与 version ref。模块迁移时，旧的 `window.dela.<domain>` 接口与推送通道一并删除。
- 模块的后台同步（定时刷新等）写在 `ModuleDefinition.start()` 里，由 app 在就绪后启动、退出时停止（挂载点见 0005）。

## 后果

- 每个推送通道只订阅一次，同一份数据只有一份；“推送先到、初次读取后到”的竞态由缓存统一处理。
- 未迁移的模块继续用旧 API，两套推送可以并存。
- 第一个按此迁移的是待办：它有三个订阅方，契约小，主进程只有一个文件。
