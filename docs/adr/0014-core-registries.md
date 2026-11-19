# 0014. Core 通过注册表接入业务能力

- 状态：已接受
- 日期：2026-11-12

## 背景

v2 的 Agent 内核直接认识校园业务：`commands.ts` 用常量数组列出各命令域，`skills.ts` 写死内置 Skill，系统提示写死“课程、邮件、水源、课表”，`resources.ts` 按引用类型 switch，会话层写死课件目录作为“资料库”的工作目录。新增一个领域就要改内核，Core 也无法脱离校园代码单独存在。

## 决定

Core 不认识具体业务，只提供注册表，由模块在启动时显式注册：

- `core/capabilities/commands.ts`：命令域连同教 Agent 使用它的内置 Skill 一起注册。命令桥、`dela help`、Skill 写盘与系统提示都从注册表读取；停用 Skill 时，对应命令域从帮助、执行与系统提示中一并消失；没有可用命令域时，系统提示不提 `dela`。
- `core/capabilities/resources.ts`：`ResourceResolver` 按引用类型注册，负责 Agent 读取、持久文件路径与临时落盘。
- `core/agent/scopes.ts`：`SessionScope` 登记共用同一工作目录的会话作用域。

注册不做自动扫描，所有注册都写在一个显式清单里。过渡期这个清单是 `main/agent/domain/index.ts`（文档读取组件同样在这里注册），各模块迁入新目录后改由模块定义声明，并在 `app/modules.ts` 中列出。

`src/core` 由 oxlint 守住边界：不能引用 Electron、React、旧主进程、renderer、shared、app、ui 与任何模块；`core/protocol` 只能引用 zod。

## 后果

- 新增一个领域不改 Core：在模块里定义命令域、Skill 与解析器，再注册一次。
- 不装任何模块时，Core 仍是一个没有 `dela` 命令的通用 Agent。
- 想知道“某个命令是在哪里注册的”时，要去看注册清单，而不是看 Core。
- 引用的 zod schema 仍是封闭联合，随 Agent 协议 v1 一起开放。
