# 架构决策记录

每条记录写明一个架构决定的背景、内容和后果。决定改变时不改旧记录，而是新增一条记录取代它，并把旧记录的状态改为“已取代”。

| 编号                                | 标题                                               | 状态     |
| ----------------------------------- | -------------------------------------------------- | -------- |
| [0001](0001-modular-monolith.md)    | 按功能组织的模块化单体，Core 是唯一的硬边界        | 已接受   |
| [0002](0002-pi-private-engine.md)   | Pi 是 Core 的私有引擎，移除 Pi Packages            | 已接受   |
| [0003](0003-skills-and-mcp.md)      | 外置能力只支持 Agent Skills 和 MCP                 | 部分取代 |
| [0004](0004-agent-protocol.md)      | Agent 协议是唯一对外发布的契约                     | 部分取代 |
| [0005](0005-sjtu-leaf-modules.md)   | 交大代码是叶子模块，暂不建校园兼容层               | 已接受   |
| [0006](0006-data-ownership.md)      | 数据所有权与移动端的边界                           | 已接受   |
| [0009](0009-renderer-state.md)      | renderer 状态按归属划分，Effect 只用于白名单场景   | 已接受   |
| [0011](0011-module-contracts.md)    | 模块的内部契约与三个出口                           | 已接受   |
| [0012](0012-nav-targets.md)         | 跳转目标由页面所属的模块登记                       | 已接受   |
| [0013](0013-host-ports.md)          | 宿主能力经端口注入，业务模块不直接引用 Electron    | 已接受   |
| [0014](0014-core-registries.md)     | Core 通过注册表接入业务能力                        | 已接受   |
| [0015](0015-agent-protocol-v1.md)   | Agent 协议 v1 以单用户为前提                       | 已接受   |
| [0016](0016-core-host-boundary.md)  | 数据库与项目由宿主持有，core 经端口使用            | 已接受   |
| [0017](0017-contract-events.md)     | 契约声明推送事件，状态快照进查询缓存               | 已接受   |
| [0018](0018-design-token-freeze.md) | Design token 的名字定稿并冻结                      | 部分取代 |
| [0019](0019-view-manifest.md)       | 渲染端按清单装配模块的页面                         | 已接受   |
| [0020](0020-workbench-port.md)      | 模块经工作台端口打开标签                           | 已接受   |
| [0021](0021-context-directories.md) | 通用会话经辅助目录看到资料                         | 已接受   |
| [0022](0022-json-config-files.md)   | 模型服务、MCP 与联网搜索存为 ~/.dela 下的明文 JSON | 已接受   |
| [0023](0023-design-token-naming.md) | Design token 按用途命名，改名走 ADR                | 已接受   |
| [0024](0024-todo-owns-schedule.md)  | 待办是用户安排的唯一入口，课表只显示学校课程       | 已接受   |

新记录沿用下面的格式，控制在一屏以内：

```md
# 编号. 标题

- 状态：提议 / 已接受 / 已取代（由 xxxx 取代）
- 日期：YYYY-MM-DD

## 背景

## 决定

## 后果
```
