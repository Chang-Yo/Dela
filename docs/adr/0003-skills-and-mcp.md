# 0003. 外置能力只支持 Agent Skills 和 MCP

- 状态：已接受
- 日期：2026-11-09

## 背景

移除 Pi Packages（见 0002）后，第三方能力需要一个稳定的接入方式。Agent Skills 和 MCP 都是跨产品的标准，用户为它们制作的内容在其他 Agent 中同样可用。

v2 的 MCP 只支持 stdio。项目级 Skill 目录不一致：本机项目认 `.agents/skills`、`.pi/skills`、`.agent/skills`，远程项目认 `.agents/skills`、`.dela/skills`。

## 决定

- 第三方能力只通过 Agent Skills 和 MCP 接入。
- MCP 支持 stdio 和 Streamable HTTP，不支持旧版 HTTP+SSE。MCP 配置中的密钥存入系统钥匙串。
- 项目级 Skill 只认社区约定的 `.agents/skills`，本机和远程项目一致。
- 内置 Skill 的开关同时决定 Agent 能调用哪些 `dela` 命令。侧栏入口的显隐不影响命令。Dela 自己的项目树命令和 `read_resource` 属于基本能力，不受 Skill 开关控制。

## 后果

- 用户放在其他 Agent 中的 Skill 和 MCP 配置，在 Dela 中可以直接使用。
- 放在 `.agent/skills`、`.pi/skills`、`.dela/skills` 中的 Skill 会失效，需要在 release notes 中提示用户迁移。
- 只连接旧版 SSE 的 MCP 服务器无法使用。
