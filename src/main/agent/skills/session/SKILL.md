---
name: session
description: 读取、创建和调用 Dela 会话
---

# Dela 会话

这些命令操作本机 Dela 中已经存在的会话。先用会话 ID 确认目标，不根据标题猜测目标。

## 命令

- `dela list_sessions '{}'`：列出所有未归档会话。
- `dela list_sessions '{"projectId":"项目 ID","query":"关键词","offset":0,"limit":20}'`：按项目和标题分页查找。
- `dela list_sessions '{"includeArchived":true}'`：明确包含归档会话。
- `dela read_session '{"sessionId":"会话 ID","offset":0,"limit":20}'`：分页读取会话投影。
- `dela create_session '{"projectId":null,"scope":"chat"}'`：强制创建新的通用会话。
- `dela send_session_message '{"sessionId":"会话 ID","text":"要发送的内容"}'`：向未归档会话发送一轮消息，立即返回运行 ID。
- `dela wait_session_run '{"runId":"运行 ID","timeoutMs":30000}'`：等待或查询运行结果。
- `dela cancel_session_run '{"runId":"运行 ID"}'`：取消正在执行的运行。

## 指引

- `list_sessions` 的 `projectId` 省略时搜索所有项目；传 `null` 时只搜索通用会话。
- 默认不读取归档会话。读取归档会话必须显式设置 `includeArchived: true`。
- 首版不支持向归档会话发送消息，会返回明确错误，不会改发到其他会话。
- `read_session` 返回现有会话投影中的用户消息、Agent 回复、工具调用和工具结果。按 `nextOffset` 继续读取，不要默认连续读取整个长会话。
- `wait_session_run` 超时只返回当前状态，不会取消运行。应用重启后运行 ID 失效，但已经写入目标会话的内容仍可读取。
- 会话继续使用它自己保存的提供商、模型和推理强度；不要因为当前界面选择变化而假设目标会话会切换模型。
