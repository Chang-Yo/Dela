---
name: shuiyuan
description: 上海交大水源社区（BBS）：搜索与浏览话题、读帖子正文、把帖子关联进项目
---

# 水源社区

水源是交大校园论坛。搜索讨论、查看帖子时用本 Skill。

## 命令（Bash 内 dela）

- `dela shuiyuan_status '{}'`：连接与登录状态
- `dela search_shuiyuan_topics '{"query":"关键词"}'`：搜索话题
- `dela list_shuiyuan_topics`：按分类/最新浏览话题（支持分页）
- `dela list_shuiyuan_categories '{}'`：分类与站点结构
- `dela read_shuiyuan_topic` / `dela read_shuiyuan_posts`：话题正文与楼层
- `dela link_shuiyuan_topic`：把话题作为来源引用加入项目

## 指引

- 帖子正文返回 HTML，引用与图片链接保留原始标记
- 断网时读取会回退本地缓存摘要，结果带 degraded 标注，需向用户说明内容不完整
- 讨论结论值得沉淀时，用 link_shuiyuan_topic 关联进项目，或把要点写进项目笔记
- 通用：`dela help` 查看全部命令与参数；不确定就先 help，不要猜测
