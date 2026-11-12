# 0016. 数据库与项目由宿主持有，core 经端口使用

- 状态：已接受
- 日期：2026-11-12

## 背景

把 Agent 内核迁入 `src/core` 时，core 还依赖 main 的几样东西：SQLite 连接、项目查询（`workspace/api`）、凭据存取（`credentials`）和偏好（`settings/prefs`）。另一种方案是让 core 自己持有会话库，带上自己的表结构和迁移链。但现在所有表都在一个文件里（schema v12），迁移链也只有一条。拆成两套迁移，老用户升级时就要按顺序协调两条链，风险大，好处却很少。

## 决定

- **数据库**：宿主打开数据库并完成迁移，通过 `HostPorts.database()` 交给 core 一个连接。表结构与迁移仍在 `main/database.ts` 和 `main/migrations/`。core 只读写 `sessions` 表和自己的设置键（例如 `agent-instruction`）。
- **项目**：`HostPorts.projects` 只提供 core 需要的三种查询：按 id 查项目、列出本地项目、取远程项目的连接目标。项目怎么建、怎么删、怎么存仍归 workspace。
- **随包资源与路径**：helper、远端 rg、OpenSSH 的位置和 bash 的路径都由 `Paths` 端口提供，core 不判断自己是否已打包。
- **归 core 所有**：模型提供商与 MCP 配置由 core 读写，仍存在原来的凭据命名空间里，所以不需要迁移。文档读取组件由文档模块注册进来（见 [0014](0014-core-registries.md)）。

## 后果

- core 能单独做类型检查，测试用 `provideTestHostPorts` 注入真实的 SQLite 连接。
- 想给会话加字段，仍然要在宿主的迁移链里加一步。core 不能自己改表结构。
- 换一个宿主（例如无界面的服务端）就要提供同样的表结构。等真的出现第二个宿主时，再考虑把会话表交给 core。
- 端口里的 `SecretNamespace` 仍然列着 mail、canvas、shuiyuan 这些交大命名空间，所以 core 认得这几个名字。等 P5 迁出交大模块时，改成由模块注册命名空间。
