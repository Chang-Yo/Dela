- **ATTENTION: This file can ONLY be modified and mantained by HUMAN.**
- **To Agents: You can NEVER edit this file without permission. You can NEVER edit this file directly.**
  - If the user ask you to edit it, you should remind him/her to edit by own hand.

# Working core rules

**"不要默认假设。不要隐藏困惑。呈现权衡。"**
**每个人的想法都受限于认知，注意提醒用户的Unknown unknown。**
**请先阅读 @README.md**

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
- 除非可组合或可复用，否则保持在一个函数中
- 通过阅读代码块的 commit 历史记录来了解功能的改进方向
- 在拥有未知值的边界处验证一次。向内传递已类型化的值，而不是重复 typeof value === "object" 和属性存在性检查。不要防御性地重新验证已由 schema、构造函数或内部类型保证的值。

当你的改动产生了孤立的代码时：

- 移除因你的改动而变得未使用的 import/变量/函数。
- 不要移除之前就存在的废弃代码，除非被明确要求。

检验标准："每一行改动都应该能追溯到用户的请求。"

不要预先提取单次使用的辅助函数。在调用点内联逻辑，除非该辅助函数被复用、隐藏了真正复杂的边界，或具有能改善调用方的清晰独立名称。

## 4. 代码提交与文档维护

**代码严格遵守自解释性原则，最大限度去掉注释和文档解释**

- 代码需要做到无注释时依然保持高水平的可读性
- 文档只负责软件设计顶层思想的阐述，不解释具体的实现细节，时刻保持文档的简洁，最大限度减少文档的更新频率
- commit信息始终遵循提交传统和社区主流规范，不添加“第一轮”“批次”等无效工作计划信息
  - 不值得写入文档但又不应该写入注释的信息可以直接放进 commit log
- 每次commit的代码应该服务于同一个主题，目的或者任务，不要将多个关联不大的改动一起提交
- 如果工作区出现了其他你没有参与改动的代码，除非用户要求，不要擅自修改或者commit对方的改动
- 每次commit之前都必须对改动文件进行格式化
- 只在PR或者publish branch的时候更新 CHANGELOG，不应该每个commit都进入 CHANGELOG

## 5. 代码测试

**在为推测性或极不可能发生的竞态或安全边缘情况增加复杂性之前，向用户解释具体的失败模式、可能性和复杂性成本，并获得他们的同意。不要为了理论上的健壮性而默默扩大范围。**

- 提交PR之前需要在本地跑测试，并且确认测试通过
- 更新代码后时刻检查是否需要更新相关测试，将过时的测试清理掉
- 写新测试时应侧重于有实际意义的回归测试和行为测试，不要写无意义的测试

## 6. 其他

- 禁止写 .mjs 文件，全部一律换为 .ts 格式

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
│  │  ├─ migrations/          旧版用户的数据库迁移
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
