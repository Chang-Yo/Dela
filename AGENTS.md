- **ATTENTION: This file can ONLY be modified and mantained by HUMAN.**
- **To Agents: You can NEVER edit this file without permission. You can NEVER edit this file directly.**
  - If the user ask you to edit it, you should remind him/her to edit by own hand.
- 对于和`refactor/v3`相关的分支，可以忽略下面的1&2&3规则，允许直接大幅改动代码

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

**代码严格遵守自解释性原则，靠命名而不是注释表达意图**

- 代码需要做到无注释时依然保持高水平的可读性
- 注释只在必要时写：不超过 80 字、不超过两行，从顶层设计说清这部分的“目的”和取舍，不解释具体代码
- 修改一个文件时，顺带删除其中不符合上一条的注释
- 文档只负责软件设计顶层思想的阐述，不解释具体的实现细节，时刻保持文档的简洁，最大限度减少文档的更新频率
- commit信息始终遵循提交传统和社区主流规范，不添加“第一轮”“批次”等无效工作计划信息
  - 不值得写入文档但又不应该写入注释的信息可以直接放进 commit log
- 每次commit的代码应该服务于同一个主题，目的或者任务，不要将多个关联不大的改动一起提交
- 如果工作区出现了其他你没有参与改动的代码，除非用户要求，不要擅自修改或者commit对方的改动
- 每次commit之前都必须对改动文件进行格式化
- 只在PR或者publish branch的时候更新 CHANGELOG，不应该每个commit都进入 CHANGELOG

## 5. 代码测试

**在为推测性或极不可能发生的竞态或安全边缘情况增加复杂性之前，向用户解释具体的失败模式、可能性和复杂性成本，并获得他们的同意。不要为了理论上的健壮性而默默扩大范围。**

测试属于易失性代码，只保留少量高信号的测试。

- 提交PR之前需要在本地跑测试，并且确认测试通过
- 更新代码后时刻检查是否需要更新相关测试，将过时的测试清理掉
- 只覆盖当前的行为契约和关键回归场景；已经验证、稳定运行的部分不需要测试
- 不断言 className、像素、动画、文案等实现细节
- 不写墓碑测试（断言“已删除的功能继续不存在”）；负向测试只在缺失或失败本身属于 API、安全或持久化契约时才写

## 6. React

**默认不使用 `useEffect`、`useLayoutEffect`、`useInsertionEffect`。禁止把 Effect 当作修复状态异常、页面跳转、数据不更新的补丁。**

只有以下场景允许使用 Effect，并优先使用项目已有的共享 hook：

- 订阅浏览器原生事件，例如 resize、scroll、visibilitychange
- 建立和清理 WebSocket、EventSource 等外部连接
- 初始化、同步、销毁需要命令式 API 的第三方组件
- 管理随组件生命周期启动和清理的外部定时器、观察器、订阅
- 其他需要与 React 外部系统同步、且无法用现有机制完成的情况，**必须事先获得用户批准**

其他写法：

- 派生值在渲染中直接计算；需要重置状态时用 `key`；事件引起的副作用写在事件处理函数里
- 后端数据用 TanStack Query 读取，后端推送的数据进对应领域的 store，导航用 action
- 不手写 `useMemo`、`useCallback`（由 React Compiler 负责）；`useRef` 只用于 DOM 节点和命令式实例
- 禁止模块级可变单例、请求计数器、`let active` 守卫、latest-value ref、用 `setTimeout` 等待渲染

## 7. 界面与 Design System

- 界面优先使用 `ui` 中的组件和 design token，不写 arbitrary 值，不用 Tailwind 原生色板
- token 的语义名称和层次已冻结：只能新增，不能修改或删除
- 同样的界面结构出现两次以上，就提取为组件；先用基础组件组合，反复出现的复杂组合才提取为高级组件

## 8. 其他

- 禁止写 .mjs 文件，全部一律换为 .ts 格式
- 优先复用社区成熟的依赖，不重复造轮子；引入新依赖前核对维护状态、许可证和体积

# v3 目标架构（迁移中）

`refactor/v3` 正在把代码迁入下面的结构。**新代码按目标结构写**，旧目录逐步清空。设计理由见 `v3-refator-plan/Plan-v2.md` 和 `docs/adr/`。

