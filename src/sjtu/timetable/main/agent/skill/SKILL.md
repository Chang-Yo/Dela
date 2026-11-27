---
name: curriculum
description: 课表：查询从教学信息服务网同步的课程安排
---

# 课表

课表读取本地缓存（由用户在课表页面同步，agent 不联网），只含学校的课程。

## 命令（Bash 内 dela）

- `dela query_schedule`：按周/日期查课程（只读本地缓存）

## 指引

- 课表按学期组织；缺周次或学期日期时不要猜测日期，先问用户
- coverage 提示学期尚未同步时，提示用户到课表页面点击同步
- 个人安排、作业 DDL 与考试不在课表里：用 todo 的 `save_todo` 记录，`query_todos` 查询
- 通用：`dela help` 查看全部命令与参数；不确定就先 help，不要猜测
