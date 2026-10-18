- **ATTENTION: This file can ONLY be modified and mantained by HUMAN.**
- **To Agents: You can NEVER edit this file without permission. You can NEVER edit this file directly.**
  - If the user ask you to edit it, you should remind him/her to edit by own hand.

# Working core rules

**"不要默认假设。不要隐藏困惑。呈现权衡。"**
**每个人的想法都受限于认知，注意提醒用户的Unknown unknown。**

## 1. 先思考再编码

实现之前：

- 明确陈述假设；如果不确定或不明白，就提问。不要擅自为用户做决定。
- 当存在多种理解时，逐一列出而非默默选择。
- 如果存在更简单的方案，直接说明并在必要时提出异议。

## 2. 简洁优先

**"用最少的代码解决问题。不做臆测性编码。"**

- 不实现超出需求的特性。
- 不为仅使用一次的代码做抽象。
- 不添加未经要求的"灵活性"或"可配置性"。
- **不处理在当前系统边界内不会发生的错误场景。**

## 3. 精准改动

**"只改必须改的。只清理自己制造的遗留。"**

编辑现有代码时：

- 不要"改善"相邻的代码、注释或格式。
- 不要重构没有问题的代码。
- **与现有风格保持一致。**
- 如果发现无关的废弃代码，提出来而不是直接删除。

当你的改动产生了孤立的代码时：

- 移除因你的改动而变得未使用的 import/变量/函数。
- 不要移除之前就存在的废弃代码，除非被明确要求。

检验标准："每一行改动都应该能追溯到用户的请求。"

## 4. 代码提交

- 代码提交前应检查是否有相关文档需要更新，如果有，必须先更新之
- commit信息始终遵循社区主流规范，不添加“第一轮”“批次”等无效工作计划信息
- 每次commit的代码应该服务于同一个主题，目的或者任务，不要将多个关联不大的改动一起提交
- 如果工作区出现了其他你没有参与改动的代码，除非用户要求，不要擅自修改或者commit对方的改动

## 5. 注释

- 不要写无意义的废话注释
- 不要写将代码重新解释一遍的注释，代码本身就能够解释
- 不要写代码工作的原理，而应该写
  - 这个模块设计的理念，它在整个架构实现中的定位，它服务于/连接了/解决了什么
  - MagicNumber的取舍，为什么会出现硬编码的MagicNumber
- 保持代码简洁，用词精准，消除语义潜在的歧义

## 6. 其他

- 禁止写 .cjs 文件，全部一律换为 .ts 格式

# 文件目录

下面是 Dela 项目的基本文件结构，在修改对应的代码前应该先定位代码对应的模块位置，并阅读足够的代码来获取到足够的上下文：

```
Dela/
├─ src/
│  ├─ main/                   Electron 主进程
│  │  ├─ agent/               Pi 内核接入、工具与运行时
│  │  ├─ canvas/              Canvas 课程资料
│  │  ├─ documents/           文档读取与 Skill 组件
│  │  ├─ mail/                校园邮箱与第三方 IMAP/SMTP
│  │  ├─ notifications/       通知轮询
│  │  ├─ remotes/             远程项目与 helper 隧道
│  │  ├─ search/              全局搜索
│  │  ├─ settings/            设置与模型/网络配置
│  │  ├─ shuiyuan/            水源社区
│  │  ├─ terminal/            内置终端与 Bash 定位
│  │  ├─ timetable/           课表
│  │  ├─ todo/                TODO
│  │  ├─ update/              应用内更新
│  │  ├─ vsjtu/               致远一号
│  │  └─ workspace/           工作区文件
│  ├─ preload/                contextBridge 与有限 API
│  ├─ renderer/               React 界面
│  │  ├─ app/                 应用外壳、主题与全局状态
│  │  ├─ workbench/           标签工作台
│  │  ├─ content/             聊天、笔记、预览、审阅、终端内容区
│  │  ├─ navigation/          侧栏与导航
│  │  ├─ sessions/            会话管理
│  │  ├─ workspace/           工作区浏览
│  │  ├─ features/            业务功能页（mail、settings、timetable…）
│  │  ├─ components/          通用组件与 beautifului
│  │  ├─ lib/                 渲染层工具
│  │  └─ styles/              全局样式与设计 token
│  └─ shared/                 进程间 IPC 契约与纯函数
├─ helper/                    Go 远端 helper
├─ scripts/                   开发、冒烟、打包与校验脚本
├─ docs/                      开发文档、条款与接口资料
├─ vendor/                    入库的 helper、搜索工具与 OpenSSH
├─ assets/                    图标与品牌素材
└─ build/                     打包用图标等构建资源
```

如果出现较大的代码改动，需要及时更新该目录树。
