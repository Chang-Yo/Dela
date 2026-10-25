# 身份认证与开放平台

[← Wiki 首页](README.md) · [下一页：校级数据与流程 →](data-workflows.md) · [安全与合规](security.md) · [资料索引](sources.md)

本页说明校园统一身份认证和 Open API 的申请、授权与数据获取方式。先确定目标数据，再申请最小的 scope。

## jAccount 统一身份认证

**服务能力**

jAccount 为校园网站和应用提供统一登录。开发者可以用它确认用户身份，也可以把它作为上海交通大学 Open API 的用户授权入口。

**凭证如何获取**

1. 明确应用名称、用途、部署地址、回调地址和需要的身份字段。
2. 登录[交我办](https://my.sjtu.edu.cn/)。
3. 进入“服务大厅 → 信息服务 → jAccount 接口申请”。
4. 提交应用信息和所需授权范围。
5. 审核通过后取得 App ID 和 App Secret。
6. 在应用中配置已登记的回调地址。
7. 用户登录时，将用户引导到 jAccount 的 OIDC 或 OAuth 2.0 授权地址。
8. jAccount 回调应用后，应用用授权码换取 ID Token 和 Access Token。

**数据如何获取**

- 只需要登录身份时，验证 OIDC ID Token 的签名、签发者、接收方、过期时间和 nonce。
- 需要更多用户资料时，使用带有相应 scope 的 Access Token 调用 Profile API。
- 每次登录都应通过 state 或 nonce 关联发起请求与回调结果。
- 应用退出时，清理本地会话；需要联动退出时，按 jAccount 登出文档处理。

**可获得的数据范围**

基础身份令牌可以包含 jAccount 账号、姓名、默认学工号和身份类型。Profile API 还可以按获批 scope 返回更完整的本人资料。实际字段取决于应用获批范围。

**可以构建的服务**

- 校园网站统一登录
- 按学生、教师或其他身份展示不同页面
- 个人校园服务的账号绑定
- Open API 用户授权入口
- 需要校内身份确认的活动或工具

**服务入口与参考资料**

- [jAccount 接口服务](https://net.sjtu.edu.cn/wlfw/jAccountjk.htm)
- [申请加入 jAccount 认证体系](https://net.sjtu.edu.cn/info/1227/3007.htm)
- [jAccount OIDC 接入方法](https://developer.sjtu.edu.cn/auth/oidc.html)
- [OAuth 2.0 开放授权](https://developer.sjtu.edu.cn/auth/oauth.html)
- [Profile API](https://developer.sjtu.edu.cn/api/profile.html)

## 上海交通大学 Open API

**服务能力**

Open API 通过 OAuth 2.0 向获批应用提供身份、组织、教学、邮件、文件、通知、校园卡、财务、日历、条码和电子签章等能力。

**凭证如何获取**

1. 在[Open API 接口列表](https://developer.sjtu.edu.cn/api/list.html)中选择目标接口。
2. 记录每个接口要求的授权方式和 scope。
3. 通过 jAccount 接口申请流程提交应用和初始 scope。
4. 审核通过后取得 App ID 和 App Secret。
5. 需要用户本人数据时，使用授权码流程让用户登录并授权。
6. 只访问与用户无关的数据时，使用目标接口明确支持的客户端凭据流程。
7. 用授权码或客户端凭据换取 Access Token。

**数据如何获取**

1. 以 <code>https://api.sjtu.edu.cn/v1</code> 为主要 API 地址。
2. 在请求中携带 Access Token。
3. 按接口文档传入路径参数、查询参数或请求体。
4. 列表接口按照统一分页结构继续读取。
5. 对写入接口保存业务对象 ID和返回状态，以便查询、更新或撤销。
6. Token 过期后重新完成文档规定的取令牌流程。

**可获得的数据范围**

| API          | 主要数据或操作                            |
| ------------ | ----------------------------------------- |
| Profile      | 本人资料，以及获批后的指定用户资料查询    |
| Enterprise   | 组织、岗位、用户岗位、权限和校历          |
| Education    | 教学班、学生课表、考试和绩点              |
| Task         | InfoPlus 流程和第三方任务更新消息         |
| Mail         | 邮件读取、发送和状态更新                  |
| File         | 文件上传、下载、元数据、缩略图和 WPS 链接 |
| Notification | 通知发送、状态查询和状态更新              |
| Finance      | 财务预约、状态查询、撤销和业务完成标记    |
| Campus Card  | 校园卡资料、交易记录和获批卡务操作        |
| Unicode      | 思源码校验及相关状态                      |
| Barcode      | 条码和二维码图像                          |
| Calendar     | 校园日程创建和删除                        |
| Signature    | PDF 电子签章                              |

**可以构建的服务**

- 校园身份和组织信息面板
- 个人课表、考试和成绩工具
- 邮件和通知聚合
- 文件流转与在线预览
- 校园日程同步
- 经业务审批的校园卡、财务和签章系统

**服务入口与参考资料**

- [Open API 概述](https://developer.sjtu.edu.cn/api/overview.html)
- [Open API 完整列表](https://developer.sjtu.edu.cn/api/list.html)
- [OAuth 2.0 授权框架](https://developer.sjtu.edu.cn/auth/oauth.html)
- [Open API Java SDK](https://developer.sjtu.edu.cn/api/sdk.html)

---

[← Wiki 首页](README.md) · [下一页：校级数据与流程 →](data-workflows.md)
