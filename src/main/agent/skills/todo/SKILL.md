---
name: todo
description: 待办与 Canvas 作业：查询、创建、完成个人待办，跟踪作业提交状态与截止时间
---

# 待办与作业

个人待办与 Canvas 作业统一在 TODO 列表。

## 命令（Bash 内 dela）

- `dela todo query_todos`：个人待办与作业清单；`--query` 关键词，`--completed` 只看已完成、`--no-completed` 只看未完成
- `dela todo query_assignments`：Canvas 作业的截止视图；`--course-id`、`--start-at`、`--end-at` 过滤
- `dela todo save_todo --title 交作业 --due-at 2026-11-01T15:00:00Z`：创建/更新待办；`--id` 更新已有条目，`--completed` / `--no-completed` 改完成状态，`--calendar` 与 `--color` 控制是否在日历按截止时间显示
- `dela todo remove_todo --id <id>`：删除个人待办
- `dela todo refresh_todos`：手动同步作业

## 指引

- Canvas 作业只读：区分未完成、已提交、已批改、豁免、需重交；提交要在 Canvas 完成
- 作业描述是 HTML，读取时返回剥离正文（query_assignments 返回 id，正文经 canvas 命令的资料读取获得）
- 截止时间临近需要提醒时，用 curriculum 的 create_event 写入日历
- 通用：`dela todo save_todo --help` 看单条命令的参数，`dela help` 列出全部命令；不确定就先 help，不要猜测
