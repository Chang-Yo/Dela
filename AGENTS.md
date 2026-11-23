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
- token 按用途命名，不按色相命名；缺少时新增，不借用别的用途的 token。改名或删除要先写 ADR，并在同一个提交里全局替换、同步 lint（ADR 0023）
- 同样的界面结构出现两次以上，就提取为组件；先用基础组件组合，反复出现的复杂组合才提取为高级组件。提取前先问：去掉 Dela 的文案和业务，它还成立吗？
- 写或改 `ui` 里的组件前，先读 `src/ui/README.md` 的约定

## 8. 其他

- 禁止写 .mjs 文件，全部一律换为 .ts 格式
- 优先复用社区成熟的依赖，不重复造轮子；引入新依赖前核对维护状态、许可证和体积

# 架构

代码按下面的结构组织。设计理由见 `docs/adr/`，各子系统的约定见 `docs/DEVELOPMENT.md`。

```
src/
├─ core/       Agent 内核与 Agent 协议（core/protocol），不依赖 Electron、React 与业务
├─ ui/         Design System，零业务依赖
├─ modules/    通用功能：没有交大也成立
├─ sjtu/       交大功能：离开交大就没有意义
└─ app/        Electron 入口、宿主端口实现、工作台外壳、模块清单（modules、views、contracts）
```

每个模块按需包含 `index.ts`（模块定义，主进程侧出口）、`contract.ts`（main 与 view 之间的契约）、`main/`、`view/`（`view/index.ts` 是界面侧出口）、`data/`（`data/schema.ts` 是本模块的表与迁移）；Agent 的命令域与 Skill 放在 `main/agent/`。

依赖规则（由 CI 的 lint 检查）：

1. `core` 不依赖 Electron、React，也不引用 `app`、`modules`、`sjtu`、`ui`，宿主能力经 `core/ports.ts` 注入；`core/protocol` 只依赖 zod
2. `ui` 只依赖 react、radix、cva、lucide、zustand、DOMPurify 与样式工具；`ui/agent` 建在基础组件之上，基础组件不能反过来引用它
3. 模块之间只通过对方的 `index.ts`、`contract.ts` 或 `view/index.ts` 引用；`view/` 只能引用 `core/protocol`、`app/module.ts`、其他模块的 `contract.ts` 与 `ui`，不能引用本模块的 `main/`；主进程侧不能引用 `view/`
4. `core`、`modules`、`app` 都不能引用 `sjtu`，例外是 `app/modules.ts`、`app/views.ts` 两份清单。通用模块需要交大数据时，在通用模块的 `index.ts` 里开注册口，由交大模块注册进来。CI 还会去掉全部交大模块后再做类型检查、构建与冒烟
5. 模块只能引用 `app/module.ts`，不能引用 app 的其他部分
6. `app/module.ts` 不引用任何模块，它与模块共用的类型放在 `core/protocol`
7. 项目快捷方式的 sourceId 前缀以模块名开头（如 `canvas-`、`shuiyuan-topic:`），前缀重叠时登记直接报错

拿到需求后，先判断改动落在哪里：

| 你要做的事                         | 改动位置                                                   |
| ---------------------------------- | ---------------------------------------------------------- |
| 只改某个功能的界面                 | `modules/x/view` 或 `sjtu/x/view`                          |
| 交大接口改版，或需要从学校取新数据 | `sjtu/x/main`                                              |
| 新增一个交大功能                   | 新建 `sjtu/x/`，并在 app 的两份清单里按需各加一行          |
| 让 Agent 获得某个领域的新能力      | 对应模块 `main/agent/` 里的命令域与 Skill                  |
| 一个模块需要另一个模块的数据       | 调用对方的 `index.ts`；通用模块需要交大数据时开注册口      |
| 让 Agent 获得通用的新工具          | `core/capabilities`                                        |
| 移动端也需要的新能力               | `core/protocol`，**需要先和用户确认版本策略**              |
| 新的跨模块概念                     | `core` 或 `app/module.ts`，**需要先写 ADR 并获得用户同意** |

拿不准放 `modules` 还是 `sjtu` 时，问一句：如果交大不存在，这个功能还有意义吗？

# 文件目录

下面是 Dela 项目当前的文件结构。在修改对应的代码前应该先定位代码对应的模块位置，并阅读足够的代码来获取到足够的上下文：

```
Dela/
├─ src/
│  ├─ core/                   Agent 内核，不依赖 Electron、React 与业务
│  │  ├─ protocol/            Agent 协议、模块契约工具与桌面私有视图类型（只依赖 zod）
│  │  ├─ agent/               Pi 接入、会话、旁问、子 Agent 与后台任务
│  │  ├─ capabilities/        工具、Skills、MCP、联网与注册表
│  │  ├─ remote/              远程执行后端与 helper 通道
│  │  ├─ data/                会话表的结构与迁移
│  │  ├─ config-files.ts      ~/.dela 下的 JSON 配置（模型服务、联网搜索、MCP）
│  │  └─ ports.ts             宿主端口（HostPorts）
│  ├─ ui/                     Design System（fork 自 beautiful-ui），零业务依赖
│  │  └─ agent/               Agent 对话外观组件（消息、工具卡片、输入框）
│  ├─ modules/                通用模块（chat、mail、note、notifications、onboarding、preview、
│  │                          remotes、search、settings、terminal、todo、update、workspace）
│  ├─ sjtu/                   交大模块，经 register() 向通用模块的注册口登记
│  │  ├─ campus/              校园统一身份认证会话（课表、课堂视频、水源共用）
│  │  ├─ canvas/              Canvas 课程资料、作业与公告
│  │  ├─ classroom/           课堂视频回看（v.sjtu.edu.cn）
│  │  ├─ jwc/                 教务处通知
│  │  ├─ mail/                交大邮箱的服务器预设，登记给通用邮件模块
│  │  ├─ shuiyuan/            水源社区
│  │  └─ timetable/           课表与日历事件
│  └─ app/                    宿主与外壳
│     ├─ module.ts            模块与视图定义，模块唯一可引用的 app 文件
│     ├─ modules.ts           主进程模块清单
│     ├─ views.ts             渲染端视图清单
│     ├─ main/                Electron 入口、数据库、旧版数据过渡、IPC 注册与宿主端口实现
│     ├─ preload/             contextBridge 与按契约白名单放行的 bridge
│     └─ renderer/            外壳界面：shell、workbench、navigation、workspace、settings、styles
├─ helper/                    Go 远端 helper
├─ scripts/                   开发、冒烟、打包与校验脚本
├─ docs/                      开发文档、架构决策（adr/）、条款与接口资料
├─ experiments/               一次性技术实验的报告
├─ vendor/                    入库的 helper、搜索工具、OpenSSH 与 xlsx
├─ LICENSES/                  随源码分发的第三方许可证
├─ assets/                    图标与品牌素材
└─ build/                     打包用图标等构建资源
```

如果出现较大的代码改动，需要及时更新该目录树。
