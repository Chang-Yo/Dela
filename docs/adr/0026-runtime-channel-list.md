# 0026. preload 的通道名单由主进程在启动时下发

- 状态：已接受
- 日期：2026-11-23
- 取代：[0011](0011-module-contracts.md) 中「preload 只放行 `app/contracts.ts` 中登记的契约」一条及相关后果

## 背景

界面不能直接调用主进程，只能经过 preload 暴露的 `bridge`。preload 按一份通道名单放行：名单外的调用直接拒绝，提示「该功能在当前版本中未启用」；订阅名单外的事件直接报错。这道关卡让被注入脚本的页面也只能碰到登记过的契约通道。窗口按钮等少数非契约通道（`window:*`）由 preload 单独暴露，不在本文范围内。

0011 让这份名单来自手写的 `app/contracts.ts`。主进程则按 `app/modules.ts` 注册，两份清单靠测试保持一致。这样做有几个问题：

- 加或删一个模块要改三份清单（`modules.ts`、`views.ts`、`contracts.ts`）。fork 的人去掉 `sjtu/` 要改三处，CI 的 `scripts/strip-sjtu.ts` 也一样。
- preload 只用到通道名，入参校验在主进程（`implement` 中的 schema 校验）。但 `contracts.ts` 引入的是完整契约，所以 preload 把所有模块的 zod schema 都打进了包里，现在约 115 KB。
- 界面的 `main.tsx` 也读这份清单，用来订阅与过程同名的事件（0017：带内容的推送写入查询缓存，空推送让读取过期）。

在 Electron 44.10.1 下实测（sandbox 与 contextIsolation 都开启）：preload 在页面脚本运行前，可以用 `ipcRenderer.sendSync` 同步拿到主进程的回复，单次约 1 ms。preload 也能读到 `additionalArguments` 传入的启动参数，但 Windows 的整条命令行上限约 3.2 万字符，由所有参数共享，超出时渲染进程无法启动，窗口白屏。现有名单约 4–6 KB。

## 决定

- **名单只有一个来源：主进程实际注册的契约。** 主进程注册 agent、llm、capabilities 三个核心契约和 `modules` 中各模块的契约时，顺带算出两组名字：可以调用的过程、可以订阅的事件。与过程同名的事件就是两组的交集，不单独下发。
- **preload 启动时用 `sendSync` 向 `contract:manifest` 取一次名单**，存在 preload 自己的闭包里，此后按它放行。页面脚本运行时名单已经固定，页面改不了。页面重载时 preload 重新运行，再取一次。
- **处理器用与其他契约通道相同的来源检查**（只认应用主框架）。无论放行还是拒绝，处理器都设置返回值，不让 preload 卡住。被拒绝时返回空名单，preload 照常启动，但所有契约调用都被拒绝。
- 不用启动参数传名单：它和其他参数共享长度上限，超出时直接白屏。
- **同名事件交给界面**。bridge 提供这组名字，`connectQueryEvents` 改为接收名字列表，不再接收契约对象。
- **删除 `app/contracts.ts`。** preload 只引用 `core/protocol/contract` 中的类型，不引用任何模块。
- 安全边界不变：名单仍由主进程决定，并在页面运行前固定；入参校验和来源检查仍在主进程。

## 后果

- 加模块只改 `modules.ts` 和 `views.ts` 两份清单，`strip-sjtu.ts` 也少处理一份。
- preload 包体预计降到几 KB。
- 每次加载或重载页面多一次同步往返。实测单次约 1 ms；主进程忙时首屏会相应等待。名单在注册 IPC 时算好，早于创建窗口。
- 构建 preload 时，类型检查不再覆盖通道名。界面订阅一个主进程没有注册的事件，会像现在一样直接报错；主进程某个模块漏注册时，它的调用会被拒绝，推送则静默收不到。由测试兜底：下发的名单与主进程注册的通道一致，名单外的调用被拒绝，被拒绝的来源拿到空名单。原来比对两份清单的测试删除。
- 需要同步修改：`.oxlintrc.json`、`tsconfig.preload.json`、`tsconfig.renderer.json` 中对 `contracts.ts` 的引用，`docs/DEVELOPMENT.md` 与 `CONTRIBUTING.md` 中的清单说明。AGENTS.md 中提到 `contracts.ts` 的两处由维护者修改。
