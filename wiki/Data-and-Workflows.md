# 校级数据与流程服务

[← Wiki 首页](https://github.com/Chang-Yo/Dela/wiki) · [← 身份与开放平台](https://github.com/Chang-Yo/Dela/wiki/Identity-and-Open-Platform) · [下一页：学习与社区 →](https://github.com/Chang-Yo/Dela/wiki/Learning-and-Community) · [安全与合规](https://github.com/Chang-Yo/Dela/wiki/Security-and-Compliance)

本页面向校内业务系统开发者，介绍校级数据资源 API 与交我办 InfoPlus。两类服务都需要明确的业务主体、数据范围和审批流程。

## 校级数据资源 API

**服务能力**

校级数据资源 API 面向获批的校内业务系统，提供账号、教职工、本科教学、论文和资产等数据。它按申请字段进行授权，适合部门间的数据交换。

**凭证如何获取**

1. 在[数据资源 API 文档](https://developer.sjtu.edu.cn/graphql/overview.html)中确定数据类别和字段。
2. 通过[数据资源 API 申请流程](https://form.sjtu.edu.cn/infoplus/form/data_exchange_api_apply/start)填写使用部门、业务用途、数据来源和字段清单。
3. 获批后取得应用凭据。
4. 使用客户端凭据流程申请 scope 为 exchange_data 的 Access Token。

**数据如何获取**

1. 使用 <code>https://graphql.sjtu.edu.cn/v1</code> 作为统一前缀。
2. 按账号、教职工、本科教学、论文或资产文档选择资源路径。
3. 携带 Access Token，并按批准字段设置查询参数。
4. 列表读取从 first 指定的位置开始，以 offset 控制单次数量；官方文档给出的单次最大偏移量为 200。
5. 保存响应中的时间戳或业务主键，用于后续同步和去重。

**可获得的数据范围**

- jAccount 账号和身份资料
- 教职工基本资料、岗位和职务信息
- 本科生资料、课程、排课和选课数据
- 论文记录
- 资产信息

实际响应只包含申请时获批的类别和字段。

**可以构建的服务**

- 部门人员与组织数据同步
- 本科教学业务系统
- 经审批的科研成果统计
- 资产台账和业务看板
- 校内系统之间的主数据交换

**服务入口与参考资料**

- [数据资源 API 概述](https://developer.sjtu.edu.cn/graphql/overview.html)
- [账号类 API](https://developer.sjtu.edu.cn/graphql/account.html)
- [教职工类 API](https://developer.sjtu.edu.cn/graphql/faculty.html)
- [本科教学类 API](https://developer.sjtu.edu.cn/graphql/student.html)
- [论文类 API](https://developer.sjtu.edu.cn/graphql/paper.html)
- [资产类 API](https://developer.sjtu.edu.cn/graphql/asset.html)

## 交我办与 InfoPlus

**服务能力**

交我办汇集校园办事服务、流程、任务、日程和消息。InfoPlus 提供流程开发、表单、任务、附件、通知、导出和事件接口。

**凭证如何获取**

1. 确定要接入的租户、流程和应用形态。
2. 按[应用管理规范](https://developer.sjtu.edu.cn/form/standard/application.html)创建或申请 InfoPlus App。
3. 在开发环境中取得 App ID 和 Secret。
4. 由流程或租户管理员配置应用能够访问的流程和数据。
5. 代表当前用户办理流程时，使用 Authorization Code 或 Implicit 流程取得 User Token。
6. 由后端应用执行系统任务时，使用 Client Credentials 流程取得 System Token。

**数据如何获取**

1. 用户授权地址为 [https://form.sjtu.edu.cn/infoplus/oauth2/authorize](https://form.sjtu.edu.cn/infoplus/oauth2/authorize)，Token 地址为 [https://form.sjtu.edu.cn/infoplus/oauth2/token](https://form.sjtu.edu.cn/infoplus/oauth2/token)。
2. 根据目标能力选择 User、Task、Task Execution、Admin、Triple、Grant、Stats、Tenant、Entrust 或 Thing API。
3. 附件、通知和导出分别使用 InfoPlus File、Notification 和 Export API。
4. 需要事件更新时，使用 Messenger 或 Push API，而不是持续全量轮询。
5. 流程数据按 Process、Task、FormData 和附件 ID 建立关联。

**可获得的数据范围**

- 用户能够访问的服务和流程
- 流程实例和当前状态
- 待办任务、已办任务和办理历史
- 表单字段
- 流程附件
- 导出结果
- 用户、部门和岗位关系
- 应用通知和流程事件
- 委托、授权和租户范围内的统计信息

**可以构建的服务**

- 校内审批流程
- 部门办事表单
- 待办聚合与提醒
- 流程进度查询
- 流程附件归档
- 业务系统与交我办任务联动
- 表单事件驱动的自动化

**服务入口与参考资料**

- [交我办应用上线申请](https://form.sjtu.edu.cn/infoplus/form/jwb_application_online_apply/start)
- [交我办开发文档](https://developer.sjtu.edu.cn/form/introduce/)
- [InfoPlus 平台介绍](https://developer.sjtu.edu.cn/form/introduce/infoplus.html)
- [InfoPlus API Reference](https://developer.sjtu.edu.cn/form/reference/api.html)
- [InfoPlus File API](https://developer.sjtu.edu.cn/form/reference/fileApi.html)
- [InfoPlus Notification API](https://developer.sjtu.edu.cn/form/reference/notificationApi.html)
- [InfoPlus Export API](https://developer.sjtu.edu.cn/form/reference/exportApi.html)

---

[← 上一页：身份与开放平台](https://github.com/Chang-Yo/Dela/wiki/Identity-and-Open-Platform) · [下一页：学习与社区 →](https://github.com/Chang-Yo/Dela/wiki/Learning-and-Community)
