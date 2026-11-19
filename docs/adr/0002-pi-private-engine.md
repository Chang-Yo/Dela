# 0002. Pi 是 Core 的私有引擎，移除 Pi Packages

- 状态：已接受
- 日期：2026-11-09

## 背景

Dela 对 Pi 的定制已经很深。大部分 Pi 扩展依赖终端界面，在 Dela 的 GUI 中无法完整支持。统计显示几乎没有用户使用 Pi Packages。Pi 的类型还渗透到了界面（`entryId`、`customType`、按 Pi 工具名分支），Pi 一升级，界面就要跟着改。

## 决定

Pi 只在 `core` 内部使用，Pi 的类型不得出现在 `core/protocol` 中。

| Pi 包             | 策略                                        |
| ----------------- | ------------------------------------------- |
| `pi-ai`           | 跟随上游，由它的厂商目录补齐各家模型差异    |
| `pi-agent-core`   | 跟随上游，按需升级                          |
| `pi-coding-agent` | 锁定版本，Dela 可以覆盖或接管其中的部分实现 |
| `pi-mcp`          | 使用它的传输层和 OAuth                      |

移除 Pi Packages：扩展、prompt 模板、主题、包安装、npm 运行时、扩展 UI 桥，以及 onboarding 中的相关卡片。会话的资源加载器关闭 `.pi/extensions`、`.pi/prompts` 和主题的隐式加载。可复用的提示词改用 Dela 自己的斜杠指令。

老用户的残留由 `v9tov10` 迁移清理：删除 `pi-packages*` 等设置键，删除 `userData/components/node`、`userData/pi/npm`、`userData/pi/git`。用户项目中的 `.pi/` 和 `~/.pi/agent` 属于用户和 Pi CLI，不做改动。

模型厂商同样交给 Pi：Dela 不再维护自己的厂商预设。Pi 目录中只凭 API Key 就能接入的厂商作为内置厂商提供，协议、地址、兼容参数与思考档位随目录；其余服务一律作为自定义 OpenAI 兼容服务接入。目录在后台从 pi.dev 刷新。

## 后果

- Pi 升级只影响 `core`；客户端只看到 Dela 自己的视图模型。
- 第三方无法再往 Agent 循环中挂代码钩子，只能通过 0003 中的方式扩展能力。
- 主进程约 1.4k 行代码，以及对应的界面、测试和文档章节可以删除。
- 已有厂商的新模型无需升级 Pi 即可使用；新增厂商或新的接口协议仍要升级 `pi-ai`。目录里没有的厂商（如致远一号）只能按自定义服务接入。
