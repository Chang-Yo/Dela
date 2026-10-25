# 上海交通大学校园服务开发 Wiki

面向希望开发个人校园服务、Agent、MCP、自动化工具或数据面板的师生。本 Wiki 说明如何取得凭证、如何读取数据、能够取得什么，以及这些数据可以支持哪些服务。

> [!IMPORTANT]
> 本 Wiki 不是接口可用性的永久承诺。校园平台会调整申请资格、字段和授权方式；开发前请重新核对对应服务的正式页面。

| 收录范围            | 当前状态                                 | 最近核对   |
| ------------------- | ---------------------------------------- | ---------- |
| 6 类、20 项校园服务 | 官方文档、个人账号实测与社区源码并行记录 | 2026-10-25 |

## 从这里开始

| 你的目标                     | 推荐入口                                                                          |
| ---------------------------- | --------------------------------------------------------------------------------- |
| 查某项校园服务能取得什么数据 | [服务地图](#服务地图)                                                             |
| 找申请表、登录入口或授权方法 | [办理与授权入口速查](#办理与授权入口速查)                                         |
| 了解具体的数据获取流程       | [分主题服务文档](#分主题文档)                                                     |
| 检查凭证、隐私和平台规则     | [安全、隐私与合规](https://github.com/Chang-Yo/Dela/wiki/Security-and-Compliance) |
| 核对原始文档和社区实践       | [资料索引](https://github.com/Chang-Yo/Dela/wiki/Sources)                         |
| 认领尚未确认的数据来源       | [待核查服务与证据缺口](https://github.com/Chang-Yo/Dela/wiki/Roadmap)             |

## 验证状态

- **实测：** 已使用个人账号完成登录、授权和数据读取。实测只证明记录日期的行为。
- **官方：** 依据学校或上游平台公开文档整理；没有获批凭据时，不补写未经验证的响应行为。
- **源码核对：** 已核对服务页面和公开仓库，但尚未使用个人账号复测。
- **待补证：** 尚未取得稳定接口、开通材料或个人测试条件。只记录已确认的入口和证据缺口。

## 服务地图

| 分类           | 服务                                                                                                              | 主要凭证                                | 数据渠道                         | 状态           |
| -------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------- | -------------------------------- | -------------- |
| 身份与开放平台 | [jAccount](https://github.com/Chang-Yo/Dela/wiki/Identity-and-Open-Platform#jaccount-统一身份认证)                | App ID、App Secret、用户授权            | OIDC、OAuth 2.0、Profile API     | 官方           |
| 身份与开放平台 | [上海交通大学 Open API](https://github.com/Chang-Yo/Dela/wiki/Identity-and-Open-Platform#上海交通大学-open-api)   | App ID、App Secret、Access Token、scope | REST API                         | 官方           |
| 校级数据与流程 | [校级数据资源 API](https://github.com/Chang-Yo/Dela/wiki/Data-and-Workflows#校级数据资源-api)                     | 应用凭据、Token、字段授权               | 数据资源 REST API                | 官方           |
| 校级数据与流程 | [交我办与 InfoPlus](https://github.com/Chang-Yo/Dela/wiki/Data-and-Workflows#交我办与-infoplus)                   | App ID、Secret、User 或 System Token    | 流程、文件、通知、导出和事件 API | 官方           |
| 学习与社区     | [Canvas](https://github.com/Chang-Yo/Dela/wiki/Learning-and-Community#canvas-在线教学平台)                        | 个人 Access Token                       | Canvas REST API                  | 实测           |
| 学习与社区     | [本科教学信息网与课表](https://github.com/Chang-Yo/Dela/wiki/Learning-and-Community#本科教学信息服务网与个人课表) | jAccount 会话或 Education API Token     | 个人课表接口、Education API      | 官方 + 实测    |
| 学习与社区     | [课堂视频](https://github.com/Chang-Yo/Dela/wiki/Learning-and-Community#课堂视频)                                 | jAccount 会话                           | 课堂录像接口                     | 实测           |
| 学习与社区     | [第二课堂](https://github.com/Chang-Yo/Dela/wiki/Learning-and-Community#第二课堂)                                 | jAccount 登录、`IMPSA-Token`            | 活动平台内部接口                 | 实测（只读）   |
| 学习与社区     | [选课社区](https://github.com/Chang-Yo/Dela/wiki/Learning-and-Community#选课社区)                                 | 用户 API Key                            | 选课社区 API                     | 实测（只读）   |
| 学习与社区     | [传承·交大](https://github.com/Chang-Yo/Dela/wiki/Learning-and-Community#传承交大)                                | jAccount 登录、站点 Token               | 当前生产接口                     | 实测（只读）   |
| 学习与社区     | [水源社区](https://github.com/Chang-Yo/Dela/wiki/Learning-and-Community#水源社区)                                 | Discourse User API Key、Client ID       | Discourse REST JSON API          | 实测           |
| 邮件与存储     | [交大邮箱](https://github.com/Chang-Yo/Dela/wiki/Mail-and-Storage#交大邮箱)                                       | 邮箱密码或 Mail API Token               | IMAP、SMTP、Mail API             | 官方 + 实测    |
| 邮件与存储     | [交大云盘 Pan](https://github.com/Chang-Yo/Dela/wiki/Mail-and-Storage#交大云盘-pan)                               | jAccount 会话                           | 官方网页端和客户端               | API 待补证     |
| 网络与部署     | [交大 VPN](https://github.com/Chang-Yo/Dela/wiki/Network-and-Deployment#交大-vpn)                                 | jAccount                                | 官方 VPN 客户端                  | 官方           |
| 网络与部署     | [jCloud](https://github.com/Chang-Yo/Dela/wiki/Network-and-Deployment#jcloud-交大云)                              | jAccount、项目 Token、SSH 密钥          | 控制台、REST API、SSH            | 官方           |
| 网络与部署     | [校园域名与网站](https://github.com/Chang-Yo/Dela/wiki/Network-and-Deployment#校园域名与网站服务)                 | jAccount、域名和站点权限                | 交我办流程、网站平台、邮件       | 官方           |
| 网络与部署     | [网络短信](https://github.com/Chang-Yo/Dela/wiki/Network-and-Deployment#网络短信服务)                             | 集体账号或接口凭据                      | 网络短信平台                     | 接口契约待补证 |
| AI 与计算      | [OpenClaw 校园应用中心](https://github.com/Chang-Yo/Dela/wiki/AI-and-Compute#openclaw-校园应用中心与-skill-集市)  | 目录无需凭证                            | Skill 集市和项目仓库             | 官方关联       |
| AI 与计算      | [致远一号模型 API](https://github.com/Chang-Yo/Dela/wiki/AI-and-Compute#致远一号模型-api)                         | API Key                                 | 模型 API                         | 官方           |
| AI 与计算      | [交我算 HPC](https://github.com/Chang-Yo/Dela/wiki/AI-and-Compute#交我算-hpc-与智算平台)                          | 平台账号、SSH 凭据                      | HPC Studio、SSH、Slurm、项目存储 | 官方           |

## 分主题文档

| 页面                                                                                   | 包含内容                                                          |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [身份认证与开放平台](https://github.com/Chang-Yo/Dela/wiki/Identity-and-Open-Platform) | jAccount、Open API                                                |
| [校级数据与流程](https://github.com/Chang-Yo/Dela/wiki/Data-and-Workflows)             | 数据资源 API、交我办、InfoPlus                                    |
| [学习与社区](https://github.com/Chang-Yo/Dela/wiki/Learning-and-Community)             | Canvas、教学信息网、课堂视频、第二课堂、选课社区、传承·交大、水源 |
| [邮件与存储](https://github.com/Chang-Yo/Dela/wiki/Mail-and-Storage)                   | 交大邮箱、交大云盘                                                |
| [网络与部署](https://github.com/Chang-Yo/Dela/wiki/Network-and-Deployment)             | VPN、jCloud、域名网站、网络短信                                   |
| [AI 与计算](https://github.com/Chang-Yo/Dela/wiki/AI-and-Compute)                      | OpenClaw、致远一号、交我算 HPC                                    |

## 办理与授权入口速查

“直接办理”会进入实际申请表单；“服务入口”用于登录或自助开通；“办理说明”只解释流程，不能代替提交申请。需要在交我办内搜索的流程没有公开固定表单地址。

| 服务                  | 实际取得凭证或权限的入口                                                                                             | 入口性质                            |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| jAccount 与 Open API  | 登录[交我办](https://my.sjtu.edu.cn/)，进入“信息服务 → 其他 → jAccount 接口申请”                                     | 服务入口；进入后提交申请            |
| 校级数据资源 API      | [数据资源 API 申请流程](https://form.sjtu.edu.cn/infoplus/form/data_exchange_api_apply/start)                        | 直接办理；未登录时跳转 jAccount     |
| 交我办与 InfoPlus     | [交我办应用上线申请](https://form.sjtu.edu.cn/infoplus/form/jwb_application_online_apply/start)                      | 直接办理；系统集成另按文档邮件联系  |
| Canvas                | [Canvas](https://oc.sjtu.edu.cn/) 登录后的个人设置页                                                                 | 服务入口；个人 Token 无独立审批流程 |
| 本科教学信息服务网    | [教学信息服务网](https://i.sjtu.edu.cn/) 直接登录；Education API 走 jAccount 接口申请                                | 服务入口或交我办申请                |
| 课堂视频              | [交大视频](https://v.sjtu.edu.cn/) 使用 jAccount 登录                                                                | 服务入口；权限来自本人教学班        |
| 第二课堂              | [第二课堂](https://activity.sjtu.edu.cn/) 使用 jAccount 登录；本地工具复用登录后生成的 `IMPSA-Token`                 | 服务入口；内部接口无公开申请流程    |
| 选课社区              | 登录[选课社区](https://course.sjtu.plus/)，在“API Keys”页面生成用户 Key                                              | 社区服务入口；用户自助生成          |
| 传承·交大             | [传承·交大](https://share.dyweb.sjtu.cn/) 使用 jAccount 登录；本地工具复用浏览器本地存储中的站点 Token               | 社区服务入口；无公开 API 申请流程   |
| 水源社区              | 应用生成水源 `/user-api-key/new` 授权链接，由用户登录并确认                                                          | 用户授权；不是校内审批表单          |
| 交大邮箱              | 个人邮箱随 jAccount 开通；Mail API 走 jAccount 接口申请                                                              | 自动开通或交我办申请                |
| 交大云盘 Pan          | [交大云盘](https://pan.sjtu.edu.cn/) 使用 jAccount 登录                                                              | 服务入口；暂无公开开发者 API 申请   |
| 交大 VPN              | 从[VPN 服务页](https://net.sjtu.edu.cn/wlfw/VPN.htm)下载客户端并用 jAccount 登录                                     | 服务入口；个人账号无需另行申请      |
| jCloud                | [jCloud 控制台](https://home.jcloud.sjtu.edu.cn/auth/login/?next=/) 使用 jAccount 登录，在项目内申请资源并获取 Token | 服务入口；资源和配额在控制台办理    |
| 校园域名与网站        | [域名、站群建站申请或变更](https://form.sjtu.edu.cn/infoplus/form/nicman_dns_and_virtualhost/start?locale=zh)        | 直接办理；未登录时跳转 jAccount     |
| 网络短信              | 下载[短信平台申请表](https://net.sjtu.edu.cn/images/sms.doc)，签字盖章后线下提交                                     | 线下办理；不是在线 API 申请         |
| OpenClaw 校园应用中心 | [应用中心](https://claw.sjtu.edu.cn/)和 Skill 集市直接浏览                                                           | 资料入口；具体 Skill 另取所需凭证   |
| 致远一号模型 API      | 登录[交我办](https://my.sjtu.edu.cn/)，搜索“‘致远一号’AI模型API申请（测试）”                                         | 服务入口；进入后提交申请            |
| 交我算 HPC            | 登录[交我办](https://my.sjtu.edu.cn/)，进入“交我算 → 交我算账号申请”                                                 | 服务入口；进入后提交申请            |

## 编辑原则

- 每个服务固定回答六个问题：服务能力、凭证获取、数据获取、数据范围、可构建服务、参考资料。
- 正文优先写可复现的获取流程，不写具体产品实现。
- 官方文档、个人实测和社区实践分开标注。
- 无法验证的内容进入[待核查服务](https://github.com/Chang-Yo/Dela/wiki/Roadmap)，不以推测补齐。
- 安全和平台规则集中维护在[安全与合规](https://github.com/Chang-Yo/Dela/wiki/Security-and-Compliance)，避免各服务重复展开。

---

[开始阅读：身份认证与开放平台 →](https://github.com/Chang-Yo/Dela/wiki/Identity-and-Open-Platform)
