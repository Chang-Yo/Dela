---
name: todo
description: 待办：查询、创建、完成个人待办，查看外部来源（如 Canvas 作业）同步来的条目
---

# 待办

个人待办与外部来源同步来的条目统一在 TODO 列表。

## 命令（Bash 内 dela）

- `dela query_todos '{}'`：全部待办（可按完成状态筛选）
- `dela save_todo`：创建/更新个人待办（标题、备注、截止时间）
- `dela remove_todo`：删除个人待办
- `dela refresh_todos '{}'`：手动同步所有已连接来源

## 指引

- 外部来源的条目只读：`status` 是 open/done/unknown，`statusLabel` 是来源自己的说法（如已批改、需重交）；要改状态得去来源那里
- `group` 是来源的分组（如课程）；来源自己的查询命令见对应 Skill（例如 Canvas 的 `query_assignments`）
- 截止时间临近需要提醒时，用 curriculum 的 create_event 写入日历
- 通用：`dela help` 查看全部命令与参数；不确定就先 help，不要猜测