```
src/
├─ core/       Agent 内核与 Agent 协议（core/protocol），只依赖 Node 和 Pi
├─ ui/         Design System，零业务依赖
├─ modules/    通用功能：没有交大也成立
├─ sjtu/       交大功能：离开交大就没有意义
└─ app/        Electron 入口、宿主端口实现、工作台外壳、模块清单（app/modules.ts）
```

每个模块的结构统一为 `index.ts`（模块定义与唯一出口）、`contract.ts`（main 与 view 之间的契约）、`main/`、`view/`、`data/`。

依赖规则（由 CI 检查）：

1. `core` 只依赖 Pi 和 Node；`core/protocol` 只依赖 zod
2. `ui` 只依赖 react、radix、cva、lucide
3. 模块之间只通过对方的 `index.ts` 引用；`view/` 只能引用 `core/protocol`，不能引用 core 的其他部分，也不能引用 `main/`
4. `core`、`modules`、`app` 都不能引用 `sjtu`，唯一例外是 `app/modules.ts`。通用模块需要交大数据时，在通用模块的 `index.ts` 里开注册口，由交大模块注册进来
5. 模块只能引用 `app/module.ts`，不能引用 app 的其他部分

拿到需求后，先判断改动落在哪里：

| 你要做的事                         | 改动位置                                                   |
| ---------------------------------- | ---------------------------------------------------------- |
| 只改某个功能的界面                 | `modules/x/view` 或 `sjtu/x/view`                          |
| 交大接口改版，或需要从学校取新数据 | `sjtu/x/main`                                              |
| 新增一个交大功能                   | 新建 `sjtu/x/`，并在 `app/modules.ts` 中加一行             |
| 让 Agent 获得某个领域的新能力      | 对应模块的命令与 Skill                                     |
| 一个模块需要另一个模块的数据       | 调用对方的 `index.ts`；通用模块需要交大数据时开注册口      |
| 让 Agent 获得通用的新工具          | `core/capabilities`                                        |
| 移动端也需要的新能力               | `core/protocol`，**需要先和用户确认版本策略**              |
| 新的跨模块概念                     | `core` 或 `app/module.ts`，**需要先写 ADR 并获得用户同意** |

拿不准放 `modules` 还是 `sjtu` 时，问一句：如果交大不存在，这个功能还有意义吗？

# 文件目录

下面是 Dela 项目当前（v2）的文件结构，v3 迁移完成后替换为上面的目标结构。在修改对应的代码前应该先定位代码对应的模块位置，并阅读足够的代码来获取到足够的上下文：

```
Dela/
├─ src/
│  ├─ core/                   v3：Agent 内核，只依赖 Pi 与 Node
│  │  ├─ protocol/            Agent 协议、模块契约工具与桌面私有视图类型（只依赖 zod）
│  │  ├─ agent/               Pi 接入、会话、旁问、子 Agent 与后台任务
│  │  ├─ capabilities/        工具、Skills、MCP、联网与注册表
│  │  ├─ remote/              远程执行后端与 helper 通道
│  │  └─ ports.ts             宿主端口（HostPorts）
│  ├─ app/                    v3：模块定义、模块与契约清单、IPC 注册、宿主端口实现
│  ├─ modules/                v3：已迁移的通用模块（search）
│  ├─ main/                   Electron 主进程
│  │  ├─ agent/               dela 命令域与内置 Skills 的注册清单（P5 随各模块迁出）
│  │  ├─ canvas/              Canvas 课程资料
│  │  ├─ documents/           文档读取与 Skill 组件
│  │  ├─ mail/                校园邮箱与第三方 IMAP/SMTP
│  │  ├─ migrations/          旧版用户的数据库迁移
│  │  ├─ notifications/       通知轮询
│  │  ├─ remotes/             SSH 连接管理、端口转发与文件传输
│  │  ├─ settings/            设置与模型/网络配置
│  │  ├─ shuiyuan/            水源社区
│  │  ├─ terminal/            内置终端与 Bash 定位
│  │  ├─ timetable/           课表
│  │  ├─ todo/                TODO
│  │  ├─ update/              应用内更新
│  │  ├─ vsjtu/               致远一号
│  │  └─ workspace/           工作区文件
│  ├─ preload/                contextBridge 与按契约白名单放行的 bridge
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
