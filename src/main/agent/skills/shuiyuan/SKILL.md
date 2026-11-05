---
name: shuiyuan
description: 上海交大水源社区（BBS）：搜索与浏览话题、读帖子正文、把帖子关联进项目
---

# 水源社区

水源是交大校园论坛。搜索讨论、查看帖子时用本 Skill。

## 命令（Bash 内 dela）

- `dela shuiyuan shuiyuan_status`：连接与登录状态
- `dela shuiyuan search_shuiyuan_topics --query 关键词`：搜索话题，翻页把上一页的 `nextCursor` 传给 `--next-cursor`
- `dela shuiyuan list_shuiyuan_topics --kind latest`：浏览话题；`--kind` 取 latest/featured/category/tag，按分类浏览加 `--category-id`，按标签浏览加 `--tag`
- `dela shuiyuan list_shuiyuan_categories`：分类与站点结构
- `dela shuiyuan read_shuiyuan_topic --topic-id 123`：联网读取话题正文与首段楼层，`--post-number` 从指定楼层附近开始
- `dela shuiyuan read_shuiyuan_posts --topic-id 123 --post-ids 456 --post-ids 457`：按楼层 id 续读，每次至多 50 个
- `dela shuiyuan link_shuiyuan_topic --topic-id 123 --parent-id <项目 id>`：把话题加入项目并后台保存快照，返回本地 `ref` 和联网 `onlineRef`

## 指引

- 帖子正文返回 HTML，引用与图片链接保留原始标记
- `workspace` 引用只读项目中的本地快照；正文尚未保存时只能读取摘要，不会联网补取
- `shuiyuan-online` 引用与 `read_shuiyuan_topic` / `read_shuiyuan_posts` 只联网读取；断网时返回错误，不回退快照
- 用 `dela read_resource --ref '{"type":"shuiyuan-online","id":123}'` 读取上述引用；搜索、浏览返回的是联网引用
- 讨论结论值得沉淀时，用 link_shuiyuan_topic 关联进项目，或把要点写进项目笔记
- 通用：`dela shuiyuan <命令> --help` 看单条命令的参数，`dela help` 列出全部命令；不确定就先 help，不要猜测
