---
name: canvas
description: Canvas 课程平台：课程与资料检索、作业要求阅读、把课件与资料关联进项目
---

# Canvas 课程资料

课程文件、实验要求、公告等教学资料在 Canvas。查资料、读课件时用本 Skill。

## 命令（Bash 内 dela）

- `dela get_canvas_status '{}'`：连接状态
- `dela list_canvas_courses '{}'`：已缓存课程列表
- `dela search_canvas_sources '{"query":"实验"}'`：按标题搜课程资料
- `dela refresh_canvas_courses` / `dela refresh_canvas_course`：同步课程（先同步后搜索）
- `dela read_resource '{"ref":{"type":"canvas","id":"file:123"}}'`：读资料页面正文；文件正文使用 document-reading Skill
- `dela link_canvas_source`：把资料作为来源引用加入项目
- `dela copy_file_to_project`：把资料复制为项目文件，长期使用

## 指引

- 只匹配缓存标题；先确认状态已连接、课程已同步
- 实验报告、大作业的要求文档读完后，把要点整理进项目笔记，课件用 link 或 copy 挂进项目
- 作业截止时间见 TODO（query_assignments）；到期日可用 curriculum 的 create_event 写入日历
- 通用：`dela help` 查看全部命令与参数；不确定就先 help，不要猜测
