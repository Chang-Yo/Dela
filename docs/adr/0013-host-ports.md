# 0013. 宿主能力经端口注入，业务模块不直接引用 Electron

- 状态：已接受
- 日期：2026-11-11

## 背景

v2 的主进程模块直接 import Electron：路径取自 `app.getPath`，凭据经 `safeStorage`，通知用 `Notification`，窗口广播用 `BrowserWindow`，对话框、回收站、系统打开与网络请求各自调用 Electron API。core 因此无法脱离 Electron 做类型检查与测试，每个用例都要 mock electron。

## 决定

`src/main/host.ts` 定义 `HostPorts` 接口，按能力分组：`Paths`、`SecretStore`、`Notifier`、`ClientBroadcaster`、`ImageCodec`、`Desktop`、`Network`。Electron 实现在 `src/app/host-electron.ts`，启动时由 `provideHostPorts` 注入；测试由 vitest setupFile 提供默认端口，用例用 `provideTestHostPorts` 覆盖。

- 凭据按命名空间读写；加密、原子替换与解密失败备份都留在 Electron 实现里，`CredentialDecryptionError` 归入端口契约。
- 业务模块只在边界处取一次端口，向内传已类型化的值，不重复检查。

## 后果

- core 与 main 的业务代码不再依赖 Electron，测试不再 mock electron。
- 新增能力必须先进入 `HostPorts`，不能在业务模块里直接 import electron。
- 直接加载 main 模块的脚本（冒烟）必须显式注入端口，否则拿到“宿主端口尚未注入”的报错。
- 终端、remotes 与交大模块暂未迁移，仍直接引用 Electron，随各自模块迁移收口。
