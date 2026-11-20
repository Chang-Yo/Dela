# 0022. 模型服务、MCP 与联网搜索存为 ~/.dela 下的明文 JSON

- 状态：已接受
- 日期：2026-11-20

## 背景

3.0 把模型服务与 MCP 配置加密存在 `llm-providers.bin`、`mcp-servers.bin`，联网搜索存在数据库。只有 Dela 自己读得懂这些数据。Codex、Claude Code 与 Pi 都把这类配置放在用户主目录的明文文件里，cc-switch、magpie 等社区工具因此可以替用户统一管理模型和 MCP。Dela 没法接入这些工具。

## 决定

- 模型服务与联网搜索存在 `~/.dela/config.json`（`providers`、`webSearch`），MCP 存在 `~/.dela/mcp.json`，格式与 Claude Code 的 `mcpServers` 相同。Skill 仍在 `~/.dela/skills`。
- API Key 明文写在文件里，文件权限只给本人。不支持从命令读取 Key。`mcp.json` 与 Claude Code 一样，连接时展开 `${NAME}` 与 `${NAME:-默认值}`，变量未设置就连接失败；`config.json` 不展开。
- 条目以对象的键为 id。Dela 新建时取厂商名、域名或搜索服务类型，重名加序号，之后不再变；显示名另存，可以随便改。用户和其他工具可以手写。MCP 以服务器名字为 id。迁移把旧的 UUID 换成这种名字，并改写会话记住的 id。
- Dela 每次读最新内容，只改自己要改的那一项，保留不认识的字段与条目。写错的单项跳过；整个文件不是有效 JSON 时报错，修正前不改写它。
- 主进程监听这两个文件，被外部改动后重建空闲会话并推送最新列表。
- 迁移 v12→v13 把旧数据并入这两个文件，已有的键不覆盖。邮箱、Canvas、水源与校园会话的凭据仍加密保存。

## 后果

- magpie 可以通过插件 `magpie-agent-dela` 把自己的网关写进 `providers`，并管理 MCP 与 Skill。
- 能读用户主目录的程序都能读到模型服务的 Key，这与 Codex、Claude Code 相同。使用条款与隐私条款相应修改。
- Agent 协议里 `set-model` 的 `providerId` 从 UUID 改为短名字。只放宽了输入，旧客户端不受影响，协议版本不变。
- 这一点取代 0003 中「MCP 配置中的密钥存入系统钥匙串」。
