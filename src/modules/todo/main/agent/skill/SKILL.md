---
name: todo
description: 待办与日程：查询、创建、完成个人待办与个人安排，查看外部来源（如 Canvas 作业）同步来的条目
---

# 待办

个人待办、个人日程与外部来源同步来的条目统一在 TODO。带时间的条目都显示在 TODO 的月历上。

## 命令（Bash 内 dela）

- `dela query_todos '{}'`：全部待办（可按完成状态、时间范围筛选）
- `dela save_todo`：创建/更新个人待办（标题、备注、时间、颜色）
- `dela remove_todo`：删除个人待办
- `dela refresh_todos '{}'`：手动同步所有已连接来源

## 指引

- 时间三选一：要在某刻前完成的用截止 `due`；当天某个时间段的安排（会议、讨论）用时段 `span`；整天或连续几天（考试周、出行）用全天 `allDay`。时段不能跨天，跨天就用全天
- 只有截止类会逾期，时段与全天过去即结束
- 外部来源的条目只读：`status` 是 open/done/unknown，`statusLabel` 是来源自己的说法（如已批改、需重交）；要改状态得去来源那里
- `group` 是来源的分组（如课程）；来源自己的查询命令见对应 Skill（例如 Canvas 的 `query_assignments`）
- 问「某天有什么安排」时，课程用 curriculum 的 `query_schedule`，个人安排用 `query_todos` 加时间范围，两边分别读取
- 通用：`dela help` 查看全部命令与参数；不确定就先 help，不要猜测
