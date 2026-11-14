---
name: curriculum
description: 课表与日程：查询课程安排、创建与管理日历事件
---

# 课表与日程

课表读取本地缓存（由用户在课表页面同步，agent 不联网），日程存本地日历。

## 命令（Bash 内 dela）

- `dela query_schedule`：按周/日期查课表与日程（只读本地缓存）
- `dela create_event`：创建日历事件（标题、开始、结束、地点、颜色）
- `dela delete_event`：删除日历事件

## 指引

- 课表按学期组织；缺周次或学期日期时不要猜测日期，先问用户
- coverage 提示学期尚未同步时，提示用户到课表页面点击同步
- 作业 DDL、考试安排值得跟踪时，用 create_event 写入日历（可从 TODO 与 Canvas 作业获取时间）
- 日历事件里 todo: 前缀的是待办派生色块，不可经 delete_event 删除
- 通用：`dela help` 查看全部命令与参数；不确定就先 help，不要猜测
