# 校园 AI 与计算资源

[← Wiki 首页](https://github.com/Chang-Yo/Dela/wiki) · [← 网络与部署](https://github.com/Chang-Yo/Dela/wiki/Network-and-Deployment) · [安全与合规](https://github.com/Chang-Yo/Dela/wiki/Security-and-Compliance) · [待核查服务](https://github.com/Chang-Yo/Dela/wiki/Roadmap)

本页汇总校园 Skill 生态、致远一号模型 API 与交我算 HPC，重点说明凭证、可调用能力和个人自动化路径。

## OpenClaw 校园应用中心与 Skill 集市

**服务能力**

OpenClaw 校园应用中心提供校园 Agent 指南、案例和 Skill 目录。Skill 集市收录由交大师生开发维护的校园能力，也收录公开社区 Skill。

**凭证如何获取**

浏览目录不需要校园数据凭证。安装具体 Skill 后，按照该 Skill 的说明取得它依赖的 Canvas Token、邮箱密码、API Key、User API Key 或其他凭证。

**数据如何获取**

1. 打开校园应用中心或 Skill 集市。
2. 按用途选择 Skill。
3. 进入项目来源页面，阅读安装和凭证说明。
4. 核对 Skill 访问的服务、数据范围和写入能力。
5. 安装后，在本机或自己的 Agent 环境中配置凭证。
6. 通过 Skill 暴露的命令或工具读取相应服务数据。

**可获得的数据范围**

目录本身提供 Skill 名称、用途、开发者和来源链接。具体校园数据由各 Skill 所连接的服务决定。

**可以构建的服务**

- 校园 Agent
- 课程、作业和资料工具
- 校园新闻和生活信息助手
- 科研与 HPC 工具
- 可复用的校园 MCP 或 Skill

**服务入口与参考资料**

- [OpenClaw 校园应用中心](https://claw.sjtu.edu.cn/)
- [交大龙虾 Skill 集市](https://claw.sjtu.edu.cn/sjtu-skills/)
- [案例中心](https://claw.sjtu.edu.cn/cases/)
- [openclaw-sjtu](https://github.com/xhh678876/openclaw-sjtu)

## 致远一号模型 API

**服务能力**

致远一号向校内项目提供大模型 API。开发者可以提交文本或图片并取得模型生成结果。

**凭证如何获取**

1. 登录[交我办](https://my.sjtu.edu.cn/)网页端或移动端。
2. 搜索“‘致远一号’AI模型API申请（测试）”流程。
3. 填写项目用途、使用场景和接收开通信息的邮箱。
4. 提交后等待审批。
5. 获批后从邮件或交我办消息取得 API 地址、API Key 和可用模型说明。
6. 校外使用时，先连接交大 VPN。

**数据如何获取**

1. 按开通材料配置 API 地址和 API Key。
2. 查询或选择当前可用模型。
3. 按文档提交对话、文本或多模态请求。
4. 读取模型输出、结束原因和用量信息。
5. 在致远一号用量页面查看账户额度和调用统计。

**可获得的数据范围**

- 当前账户可用模型
- 文本或多模态生成结果
- 请求用量和额度
- 平台返回的错误和限流信息

模型 API 不自动提供课程、邮件或其他校园数据。若要让模型处理校园数据，需要先通过对应服务取得数据，再明确地传入模型请求。

**可以构建的服务**

- 校园问答
- 文本摘要和改写
- 图像理解
- 课程资料辅助阅读
- 本地 Agent 的模型提供方
- 结合个人校园数据的检索增强问答

**服务入口与参考资料**

- [交我办](https://my.sjtu.edu.cn/)
- [致远一号模型 API 文档](https://claw.sjtu.edu.cn/guide/sjtu-api/)
- [接入主流 AI 应用](https://claw.sjtu.edu.cn/guide/api-agent/)
- [致远一号用量统计](https://aic.sjtu.edu.cn/top)
- [OpenClaw FAQ](https://claw.sjtu.edu.cn/guide/faq/)

## 交我算 HPC 与智算平台

**服务能力**

交我算提供 CPU、GPU、并行存储、HPC Studio、SSH 和 Slurm 作业调度，用于科研和教学计算。

**凭证如何获取**

1. 由课题组负责人建立主账号。
2. 主账号负责人或使用者在[交我办](https://my.sjtu.edu.cn/)的“交我算”服务中申请主账号或子账号。
3. 按平台要求完成审批和新手测试。
4. 账号开通后设置安全信息和 SSH 登录方式。
5. 需要项目存储或计算额度时，由主账号负责人配置。

**数据如何获取**

1. 通过 HPC Studio 或 SSH 登录平台。
2. 在项目存储中上传代码和输入数据。
3. 根据资源需求编写 Slurm 作业。
4. 提交作业后，通过队列命令读取等待、运行、完成或失败状态。
5. 从标准输出、日志和项目目录读取结果。
6. 需要自动化时，可通过本人 SSH 账号调用 Slurm 和文件系统；无需另造一个网页抓取接口。

**可获得的数据范围**

- 本人账号能够使用的集群和队列
- 作业状态、作业日志和资源消耗
- 项目文件和计算结果
- 软件环境、模块和容器
- 账户关联的存储和额度

**可以构建的服务**

- 科研计算和批处理
- 模型训练与推理
- 作业提交、监控和失败提醒
- 实验结果归档
- 远程开发环境
- 面向个人项目的 Slurm Agent 或 Skill

**服务入口与参考资料**

- [交我算快速上手](https://docs.hpc.sjtu.edu.cn/quickstart/index.html)
- [交我算账号申请](https://docs.hpc.sjtu.edu.cn/accounts/accountapplication.html)
- [交我算用户手册](https://docs.hpc.sjtu.edu.cn/)
- [SJTU-SLURM-Skill](https://github.com/SJTU-HPC/SJTU-SLURM-Skill)

---

[← 上一页：网络与部署](https://github.com/Chang-Yo/Dela/wiki/Network-and-Deployment) · [继续阅读：安全与合规 →](https://github.com/Chang-Yo/Dela/wiki/Security-and-Compliance)
