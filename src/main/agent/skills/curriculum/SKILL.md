---
name: curriculum
description: 课表与日程：查询课程安排、创建与管理日历事件
---

# 课表与日程

课表与开学日期读本地缓存（由用户在课表页面同步），日程存本地日历。

## 命令（Bash 内 dela）

- `dela query_schedule`：按周/日期查课表与日程（只读本地缓存）
- `dela infer_semester_start`：用课堂录像推断开学日期（联网只读，不写入）
- `dela set_semester_start`：写入开学日期（本地写，只影响本地换算）
- `dela create_event`：创建日历事件（标题、开始、结束、地点、颜色）
- `dela delete_event`：删除日历事件

## 指引

- 课表按学期组织；缺周次时不要猜测日期，先问用户
- coverage 提示学期尚未同步时，提示用户到课表页面点击同步
- coverage 提示缺少学期开始日期时：先 `infer_semester_start`，把候选日期、依据（哪几门课、第一节落在哪天）和偏差风险讲给用户，确认后再 `set_semester_start`
- 录像只会晚于真实开学日：只有 1 门课有录像、或各门课最早录像不在同一周时，候选会偏晚，必须说明这一点
- 开学日期写错会让整学期所有课的周次错位，用户确认前不要写入
- 学院（如浦江国际学院）开学时间可能与校历不同，不要拿官网或校历日期覆盖用户确认的日期
- 作业 DDL、考试安排值得跟踪时，用 create_event 写入日历（可从 TODO 与 Canvas 作业获取时间）
- 日历事件里 todo: 前缀的是待办派生色块，不可经 delete_event 删除
- 通用：`dela help` 查看全部命令与参数；不确定就先 help，不要猜测
