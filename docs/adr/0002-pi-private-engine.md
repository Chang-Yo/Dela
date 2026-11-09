# 0002. Pi 是 Core 的私有引擎，移除 Pi Packages

- 状态：已接受
- 日期：2026-11-09

## 背景

Dela 对 Pi 的定制已经很深。大部分 Pi 扩展依赖终端界面，在 Dela 的 GUI 中无法完整支持。统计显示几乎没有用户使用 Pi Packages。Pi 的类型还渗透到了界面（`entryId`、`customType`、按 Pi 工具名分支），Pi 一升级，界面就要跟着改。

## 决定

Pi 只在 `core` 内部使用，Pi 的类型不得出现在 `core/protocol` 中。

| Pi 包             | 策略                                        |
| ----------------- | ------------------------------------------- |
| `pi-ai`           | 跟随上游                                    |
| `pi-agent-core`   | 跟随上游，按需升级                          |
| `pi-coding-agent` | 锁定版本，Dela 可以覆盖或接管其中的部分实现 |
| `pi-mcp`          | 使用它的传输层和 OAuth                      |

移除 Pi Packages：扩展、主题、包安装、npm 运行时、扩展 UI 桥，以及 onboarding 中的相关卡片。会话的资源加载器关闭 `.pi/extensions` 和主题的隐式加载。

老用户的残留由 `v9tov10` 迁移清理：删除 `pi-packages*` 等设置键，删除 `userData/components/node`、`userData/pi/npm`、`userData/pi/git`。用户项目中的 `.pi/` 和 `~/.pi/agent` 属于用户和 Pi CLI，不做改动。

## 后果

- Pi 升级只影响 `core`；客户端只看到 Dela 自己的视图模型。
- 第三方无法再往 Agent 循环中挂代码钩子，只能通过 0003 中的方式扩展能力。
- 主进程约 1.4k 行代码，以及对应的界面、测试和文档章节可以删除。
