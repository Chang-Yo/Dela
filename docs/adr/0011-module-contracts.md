# 0011. 模块的内部契约与三个出口

- 状态：已接受
- 日期：2026-11-10

## 背景

v2 的一个 IPC 调用要在四处手写同一个通道名：主进程注册、preload 转发、`shared` 里的接口类型、renderer 调用。名字写错不会编译失败，只会在运行时被拒绝。0001 要求模块“只通过 `index.ts` 引用”，但主进程代码和界面代码分属不同的构建，一个出口无法同时服务两端。

## 决定

- 每个模块在 `contract.ts` 中用 `defineContract` 声明通道和入参的 zod schema。主进程用 `implement` 实现，入参先经 schema 校验；renderer 用 `createClient` 调用。返回值由主进程生成，只承载类型。
- 模块有三个出口：`index.ts` 是主进程侧（模块定义、注册口、服务），`contract.ts` 是两端共享的类型和契约，`view/index.ts` 是界面侧。
- preload 只暴露一个 `bridge.invoke`，只放行 `app/contracts.ts` 中登记的契约。主进程按 `app/modules.ts` 注册，两份清单由测试保证一致。
- 一个使用方、多个提供方时，由使用方在 `index.ts` 中开注册口（例如 `registerSearchProvider`），提供方在启动时注册。注册表是主进程中唯一允许的模块级可变状态，只在启动时写入。

## 后果

- 通道名只写一次，改名或改参数由编译器找出所有调用方。
- preload 打包了契约中的 zod，体积从约 14 KB 增至约 76 KB。
- 新增模块要在两份清单中各加一行；漏登时测试失败。
- 全局搜索（`modules/search`）是第一个按此结构迁移的模块，后续模块以它为范例。
